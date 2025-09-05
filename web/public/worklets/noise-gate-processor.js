// Simple noise gate AudioWorkletProcessor
// Parameters:
// - threshold (dBFS): below this RMS level, apply reduction
// - reduction (dB): attenuation applied when below threshold
// - hold (ms): minimum time to stay gated once triggered
// - attack (ms), release (ms): smoothing for gain changes

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -90, maxValue: -10 },
      { name: 'reduction', defaultValue: -18, minValue: -60, maxValue: 0 },
      { name: 'hold', defaultValue: 20, minValue: 0, maxValue: 500 },
      { name: 'attack', defaultValue: 5, minValue: 0.1, maxValue: 200 },
      { name: 'release', defaultValue: 120, minValue: 10, maxValue: 1000 },
    ]
  }

  constructor() {
    super()
    this._state = 'open'
    this._holdTime = 0
    this._currentGain = 1.0
  }

  dBToLin(db) { return Math.pow(10, db / 20) }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true

    const chIn = input[0]
    const chOut = output[0]
    if (!chIn || !chOut) return true

    const thresh = (parameters.threshold.length > 1 ? parameters.threshold[0] : parameters.threshold[0])
    const reduction = (parameters.reduction.length > 1 ? parameters.reduction[0] : parameters.reduction[0])
    const holdMs = (parameters.hold.length > 1 ? parameters.hold[0] : parameters.hold[0])
    const attMs = (parameters.attack.length > 1 ? parameters.attack[0] : parameters.attack[0])
    const relMs = (parameters.release.length > 1 ? parameters.release[0] : parameters.release[0])

    // Compute RMS for this block
    let sum = 0
    for (let i = 0; i < chIn.length; i++) {
      sum += chIn[i] * chIn[i]
    }
    const rms = Math.sqrt(sum / chIn.length)
    const rmsDb = 20 * Math.log10(rms + 1e-8)

    const gated = rmsDb < thresh
    const reductionLin = this.dBToLin(reduction)

  // Use global AudioWorklet sampleRate
  const holdSamples = (holdMs / 1000) * sampleRate
  const attCoef = Math.exp(-1 / ((attMs / 1000) * sampleRate))
  const relCoef = Math.exp(-1 / ((relMs / 1000) * sampleRate))

    if (gated) {
      this._holdTime = holdSamples
      // move towards reduced gain
      this._currentGain = this._currentGain * attCoef + reductionLin * (1 - attCoef)
    } else {
      if (this._holdTime > 0) {
        this._holdTime -= chIn.length
        // keep reduced gain during hold
        this._currentGain = this._currentGain * attCoef + reductionLin * (1 - attCoef)
      } else {
        // recover towards full gain
        this._currentGain = this._currentGain * relCoef + 1.0 * (1 - relCoef)
      }
    }

    for (let i = 0; i < chIn.length; i++) {
      chOut[i] = chIn[i] * this._currentGain
    }

    return true
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor)
