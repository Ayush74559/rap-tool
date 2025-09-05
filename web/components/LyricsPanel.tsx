"use client"
import { useEffect, useMemo, useRef, useState } from 'react'

export function LyricsPanel({
  value,
  onChange,
  beatUrl,
  storageKey,
}: {
  value: string
  onChange: (next: string) => void
  beatUrl?: string
  storageKey?: string
}) {
  const [open, setOpen] = useState(false)
  const [secsPerLine, setSecsPerLine] = useState(4)
  const [countIn, setCountIn] = useState(2) // bars of count-in (approx seconds = bars*secsPerLine)
  const [editorFontPx, setEditorFontPx] = useState(16)
  const lines = useMemo(() => value.split(/\r?\n/).filter(l => l.trim().length > 0), [value])
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Persist to localStorage if storageKey provided
  useEffect(() => {
    if (!storageKey) return
    const id = setTimeout(() => {
      try { localStorage.setItem(storageKey, value) } catch {}
    }, 250)
    return () => clearTimeout(id)
  }, [value, storageKey])

  // Auto-grow textarea height
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(600, Math.max(192, ta.scrollHeight)) + 'px'
  }, [value, editorFontPx])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Lyrics</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm"
            onClick={() => setOpen(true)}
            disabled={lines.length === 0}
          >
            Rap Mode
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3 text-xs text-white/70">
          <label className="inline-flex items-center gap-2">Font
            <input type="range" min={12} max={24} step={1} value={editorFontPx} onChange={(e) => setEditorFontPx(parseInt(e.target.value))} />
            <span className="tabular-nums">{editorFontPx}px</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-xs"
            onClick={() => navigator.clipboard.writeText(value).catch(()=>{})}
            disabled={!value}
          >
            Copy
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-xs"
            onClick={() => onChange('')}
            disabled={!value}
          >
            Clear
          </button>
        </div>
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Write your bars here...\n\nExample:\nI hit the booth and the bass go boom\nNeon lights drip when I step in the room`}
        className="w-full min-h-48 max-h-[600px] resize-y rounded-lg bg-black/40 border border-white/10 p-3 outline-none focus:ring-1 focus:ring-[var(--neon)]"
        style={{ fontSize: editorFontPx, lineHeight: 1.5 as any }}
      />
      <div className="mt-2 text-xs text-white/50 flex items-center justify-between">
        <span>Lines: {lines.length}</span>
        <span>Words: {value.trim() ? value.trim().split(/\s+/).length : 0}</span>
      </div>

      {open && (
        <RapOverlay
          lines={lines}
          onClose={() => setOpen(false)}
          beatUrl={beatUrl}
          secsPerLine={secsPerLine}
          onSecsPerLine={setSecsPerLine}
          countInBars={countIn}
          onCountInBars={setCountIn}
          storageKey={storageKey}
        />
      )}
    </div>
  )
}

function RapOverlay({
  lines,
  onClose,
  beatUrl,
  secsPerLine,
  onSecsPerLine,
  countInBars,
  onCountInBars,
  storageKey,
}: {
  lines: string[]
  onClose: () => void
  beatUrl?: string
  secsPerLine: number
  onSecsPerLine: (n: number) => void
  countInBars: number
  onCountInBars: (n: number) => void
  storageKey?: string
}) {
  const [running, setRunning] = useState(false)
  const [index, setIndex] = useState(-1) // -1 = count-in
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fontScale, setFontScale] = useState(1.0)
  const [lineHeight, setLineHeight] = useState(1.3)
  const [align, setAlign] = useState<'center' | 'left' | 'right'>('center')
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [paused, setPaused] = useState(false)
  const [metronome, setMetronome] = useState(true)
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const lineStartRef = useRef<number>(0)
  const remainingMsRef = useRef<number>(0)
  const countTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const ctxRef = useRef<AudioContext | null>(null)
  const tapsRef = useRef<number[]>([])

  function beep() {
    try {
      const now = typeof window !== 'undefined' && 'AudioContext' in window
        ? (ctxRef.current || (ctxRef.current = new (window as any).AudioContext()))
        : null
      if (!now) return
      const ctx = ctxRef.current as AudioContext
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'square'
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
      o.connect(g).connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.13)
    } catch {}
  }

  function clearCountTimers() {
    countTimersRef.current.forEach(t => clearTimeout(t))
    countTimersRef.current = []
  }

  function stopRaf() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  function startRaf() {
    stopRaf()
    const loop = () => {
      if (!running || paused || index < 0 || mode !== 'auto') { setProgress(0); return }
      const elapsed = performance.now() - lineStartRef.current
      const pct = Math.min(1, Math.max(0, elapsed / (secsPerLine * 1000)))
      setProgress(pct)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  // Load/persist overlay settings
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(`${storageKey}:overlay`)
      if (raw) {
        const cfg = JSON.parse(raw)
        if (typeof cfg.fontScale === 'number') setFontScale(cfg.fontScale)
        if (typeof cfg.lineHeight === 'number') setLineHeight(cfg.lineHeight)
        if (cfg.align === 'left' || cfg.align === 'right' || cfg.align === 'center') setAlign(cfg.align)
        if (cfg.mode === 'auto' || cfg.mode === 'manual') setMode(cfg.mode)
        if (typeof cfg.secsPerLine === 'number') onSecsPerLine(cfg.secsPerLine)
        if (typeof cfg.countInBars === 'number') onCountInBars(cfg.countInBars)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    const cfg = { fontScale, lineHeight, align, mode, secsPerLine, countInBars }
    try { localStorage.setItem(`${storageKey}:overlay`, JSON.stringify(cfg)) } catch {}
  }, [storageKey, fontScale, lineHeight, align, mode, secsPerLine, countInBars])

  useEffect(() => {
    // Cleanup on unmount to avoid stuck timers/animation and stray audio
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      clearCountTimers()
      stopRaf()
      try { audioRef.current?.pause() } catch {}
    }
  }, [])

  const start = () => {
    setRunning(true)
    setIndex(-1)
    setPaused(false)
    // Start beat after small delay to avoid autoplay issues when already user interacted via button
    try { if (beatUrl) audioRef.current?.play().catch(()=>{}) } catch {}
    clearCountTimers()
    if (mode === 'auto') {
      // Count-in beeps then start lines
      const step = Math.max(0, secsPerLine * 1000)
      if (metronome) {
        for (let i = 0; i < Math.max(0, countInBars); i++) {
          const t = setTimeout(() => beep(), i * step)
          countTimersRef.current.push(t)
        }
      }
      const totalCountMs = Math.max(0, countInBars * step)
      timerRef.current = setTimeout(() => {
        setIndex(0)
      }, totalCountMs)
    } else {
      // Manual mode: start immediately at first line
      setIndex(0)
    }
  }

  useEffect(() => {
    if (!running) return
    if (index < 0) return // waiting count-in
    if (index >= lines.length) return
    if (mode === 'auto') {
      if (metronome) beep()
      lineStartRef.current = performance.now()
      startRaf()
      // schedule next line
      timerRef.current = setTimeout(() => setIndex((i) => i + 1), secsPerLine * 1000)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [running, index, secsPerLine, lines.length, mode])

  const stop = () => {
    setRunning(false)
    setIndex(-1)
    try { audioRef.current?.pause() } catch {}
    setPaused(false)
    clearCountTimers()
    stopRaf()
  }

  const pauseResume = () => {
    if (!running || mode !== 'auto' || index < 0) return
    if (!paused) {
      // pause
      const elapsed = performance.now() - lineStartRef.current
      remainingMsRef.current = Math.max(0, secsPerLine * 1000 - elapsed)
      if (timerRef.current) clearTimeout(timerRef.current)
      try { audioRef.current?.pause() } catch {}
      setPaused(true)
      stopRaf()
    } else {
      // resume
      lineStartRef.current = performance.now() - (secsPerLine * 1000 - remainingMsRef.current)
      timerRef.current = setTimeout(() => setIndex((i) => i + 1), remainingMsRef.current)
      try { if (beatUrl) audioRef.current?.play().catch(()=>{}) } catch {}
      setPaused(false)
      startRaf()
    }
  }

  // If mode switches, reset timers appropriately to prevent stale schedules
  useEffect(() => {
    // Stop any scheduled next-line when changing mode
    if (timerRef.current) clearTimeout(timerRef.current)
    stopRaf()
    setProgress(0)
    // In manual mode we don't auto-advance; keep current index
    // In auto mode, if running and not paused, restart RAF for progress
    if (running && !paused && mode === 'auto' && index >= 0 && index < lines.length) {
      lineStartRef.current = performance.now()
      startRaf()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === ' ') {
        e.preventDefault()
        if (!running) start(); else if (mode === 'auto') pauseResume();
      }
      if (mode === 'manual' && running) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)) }
        if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(i => Math.min(lines.length, i + 1)) }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [running, mode, lines.length])

  // Tap tempo to estimate secs/line
  const tap = () => {
    const t = performance.now()
    const arr = tapsRef.current
    if (arr.length && t - arr[arr.length - 1] > 3000) arr.length = 0
    arr.push(t)
    if (arr.length >= 2) {
      const deltas = arr.slice(1).map((v, i) => v - arr[i])
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
      onSecsPerLine(parseFloat((avg / 1000).toFixed(2)))
    }
  }

  const current = index >= 0 && index < lines.length ? lines[index] : (index < 0 ? 'Get ready…' : 'Done!')
  const next = index + 1 < lines.length ? lines[index + 1] : ''
  const hideAutoControls = running && mode === 'auto'

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur overscroll-contain">
      <div className="absolute inset-0 p-4 md:p-6 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm text-white/60">Rap Mode</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <label className="text-xs text-white/70">Mode
              <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="ml-2 text-xs bg-black/40 border border-white/10 rounded px-2 py-1">
                <option value="auto">Line by line</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            {!hideAutoControls && (
              <>
                <label className="text-xs text-white/70">Secs/Line
                  <input type="range" min={1} max={8} step={0.5} value={secsPerLine} onChange={(e) => onSecsPerLine(parseFloat(e.target.value))} className="ml-2 align-middle" />
                  <span className="ml-2 tabular-nums">{secsPerLine.toFixed(1)}s</span>
                </label>
                <button type="button" onClick={tap} className="text-xs rounded border border-white/10 bg-white/5 hover:bg-white/10 px-2 py-1">Tap</button>
                <label className="text-xs text-white/70 ml-4">Count-in Bars
                  <input type="number" min={0} max={8} value={countInBars} onChange={(e) => onCountInBars(parseInt(e.target.value||'0'))} className="ml-2 w-14 bg-black/40 border border-white/10 rounded px-2 py-1" />
                </label>
                <label className="text-xs text-white/70 ml-2 inline-flex items-center gap-2">
                  <input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} />
                  Metronome
                </label>
                <label className="text-xs text-white/70 ml-4">Text Size
                  <input type="range" min={0.8} max={1.6} step={0.05} value={fontScale} onChange={(e) => setFontScale(parseFloat(e.target.value))} className="ml-2 align-middle" />
                  <span className="ml-2 tabular-nums">{fontScale.toFixed(2)}x</span>
                </label>
                <label className="text-xs text-white/70 ml-2">Line Height
                  <input type="range" min={1.0} max={2.0} step={0.05} value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="ml-2 align-middle" />
                  <span className="ml-2 tabular-nums">{lineHeight.toFixed(2)}</span>
                </label>
              </>
            )}
            <select value={align} onChange={(e) => setAlign(e.target.value as any)} className="ml-2 text-xs bg-black/40 border border-white/10 rounded px-2 py-1">
              <option value="center">Center</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
            <button onClick={onClose} className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm">Close</button>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center select-none overflow-y-auto">
          {beatUrl && (
            <audio ref={audioRef} src={beatUrl} preload="auto" className="hidden" />
          )}
          <div className="text-center w-full px-4 max-w-4xl mx-auto">
            {mode === 'auto' && index >= 0 && index < lines.length && (
              <div className="h-1 w-full bg-white/10 rounded overflow-hidden mb-4">
                <div className="h-full bg-[var(--neon)]" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <div
              className="font-bold text-white mb-8 min-h-[3em] break-words"
              style={{ fontSize: `calc(${fontScale} * 2.2rem)`, lineHeight, textAlign: align as any, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' as any }}
            >
              {current}
            </div>
            <div className="text-white/50 h-6 break-words" style={{ fontSize: `calc(${fontScale} * 1.2rem)`, textAlign: align as any, wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' as any }}>{next}</div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 pt-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {!running ? (
            <button onClick={start} className="rounded-xl bg-[var(--neon)] text-black font-semibold px-4 py-2">Start</button>
          ) : (
            <>
              {mode === 'manual' && (
                <>
                  <button onClick={() => setIndex((i) => Math.max(0, i - 1))} className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2">Prev</button>
                  <button onClick={() => setIndex((i) => Math.min(lines.length, i + 1))} className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2">Next</button>
                </>
              )}
              {mode === 'auto' && (
                <button onClick={pauseResume} className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2">{paused ? 'Resume' : 'Pause'}</button>
              )}
              <button onClick={stop} className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2">Stop</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
