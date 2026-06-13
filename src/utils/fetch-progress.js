/**
 * Fetch a URL into an ArrayBuffer while reporting download progress.
 *
 * Large detector models (the HF key-class ONNX files on Cloudflare R2) take a
 * while to pull down; streaming the response body lets the UI show real
 * progress instead of a frozen "Analyzing..." state.
 *
 * onProgress({ loaded, total }) is called as bytes arrive. `total` is 0 when
 * the server sends no Content-Length.
 */
export async function fetchArrayBufferWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);

  const total = Number(response.headers.get('Content-Length')) || 0;

  // No streaming body (older runtimes / opaque responses): single read.
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total: total || buffer.byteLength });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  onProgress?.({ loaded: 0, total });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}
