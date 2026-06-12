/**
 * Shared ONNX Runtime Web setup.
 *
 * ONNX Runtime loads a small Emscripten module and its companion WASM binary
 * at runtime. Importing those files with Vite's `?url` suffix makes them part
 * of the client build and returns URLs that resolve correctly from both the
 * main thread and module Web Workers.
 */
import * as ort from 'onnxruntime-web/wasm';
import onnxRuntimeWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import onnxRuntimeWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

let configured = false;

function resolveRuntimeAssetUrl(assetUrl) {
  return new URL(assetUrl, globalThis.location?.href || import.meta.url).href;
}

export function configureOnnxRuntime() {
  if (configured) return ort;

  ort.env.wasm.wasmPaths = {
    mjs: resolveRuntimeAssetUrl(onnxRuntimeWasmModuleUrl),
    wasm: resolveRuntimeAssetUrl(onnxRuntimeWasmBinaryUrl),
  };

  // Bourdon detectors run in an existing audio Web Worker. Keeping ONNX's WASM
  // backend single-threaded avoids requiring cross-origin isolation headers and
  // prevents nested runtime workers from competing with real-time audio work.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  configured = true;
  return ort;
}

export { ort, onnxRuntimeWasmBinaryUrl, onnxRuntimeWasmModuleUrl };
