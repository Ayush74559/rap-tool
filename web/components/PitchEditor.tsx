"use client"
import { useEffect, useMemo, useRef, useState } from 'react'

export const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const
export const SCALES = ['major','minor','dorian','mixolydian'] as const

export type PitchParams = {
  key: typeof KEYS[number]
  scale: typeof SCALES[number]
  strength: number
  retune: number
  vibrato?: number
  humanize?: number
  preset?: string | null
}

export const PITCH_PRESETS: Record<string, Omit<PitchParams, 'preset'>> = {
  'Trap Vocal': { key: 'A', scale: 'minor', strength: 0.8, retune: 0.2, vibrato: 0.15, humanize: 0.3 },
  'Lo-Fi': { key: 'D', scale: 'dorian', strength: 0.4, retune: 0.6, vibrato: 0.25, humanize: 0.6 },
  'Club Mix': { key: 'F#', scale: 'major', strength: 0.7, retune: 0.35, vibrato: 0.1, humanize: 0.2 },
}

export default function PitchEditor({
  value,
  onChange,
  onApply,
  disabled,
  busy,
}: {
  value: PitchParams
  onChange: (next: PitchParams) => void
  onApply?: (params: PitchParams) => void | Promise<void>
  disabled?: boolean
  busy?: boolean
}) {
  const [preset, setPreset] = useState<string>(value.preset || 'Trap Vocal')
  const curveRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const [animate, setAnimate] = useState(true)

  const presetOptions = useMemo(() => Object.keys(PITCH_PRESETS), [])

  useEffect(() => {
    const curve = curveRef.current
    const bars = barsRef.current
    if (!curve || !bars) return
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const cw = curve.clientWidth, ch = curve.clientHeight
      const bw = bars.clientWidth, bh = bars.clientHeight
      curve.width = Math.floor(cw * dpr); curve.height = Math.floor(ch * dpr)
      bars.width = Math.floor(bw * dpr); bars.height = Math.floor(bh * dpr)
    }
    resize()
    let last = performance.now()
    const curveCtx = curve.getContext('2d')!
    const barsCtx = bars.getContext('2d')!
    const BAR_COUNT = 32
    const barValues = new Array(BAR_COUNT).fill(0)
    const loop = (ts: number) => {
      if (!animate) return
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      const cw = curve.clientWidth, ch = curve.clientHeight
      const bw = bars.clientWidth, bh = bars.clientHeight
      curveCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      barsCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // draw curve grid
      curveCtx.clearRect(0,0,cw,ch)
      curveCtx.strokeStyle = 'rgba(255,255,255,0.08)'
      for (let i=0;i<8;i++) {
        const x = (i/7) * cw
        curveCtx.beginPath(); curveCtx.moveTo(x, 0); curveCtx.lineTo(x, ch); curveCtx.stroke()
      }
      // animated curve
      const speed = 0.6 + (1 - (value.retune ?? 0)) * 0.8
      const amp = ch * 0.3 * value.strength
      const vib = (value.vibrato ?? 0) * 6
      const phase = ts * 0.001 * speed
      curveCtx.strokeStyle = '#39FF14'
      curveCtx.lineWidth = 2
      curveCtx.beginPath()
      for (let x=0;x<=cw;x++) {
        const t = x/cw
        const wobble = Math.sin((t*8 + phase) * Math.PI) * (vib * 0.5)
        const y = ch*0.5 + Math.sin((t*4 + phase)*Math.PI*2 + wobble) * amp
        if (x===0) curveCtx.moveTo(x,y); else curveCtx.lineTo(x,y)
      }
      curveCtx.stroke()
      // playhead bar sweeping
      const playX = (phase % 1) * cw
      curveCtx.fillStyle = 'rgba(57,255,20,0.08)'
      curveCtx.fillRect(playX, 0, 2, ch)

      // bars
      barsCtx.clearRect(0,0,bw,bh)
      const human = (value.humanize ?? 0.3)
      for (let i=0;i<BAR_COUNT;i++) {
        const target = 0.25 + 0.75*Math.abs(Math.sin(phase*2 + i*0.37))
        // ease towards target (more humanize = more randomness, less stiffness)
        const jitter = (Math.sin(phase*3 + i) * 0.5 + 0.5) * human * 0.2
        barValues[i] += ((target + jitter) - barValues[i]) * (0.08 + human*0.12)
        const w = bw / BAR_COUNT
        const h = Math.max(2, barValues[i] * bh)
        const x = i * w + 2
        const y = bh - h
        const hue = 100 + 80 * barValues[i]
        barsCtx.fillStyle = `hsl(${hue} 90% 55% / 0.9)`
        const radius = 4
        // rounded rect
        barsCtx.beginPath()
        barsCtx.moveTo(x, y + radius)
        barsCtx.arcTo(x, y, x + radius, y, radius)
        barsCtx.lineTo(x + w - radius - 2, y)
        barsCtx.arcTo(x + w - 2, y, x + w - 2, y + radius, radius)
        barsCtx.lineTo(x + w - 2, y + h - radius)
        barsCtx.arcTo(x + w - 2, y + h, x + w - radius - 2, y + h, radius)
        barsCtx.lineTo(x + radius, y + h)
        barsCtx.arcTo(x, y + h, x, y + h - radius, radius)
        barsCtx.closePath()
        barsCtx.fill()
      }

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [animate, value.strength, value.retune, value.vibrato, value.humanize])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Pitch & Autotune</h3>
        <div className="flex items-center gap-2">
          <label className="text-xs inline-flex items-center gap-1 text-white/70">
            <input type="checkbox" checked={animate} onChange={(e)=>setAnimate(e.target.checked)} /> Animate
          </label>
          <select
            value={preset}
            onChange={(e) => {
              const name = e.target.value
              setPreset(name)
              const p = PITCH_PRESETS[name]
              if (p) onChange({ ...p, preset: name })
            }}
            className="bg-black border border-white/10 rounded px-2 py-1"
            disabled={disabled || busy}
          >
            {presetOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm"
            onClick={() => { onChange({ ...PITCH_PRESETS['Trap Vocal'], preset: 'Trap Vocal' }); setPreset('Trap Vocal') }}
            disabled={disabled || busy}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="text-sm text-white/70">Key
          <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value as any, preset: null })} className="w-full mt-1 bg-black border border-white/10 rounded px-2 py-1" disabled={disabled || busy}>
            {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="text-sm text-white/70">Scale
          <select value={value.scale} onChange={(e) => onChange({ ...value, scale: e.target.value as any, preset: null })} className="w-full mt-1 bg-black border border-white/10 rounded px-2 py-1" disabled={disabled || busy}>
            {SCALES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm text-white/70">Strength
          <input type="range" min={0} max={1} step={0.01} value={value.strength} onChange={(e) => onChange({ ...value, strength: parseFloat(e.target.value), preset: null })} className="w-full" disabled={disabled || busy} />
        </label>
        <label className="text-sm text-white/70">Retune Speed
          <input type="range" min={0} max={1} step={0.01} value={value.retune} onChange={(e) => onChange({ ...value, retune: parseFloat(e.target.value), preset: null })} className="w-full" disabled={disabled || busy} />
        </label>
        <label className="text-sm text-white/70">Vibrato
          <input type="range" min={0} max={1} step={0.01} value={value.vibrato ?? 0} onChange={(e) => onChange({ ...value, vibrato: parseFloat(e.target.value), preset: null })} className="w-full" disabled={disabled || busy} />
        </label>
        <label className="text-sm text-white/70">Humanize
          <input type="range" min={0} max={1} step={0.01} value={value.humanize ?? 0} onChange={(e) => onChange({ ...value, humanize: parseFloat(e.target.value), preset: null })} className="w-full" disabled={disabled || busy} />
        </label>
      </div>
      <div className="mt-3">
        <div className="text-xs text-white/50 mb-1">Pitch curve</div>
        <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
          <canvas ref={curveRef} style={{ width: '100%', height: 120 }} />
        </div>
        <div className="text-xs text-white/50 mt-3 mb-1">Bars</div>
        <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
          <canvas ref={barsRef} style={{ width: '100%', height: 64 }} />
        </div>
      </div>
      <div className="mt-3 text-right">
        <button
          type="button"
          className="rounded bg-[var(--neon)] text-black font-semibold px-3 py-1 disabled:opacity-50"
          onClick={() => onApply && onApply(value)}
          disabled={disabled || busy}
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}
