import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const MODELS = {
  fast: 'Xenova/segformer-b0-finetuned-ade-512-512',
  high: 'Xenova/segformer-b1-finetuned-ade-512-512',
};

const pipelines = new Map();
const pipelinePromises = new Map();
let activeBackend = 'wasm';

function send(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function progressCallback(quality) {
  return (info) => {
    const value = Number(info?.progress);
    send('progress', {
      quality,
      status: info?.status || 'loading',
      file: info?.file || '',
      progress: Number.isFinite(value) ? value : null,
    });
  };
}

async function createPipelineFor(quality) {
  const requestedModel = MODELS[quality] || MODELS.fast;
  const attempts = [];

  if (quality === 'fast' && self.navigator?.gpu) {
    attempts.push({ model: requestedModel, device: 'webgpu', dtype: 'fp16', backend: 'webgpu' });
  }
  attempts.push({ model: requestedModel, dtype: 'q8', backend: 'wasm' });

  if (quality === 'high') {
    attempts.push({ model: MODELS.fast, dtype: 'q8', backend: 'wasm-hq-fallback' });
    if (self.navigator?.gpu) {
      attempts.push({ model: MODELS.fast, device: 'webgpu', dtype: 'fp16', backend: 'webgpu-hq-fallback' });
    }
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      send('model-status', {
        quality,
        message: attempt.backend.startsWith('webgpu') ? 'Starting GPU floor AI' : 'Starting floor AI',
      });
      const segmenter = await pipeline('image-segmentation', attempt.model, {
        ...(attempt.device ? { device: attempt.device } : {}),
        dtype: attempt.dtype,
        progress_callback: progressCallback(quality),
      });
      activeBackend = attempt.backend;
      send('ready', { quality, model: attempt.model, backend: attempt.backend });
      return segmenter;
    } catch (error) {
      lastError = error;
      send('backend-failed', {
        quality,
        backend: attempt.backend,
        message: error?.message || String(error),
      });
    }
  }
  throw lastError || new Error('No browser inference backend could be initialized.');
}

async function ensureSegmenter(quality = 'fast') {
  if (pipelines.has(quality)) return pipelines.get(quality);
  if (pipelinePromises.has(quality)) return pipelinePromises.get(quality);

  if (quality === 'high' && pipelines.has('fast')) {
    try {
      await pipelines.get('fast')?.dispose?.();
    } catch (_) {
      // Disposal is an optimization; failure should not block the HQ pass.
    }
    pipelines.delete('fast');
  }

  const promise = createPipelineFor(quality)
    .then((segmenter) => {
      pipelines.set(quality, segmenter);
      pipelinePromises.delete(quality);
      return segmenter;
    })
    .catch((error) => {
      pipelinePromises.delete(quality);
      throw error;
    });
  pipelinePromises.set(quality, promise);
  return promise;
}

function normalizeMask(rawMask, fallbackWidth, fallbackHeight) {
  if (!rawMask) {
    return { data: new Uint8Array(fallbackWidth * fallbackHeight), width: fallbackWidth, height: fallbackHeight };
  }

  const size = Array.isArray(rawMask.size) ? rawMask.size : [];
  const width = Number(rawMask.width || size[0] || fallbackWidth);
  const height = Number(rawMask.height || size[1] || fallbackHeight);
  const source = rawMask.data;
  if (!source || !width || !height) {
    return { data: new Uint8Array(fallbackWidth * fallbackHeight), width: fallbackWidth, height: fallbackHeight };
  }

  const pixelCount = width * height;
  const channels = Math.max(1, Number(rawMask.channels || Math.round(source.length / pixelCount) || 1));
  const result = new Uint8Array(pixelCount);
  if (channels === 1) {
    for (let i = 0; i < pixelCount; i += 1) result[i] = source[i] > 127 ? 255 : 0;
  } else {
    for (let i = 0; i < pixelCount; i += 1) {
      const offset = i * channels;
      const value = Math.max(source[offset] || 0, source[offset + 1] || 0, source[offset + 2] || 0);
      result[i] = value > 127 ? 255 : 0;
    }
  }
  return { data: result, width, height };
}

async function segment({ requestId, bitmap, quality = 'fast' }) {
  const started = performance.now();
  try {
    const segmenter = await ensureSegmenter(quality);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The browser could not create an AI image canvas.');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const image = RawImage.fromCanvas(canvas);
    const output = await segmenter(image);
    const floor = Array.isArray(output)
      ? output.find((entry) => String(entry?.label || '').trim().toLowerCase() === 'floor')
      : null;
    const normalized = normalizeMask(floor?.mask, width, height);

    send('result', {
      requestId,
      quality,
      backend: activeBackend,
      width: normalized.width,
      height: normalized.height,
      elapsed: Math.round(performance.now() - started),
      mask: normalized.data,
      labels: Array.isArray(output) ? output.map((entry) => entry?.label).filter(Boolean) : [],
    }, [normalized.data.buffer]);
  } catch (error) {
    bitmap?.close?.();
    send('error', {
      requestId,
      quality,
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    ensureSegmenter(message.quality || 'fast').catch((error) => {
      send('error', {
        requestId: message.requestId || 0,
        quality: message.quality || 'fast',
        message: error?.message || String(error),
      });
    });
    return;
  }
  if (message.type === 'segment' && message.bitmap) segment(message);
});
