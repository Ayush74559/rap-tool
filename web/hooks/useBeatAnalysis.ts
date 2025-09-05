import { useCallback, useEffect, useRef, useState } from 'react'

export type BeatAnalysis = {
  bpm: number | null
  key: string | null
  dropSec: number | null
  bars: number[]
  loading: boolean
  error: string | null
}

export function useBeatAnalysis(url?: string) {
  const [state, setState] = useState<BeatAnalysis>({ bpm: null, key: null, dropSec: null, bars: [], loading: false, error: null })
  const abortRef = useRef<AbortController | null>(null)

  const analyze = useCallback(async () => {
    if (!url) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      // Fetch audio as arraybuffer and do a simple energy onset to estimate drop
      const resp = await fetch(url, { signal: ac.signal })
      const buf = await resp.arrayBuffer()
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuf = await ctx.decodeAudioData(buf.slice(0))
      const ch = audioBuf.getChannelData(0)
      const sr = audioBuf.sampleRate

      // crude bpm: assume 140 unless we detect otherwise later (Tone.js can refine)
      let bpm = 140
      // onset detection: compute short-time energy and first large increase after 1s
      const win = Math.floor(0.02 * sr)
      let prevE = 0
      let dropIdx: number | null = null
      for (let i = win; i < ch.length; i += win) {
        let e = 0
        for (let j = i - win; j < i; j++) { const v = ch[j] || 0; e += v * v }
        e = Math.sqrt(e / win)
        if (i > sr * 1.0 && e > prevE * 3 && e > 0.05) { dropIdx = i; break }
        prevE = 0.9 * prevE + 0.1 * e
      }
      const dropSec = dropIdx ? dropIdx / sr : 0
      const bars: number[] = []
      const barSec = (60 / bpm) * 4
      for (let b = 0; b < 128; b++) bars.push(b * barSec)
      setState({ bpm, key: null, dropSec, bars, loading: false, error: null })
      try { ctx.close() } catch {}
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setState(s => ({ ...s, loading: false, error: e?.message || 'analysis failed' }))
    }
  }, [url])

  useEffect(() => { analyze() }, [analyze])

  return { ...state, refresh: analyze }
}
