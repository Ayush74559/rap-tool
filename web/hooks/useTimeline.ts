import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ClipFX = {
  enabled: { autotune?: boolean; noise?: boolean; eq?: boolean; comp?: boolean; reverb?: boolean; delay?: boolean }
  eq?: { low: number; mid: number; high: number }
  comp?: { thresh: number; ratio: number; gain: number }
  reverb?: number
  delay?: number
  autotune?: { key: string; scale: string; strength: number; retune: number }
}

export type Clip = {
  id: string
  url: string
  path?: string
  start: number // seconds from timeline start
  duration: number // seconds length of clip region (not full file)
  offset?: number // seconds into the source to start
  gain?: number // linear (0..2)
  pan?: number // -1..1
  fadeIn?: number // seconds
  fadeOut?: number // seconds
  fx?: ClipFX
}

export type TrackModel = {
  id: string
  name: string
  kind: 'beat' | 'vocal' | 'adlib' | 'extra'
  muted?: boolean
  solo?: boolean
  clips: Clip[]
}

export type TimelineState = {
  bpm: number
  playing: boolean
  currentTime: number
  loop: { enabled: boolean; start: number; end: number }
  zoom: number // pixels per second
  tracks: TrackModel[]
  dropSec?: number
  syncToDrop?: boolean
  quantizeVocals?: boolean
}

function uid(p: string) {
  return `${p}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
}

export function useTimeline(initial?: Partial<TimelineState>) {
  const [bpm, setBpm] = useState(initial?.bpm || 140)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [loop, setLoop] = useState({ enabled: false, start: 0, end: 8 })
  const [zoom, setZoom] = useState(initial?.zoom || 100) // px/s
  const [tracks, setTracks] = useState<TrackModel[]>(initial?.tracks || [])
  const [dropSec, setDropSec] = useState<number | undefined>(initial?.dropSec)
  const [syncToDrop, setSyncToDrop] = useState<boolean>(initial?.syncToDrop ?? true)
  const [quantizeVocals, setQuantizeVocals] = useState<boolean>(initial?.quantizeVocals ?? false)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)

  const beatsToSeconds = useCallback((beats: number) => (60 / bpm) * beats, [bpm])
  const secondsToBeats = useCallback((sec: number) => (bpm / 60) * sec, [bpm])

  const snap = useCallback((sec: number, grid: '1/4' | '1/2' | '1' = '1/4') => {
    const beat = secondsToBeats(sec)
    const step = grid === '1' ? 1 : grid === '1/2' ? 0.5 : 0.25
    const snappedBeat = Math.round(beat / step) * step
    return beatsToSeconds(snappedBeat)
  }, [beatsToSeconds, secondsToBeats])

  const addTrack = useCallback((kind: TrackModel['kind'], name?: string) => {
    const t: TrackModel = { id: uid('trk'), name: name || kind.toUpperCase(), kind, clips: [] }
    setTracks(prev => [...prev, t])
    return t.id
  }, [])

  const addClip = useCallback((trackId: string, clip: Omit<Clip, 'id'>) => {
    const c: Clip = { id: uid('clip'), ...clip }
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, clips: [...t.clips, c] } : t))
    return c.id
  }, [])

  const updateClip = useCallback((trackId: string, clipId: string, patch: Partial<Clip>) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, clips: t.clips.map(c => c.id === clipId ? { ...c, ...patch } : c) } : t))
  }, [])

  const deleteClip = useCallback((trackId: string, clipId: string) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, clips: t.clips.filter(c => c.id !== clipId) } : t))
  }, [])

  const splitClip = useCallback((trackId: string, clipId: string, atSec: number) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t
      const idx = t.clips.findIndex(c => c.id === clipId)
      if (idx === -1) return t
      const c = t.clips[idx]
      const local = atSec - c.start
      if (local <= 0 || local >= c.duration) return t
      const a: Clip = { ...c, id: uid('clip'), duration: local }
      const b: Clip = { ...c, id: uid('clip'), start: c.start + local, duration: c.duration - local, offset: (c.offset || 0) + local }
      const next = [...t.clips]
      next.splice(idx, 1, a, b)
      return { ...t, clips: next }
    }))
  }, [])

  const barMarkers = useMemo(() => {
    // precompute first 128 bars positions in seconds
    const out: number[] = []
    for (let i = 0; i < 128; i++) out.push(beatsToSeconds(i * 4))
    return out
  }, [beatsToSeconds])

  // transport tick
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return }
    const tick = (ts: number) => {
      if (!lastTickRef.current) lastTickRef.current = ts
      const dt = (ts - lastTickRef.current) / 1000
      lastTickRef.current = ts
      setCurrentTime(prev => {
        let next = prev + dt
        if (loop.enabled && next > loop.end) next = loop.start
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [playing, loop.enabled, loop.start, loop.end])

  const play = useCallback(() => setPlaying(true), [])
  const pause = useCallback(() => setPlaying(false), [])
  const seek = useCallback((t: number) => setCurrentTime(Math.max(0, t)), [])

  return {
    // state
  bpm, setBpm, playing, currentTime, loop, setLoop, zoom, setZoom, tracks, dropSec, setDropSec, syncToDrop, setSyncToDrop, quantizeVocals, setQuantizeVocals,
    // actions
    addTrack, addClip, updateClip, deleteClip, splitClip, play, pause, seek,
    // helpers
    beatsToSeconds, secondsToBeats, snap, barMarkers,
  }
}
