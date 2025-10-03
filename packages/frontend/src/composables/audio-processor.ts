/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Rnnoise, DenoiseState } from '@shiguredo/rnnoise-wasm';

export class AudioProcessor {
	private audioContext: AudioContext | null = null;
	private sourceNode: MediaStreamAudioSourceNode | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private destinationNode: MediaStreamAudioDestinationNode | null = null;
	private rnnoise: Rnnoise | null = null;
	private denoiseState: DenoiseState | null = null;
	private workletUrl: string | null = null;
	private highpassFilter: BiquadFilterNode | null = null;

	async initialize(stream: MediaStream): Promise<MediaStream> {
		try {
			this.audioContext = new AudioContext({ sampleRate: 48000 });

			this.rnnoise = await Rnnoise.load();
			this.denoiseState = this.rnnoise.createDenoiseState();

			const frameSize = this.rnnoise.frameSize;

			this.workletUrl = this.createWorkletUrl(frameSize);
			await this.audioContext.audioWorklet.addModule(this.workletUrl);

			this.sourceNode = this.audioContext.createMediaStreamSource(stream);
			this.destinationNode = this.audioContext.createMediaStreamDestination();

			this.highpassFilter = this.audioContext.createBiquadFilter();
			this.highpassFilter.type = 'highpass';
			this.highpassFilter.frequency.value = 80;
			this.highpassFilter.Q.value = 0.5;

			this.workletNode = new AudioWorkletNode(this.audioContext, 'rnnoise-processor', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				channelCount: 1
			});

			this.workletNode.port.onmessage = (event) => {
				if (event.data.type === 'process' && this.denoiseState) {
					const frame = event.data.frame;
					const original = event.data.original;
					try {
						const vad = this.denoiseState.processFrame(frame);

						let denoisedRatio;
						if (vad > 0.7) {
							denoisedRatio = 0.98;
						} else if (vad > 0.3) {
							denoisedRatio = 0.85 + (vad - 0.3) * 0.325;
						} else {
							denoisedRatio = 0.85;
						}

						let originalEnergy = 0;
						let denoisedEnergy = 0;
						for (let i = 0; i < frame.length; i++) {
							const o = original[i];
							const d = frame[i];
							originalEnergy += o * o;
							denoisedEnergy += d * d;
						}

						let gain = 1.0;
						if (denoisedEnergy > 1e-10) {
							const energyRatio = Math.sqrt(originalEnergy / denoisedEnergy);
							const gainFactor = vad > 0.5 ? 1.0 : 0.7;
							gain = Math.min(energyRatio * gainFactor, 1.8);
						}

						for (let i = 0; i < frame.length; i++) {
							frame[i] = frame[i] * gain * denoisedRatio + original[i] * (1 - denoisedRatio);
						}

						this.workletNode?.port.postMessage({
							type: 'processed',
							frame: frame
						}, [frame.buffer]);
					} catch (error) {
						console.error('Error processing audio frame:', error);
						this.workletNode?.port.postMessage({
							type: 'processed',
							frame: original
						}, [original.buffer]);
					}
				}
			};

			this.sourceNode.connect(this.highpassFilter);
			this.highpassFilter.connect(this.workletNode);
			this.workletNode.connect(this.destinationNode);

			console.log('Audio processor initialized with VAD-based mixing and low-freq passthrough');
			return this.destinationNode.stream;
		} catch (error) {
			console.error('Failed to initialize audio processor:', error);
			return stream;
		}
	}

	private createWorkletUrl(frameSize: number): string {
		const workletCode = `
class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = ${frameSize};
    this.buffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
    this.outputBuffer = [];
    this.outputIndex = 0;
    this.currentOutput = null;
    this.pendingFrames = 0;
    this.maxBufferFrames = 2;

    this.bufferPool = [
      new Float32Array(this.frameSize),
      new Float32Array(this.frameSize)
    ];
    this.poolIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'processed') {
        this.outputBuffer.push(event.data.frame);
        this.pendingFrames--;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input[0] || !output[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      if (this.bufferIndex >= this.frameSize) {
        if (this.pendingFrames < this.maxBufferFrames) {
          const frameBuf = this.bufferPool[this.poolIndex];
          const originalBuf = this.bufferPool[(this.poolIndex + 1) % 2];

          frameBuf.set(this.buffer);
          originalBuf.set(this.buffer);

          const frameCopy = new Float32Array(frameBuf);
          const originalCopy = new Float32Array(originalBuf);

          this.port.postMessage({
            type: 'process',
            frame: frameCopy,
            original: originalCopy
          }, [frameCopy.buffer, originalCopy.buffer]);

          this.pendingFrames++;
          this.poolIndex = (this.poolIndex + 1) % 2;
        }

        this.bufferIndex = 0;
      }

      if (this.currentOutput && this.outputIndex < this.currentOutput.length) {
        outputChannel[i] = this.currentOutput[this.outputIndex++];
      } else if (this.outputBuffer.length > 0) {
        this.currentOutput = this.outputBuffer.shift();
        this.outputIndex = 0;
        outputChannel[i] = this.currentOutput[this.outputIndex++];
      } else {
        outputChannel[i] = inputChannel[i];
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);
`;

		const blob = new Blob([workletCode], { type: 'application/javascript' });
		return URL.createObjectURL(blob);
	}

	cleanup(): void {
		try {
			if (this.denoiseState) {
				this.denoiseState.destroy();
				this.denoiseState = null;
			}

			this.rnnoise = null;

			if (this.workletNode) {
				this.workletNode.port.onmessage = null;
				this.workletNode.disconnect();
				this.workletNode = null;
			}

			if (this.highpassFilter) {
				this.highpassFilter.disconnect();
				this.highpassFilter = null;
			}

			if (this.sourceNode) {
				this.sourceNode.disconnect();
				this.sourceNode = null;
			}

			if (this.destinationNode) {
				this.destinationNode = null;
			}

			if (this.audioContext && this.audioContext.state !== 'closed') {
				this.audioContext.close().catch(console.error);
				this.audioContext = null;
			}

			if (this.workletUrl) {
				URL.revokeObjectURL(this.workletUrl);
				this.workletUrl = null;
			}

			console.log('Audio processor cleaned up');
		} catch (error) {
			console.error('Error cleaning up audio processor:', error);
		}
	}
}
