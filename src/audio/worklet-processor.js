class FiddlekeyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    // Pre-allocate a double buffer to avoid allocations in the process loop
    this.buffers = [
      new Float32Array(this.bufferSize),
      new Float32Array(this.bufferSize)
    ];
    this.bufferIndex = 0;
    this.buffer = this.buffers[this.bufferIndex];
    this.writeIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputChannel = input[0];

      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.writeIndex++] = inputChannel[i];

        // If buffer is full, send it to the main thread
        if (this.writeIndex >= this.bufferSize) {
          this.port.postMessage(this.buffer);

          // Swap to the other pre-allocated buffer for the next chunk
          this.bufferIndex = (this.bufferIndex + 1) % 2;
          this.buffer = this.buffers[this.bufferIndex];
          this.writeIndex = 0;
        }
      }
    }

    // Keep the processor alive
    return true;
  }
}

registerProcessor('fiddlekey-processor', FiddlekeyProcessor);
