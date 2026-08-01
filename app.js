const APP_PARTS = [
  './app-parts/part-00.b64',
  './app-parts/part-01.b64',
  './app-parts/part-02.b64',
  './app-parts/part-03.b64',
  './app-parts/part-04.b64',
  './app-parts/part-05.b64',
  './app-parts/part-06.b64',
  './app-parts/part-07.b64',
  './app-parts/part-08.b64',
];

async function loadApplication() {
  const parts = await Promise.all(APP_PARTS.map(async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
    return response.text();
  }));
  const encoded = parts.join('').replace(/\s+/g, '');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  let source = new TextDecoder().decode(bytes);
  // Repair one stale fragment left by an interrupted repository upload.
  source = source.replace(
    'const value = state.currentMask.length;',
    'const value = state.currentMask[i] / 255;'
  );
  if (!source.includes('class TileRenderer') || !source.includes('function initialize()')) {
    throw new Error('The application bundle is incomplete.');
  }
  (0, eval)(`${source}\n//# sourceURL=prisma-floor-lens-v4.js`);
}

loadApplication().catch((error) => {
  console.error('Prisma Floor Lens failed to start.', error);
  document.body.innerHTML = `<main style="max-width:720px;margin:10vh auto;padding:24px;font:16px/1.5 system-ui;color:#111"><h1>Prisma Floor Lens could not start</h1><p>${String(error?.message || error)}</p><button onclick="location.reload()" style="padding:12px 18px">Retry</button></main>`;
});
