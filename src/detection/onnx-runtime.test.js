import { describe, expect, it } from 'vitest';
import {
  configureOnnxRuntime,
  onnxRuntimeWasmBinaryUrl,
  onnxRuntimeWasmModuleUrl,
  ort,
} from './onnx-runtime.js';

describe('ONNX Runtime Web setup', () => {
  it('configures Vite-emitted runtime asset URLs for workers', () => {
    const configuredOrt = configureOnnxRuntime();

    expect(configuredOrt).toBe(ort);
    expect(ort.env.wasm.wasmPaths.mjs).toContain('ort-wasm-simd-threaded');
    expect(ort.env.wasm.wasmPaths.wasm).toContain('ort-wasm-simd-threaded');
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.proxy).toBe(false);
    expect(onnxRuntimeWasmModuleUrl).toContain('ort-wasm-simd-threaded');
    expect(onnxRuntimeWasmBinaryUrl).toContain('ort-wasm-simd-threaded');
  });
});
