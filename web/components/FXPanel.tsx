"use client"
import { useMemo } from 'react'
import { gsap } from 'gsap'

export type FxParams = {
  enabled: { reverb: boolean; delay: boolean; eq: boolean; comp: boolean; noise: boolean; autotune: boolean }
  reverb: number
  delay: number
  eq: { low: number; mid: number; high: number }
  comp: { thresh: number; ratio: number; gain: number }
  preset?: string | null
}

export function FXPanel({ value, onChange }: { value: FxParams; onChange: (next: FxParams) => void }) {
  const presets = useMemo(() => ({
    'Clean Vocal': {
      enabled: { reverb: true, delay: false, eq: true, comp: true, noise: false, autotune: true },
      reverb: 0.12,
      delay: 0.0,
      eq: { low: 0, mid: 0, high: 2 },
      comp: { thresh: -14, ratio: 2.5, gain: 3 },
    },
    'Trap Vox': {
      enabled: { reverb: true, delay: true, eq: true, comp: true, noise: true, autotune: true },
      reverb: 0.28,
      delay: 0.22,
      eq: { low: -2, mid: -1, high: 4 },
      comp: { thresh: -18, ratio: 3.5, gain: 4 },
    },
    'Lo‑Fi': {
      enabled: { reverb: true, delay: true, eq: true, comp: false, noise: false, autotune: false },
      reverb: 0.22,
      delay: 0.3,
      eq: { low: -6, mid: -4, high: -2 },
      comp: { thresh: -12, ratio: 2, gain: 2 },
    },
    'Club': {
      enabled: { reverb: true, delay: true, eq: true, comp: true, noise: false, autotune: true },
      reverb: 0.18,
      delay: 0.18,
      eq: { low: 2, mid: 0, high: 3 },
      comp: { thresh: -16, ratio: 4, gain: 3 },
    },
  } as Record<string, Omit<FxParams, 'preset'>>), [])

  const set = (patch: Partial<FxParams>) => onChange({ ...value, ...patch })
  const pulse = (el: EventTarget | null) => {
    const node = el as HTMLElement | null
    if (!node) return
    gsap.fromTo(node, { filter: 'drop-shadow(0 0 0 rgba(57,255,20,0))' }, { filter: 'drop-shadow(0 0 8px rgba(57,255,20,0.45))', duration: 0.12, yoyo: true, repeat: 1 })
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Vocal FX</h3>
        <div className="flex items-center gap-2">
          <select
            aria-label="Preset"
            className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-sm"
            value={value.preset || ''}
            onChange={(e) => {
              const name = e.target.value
              if (!name) { set({ preset: null }); return }
              const p = presets[name]
              if (p) onChange({ ...p, preset: name })
            }}
          >
            <option value="">Preset…</option>
            {Object.keys(presets).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm"
            onClick={() => onChange({ enabled: { reverb: true, delay: false, eq: true, comp: true, noise: false, autotune: true }, reverb: 0.12, delay: 0, eq: { low: 0, mid: 0, high: 2 }, comp: { thresh: -14, ratio: 2.5, gain: 3 }, preset: null })}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {/* Global toggles */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 grid grid-cols-2 gap-3">
          <label className="text-xs inline-flex items-center gap-2">
            <input type="checkbox" checked={value.enabled.autotune} onChange={(e) => set({ enabled: { ...value.enabled, autotune: e.target.checked }, preset: null })} /> Autotune
          </label>
          <label className="text-xs inline-flex items-center gap-2">
            <input type="checkbox" checked={value.enabled.noise} onChange={(e) => set({ enabled: { ...value.enabled, noise: e.target.checked }, preset: null })} /> Noise Removal
          </label>
        </div>
        {/* Reverb */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">Reverb</span>
            <label className="text-xs inline-flex items-center gap-2">
              <input type="checkbox" checked={value.enabled.reverb} onChange={(e) => set({ enabled: { ...value.enabled, reverb: e.target.checked } })} />
              Enabled
            </label>
          </div>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={value.reverb}
            onChange={(e) => { set({ reverb: parseFloat(e.target.value), preset: null }); pulse(e.target) }}
            className="w-full"
            disabled={!value.enabled.reverb}
          />
        </div>

        {/* Delay */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">Delay</span>
            <label className="text-xs inline-flex items-center gap-2">
              <input type="checkbox" checked={value.enabled.delay} onChange={(e) => set({ enabled: { ...value.enabled, delay: e.target.checked } })} />
              Enabled
            </label>
          </div>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={value.delay}
            onChange={(e) => { set({ delay: parseFloat(e.target.value), preset: null }); pulse(e.target) }}
            className="w-full"
            disabled={!value.enabled.delay}
          />
        </div>

        {/* EQ */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">EQ</span>
            <label className="text-xs inline-flex items-center gap-2">
              <input type="checkbox" checked={value.enabled.eq} onChange={(e) => set({ enabled: { ...value.enabled, eq: e.target.checked } })} />
              Enabled
            </label>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs text-white/60 mb-1">Low</div>
              <input type="range" min={-12} max={12} step={1} value={value.eq.low} onChange={(e) => { set({ eq: { ...value.eq, low: parseInt(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.eq} />
            </div>
            <div className="flex-1">
              <div className="text-xs text-white/60 mb-1">Mid</div>
              <input type="range" min={-12} max={12} step={1} value={value.eq.mid} onChange={(e) => { set({ eq: { ...value.eq, mid: parseInt(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.eq} />
            </div>
            <div className="flex-1">
              <div className="text-xs text-white/60 mb-1">High</div>
              <input type="range" min={-12} max={12} step={1} value={value.eq.high} onChange={(e) => { set({ eq: { ...value.eq, high: parseInt(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.eq} />
            </div>
          </div>
        </div>

        {/* Compressor */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">Compressor</span>
            <label className="text-xs inline-flex items-center gap-2">
              <input type="checkbox" checked={value.enabled.comp} onChange={(e) => set({ enabled: { ...value.enabled, comp: e.target.checked } })} />
              Enabled
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs text-white/60">Threshold
              <input type="range" min={-30} max={0} step={1} value={value.comp.thresh} onChange={(e) => { set({ comp: { ...value.comp, thresh: parseInt(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.comp} />
            </label>
            <label className="text-xs text-white/60">Ratio
              <input type="range" min={1} max={10} step={0.5} value={value.comp.ratio} onChange={(e) => { set({ comp: { ...value.comp, ratio: parseFloat(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.comp} />
            </label>
            <label className="text-xs text-white/60">Gain
              <input type="range" min={0} max={12} step={0.5} value={value.comp.gain} onChange={(e) => { set({ comp: { ...value.comp, gain: parseFloat(e.target.value) }, preset: null }); pulse(e.target) }} className="w-full" disabled={!value.enabled.comp} />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
