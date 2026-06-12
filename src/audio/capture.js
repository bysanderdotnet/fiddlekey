/**
 * src/audio/capture.js
 * Handles microphone stream, AudioContext setup, and wiring the worklet to the worker.
 */

let audioContext = null;
let stream = null;
let worker = null;
let workletNode = null;
let source = null;

export async function startAudio(options = {}) {
  try {
    // 1. Request microphone access
    // We disable processing to get the rawest signal possible for music analysis
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // 2. Create AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 3. Load AudioWorklet module
    // In Vite, using new URL(..., import.meta.url) ensures the path is correctly resolved
    await audioContext.audioWorklet.addModule(
      new URL('./worklet-processor.js', import.meta.url)
    );

    // 4. Initialize Worker
    worker = new Worker(
      new URL('./worker.js', import.meta.url),
      { type: 'module' }
    );

    worker.postMessage({
      type: 'init',
      detectorId: options.detectorId || 'essentia',
      sampleRate: audioContext.sampleRate,
      bufferSize: 4096, // Matches worklet-processor.js
      deterministicClock: options.deterministicClock === true
    });

    // 5. Create AudioWorkletNode
    workletNode = new AudioWorkletNode(audioContext, 'fiddlekey-processor');

    // 6. Connect worklet to worker
    workletNode.port.onmessage = (event) => {
      worker.postMessage(event.data);
    };

    // 7. Connect microphone source to worklet
    source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode);

    // We don't connect to destination to avoid feedback loops.
    // The processor will still run because it has an active input.

    console.log('Audio capture pipeline initialized');

    return {
      audioContext,
      stream,
      worker,
      workletNode
    };
  } catch (error) {
    console.error('Failed to initialize audio capture:', error);
    throw error;
  }
}

export async function stopAudio() {
  console.log('Stopping audio pipeline...');

  if (source) {
    source.disconnect();
    source = null;
  }

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  if (worker) {
    worker.terminate();
    worker = null;
  }

  console.log('Audio capture pipeline stopped');
}
