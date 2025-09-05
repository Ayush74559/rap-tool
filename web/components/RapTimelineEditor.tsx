"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import WaveSurfer from 'wavesurfer.js'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RegionsPlugin: any = require('wavesurfer.js/dist/plugins/regions.esm.js')
import { useTimeline, type TrackModel, type Clip } from '../hooks/useTimeline'
import { useBeatAnalysis } from '../hooks/useBeatAnalysis'
import { api } from '@/lib/api'

type Props = {
  beat?: { url: string; path?: string }
  vocals?: Array<{ url: string; path?: string }>
}

export default function RapTimelineEditor({ beat, vocals }: Props) {
  const tl = useTimeline({ bpm: 140, zoom: 100, tracks: [] })
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [grid, setGrid] = useState<'1/4' | '1/2' | '1'>('1/4')
  const analysis = useBeatAnalysis(beat?.url)

  // bootstrap tracks
  useEffect(() => {
    if (tl.tracks.length === 0) {
      const beatId = tl.addTrack('beat', 'Beat')
      const voxId = tl.addTrack('vocal', 'Vocals')
      tl.addTrack('adlib', 'Adlibs')
      if (beat?.url) tl.addClip(beatId, { url: beat.url, path: beat.path, start: 0, duration: 60, offset: 0, gain: 1 })
      if (vocals && vocals[0]?.url) tl.addClip(voxId, { url: vocals[0].url, path: vocals[0].path, start: tl.beatsToSeconds(4), duration: 16, offset: 0, gain: 1 })
    }
    setReady(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When beat analysis completes, update bpm/drop and bar markers
  useEffect(() => {
    if (!analysis || analysis.loading) return
    if (analysis.bpm && Math.abs(analysis.bpm - tl.bpm) > 1) tl.setBpm(analysis.bpm)
    if (analysis.dropSec != null) tl.setDropSec(analysis.dropSec)
  }, [analysis.loading])

  // Server-side analyze for BPM/Key when path is available
  useEffect(() => {
    const run = async () => {
      try {
        if (!beat?.path) return
        const { data } = await api.post('/analyze/audio', { filePath: beat.path })
        if (typeof data?.result?.bpm === 'number') tl.setBpm(data.result.bpm)
        // key/scale available as data.result.key/scale; can be surfaced in UI later
      } catch (e) { console.warn('analyze/audio failed', e) }
    }
    run()
  }, [beat?.path])

  // Auto-align vocal clips to drop or downbeat when added or when toggles change
  useEffect(() => {
    if (!tl.tracks.length) return
    if (!tl.syncToDrop && !tl.quantizeVocals) return
    const voxTracks = tl.tracks.filter(t => t.kind === 'vocal' || t.kind === 'adlib')
    voxTracks.forEach(t => {
      t.clips.forEach(c => {
        let start = c.start
        if (tl.syncToDrop && tl.dropSec != null) {
          // Snap start to drop or nearest downbeat
          const down = tl.snap(tl.dropSec, '1')
          start = down
        }
        if (tl.quantizeVocals) {
          start = tl.snap(start, '1/4')
        }
        if (start !== c.start) tl.updateClip(t.id, c.id, { start })
      })
    })
  }, [tl.syncToDrop, tl.quantizeVocals, tl.dropSec, tl.bpm])

  // Keyboard: Space = Play/Pause, Left/Right seek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); tl.playing ? tl.pause() : tl.play() }
      if (e.code === 'ArrowLeft') { e.preventDefault(); tl.seek(Math.max(0, tl.currentTime - 1)) }
      if (e.code === 'ArrowRight') { e.preventDefault(); tl.seek(tl.currentTime + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tl])

  return (
    <div className="w-full">
      <TransportControls bpm={tl.bpm} setBpm={tl.setBpm} playing={tl.playing} onPlay={tl.play} onPause={tl.pause} onSeek={tl.seek} cur={tl.currentTime} loop={tl.loop} setLoop={tl.setLoop} zoom={tl.zoom} setZoom={tl.setZoom} grid={grid} setGrid={setGrid} syncToDrop={!!tl.syncToDrop} setSyncToDrop={tl.setSyncToDrop} quantizeVocals={!!tl.quantizeVocals} setQuantizeVocals={tl.setQuantizeVocals} />
  <div className="relative mt-3 rounded-xl border border-white/10 bg-black/40 overflow-hidden">
        <Ruler bpm={tl.bpm} zoom={tl.zoom} cur={tl.currentTime} onSeek={tl.seek} dropSec={tl.dropSec} />
        <div ref={containerRef} className="max-h-[46vh] overflow-auto">
          {tl.tracks.map((t: TrackModel) => (
    <TrackRow key={t.id} track={t} zoom={tl.zoom} cur={tl.currentTime} onSeek={tl.seek} onUpdateClip={(cid, patch) => tl.updateClip(t.id, cid, patch)} onDeleteClip={(cid) => tl.deleteClip(t.id, cid)} snapSec={(sec) => tl.snap(sec, grid)} bpm={tl.bpm} />
          ))}
          <div className="p-3">
            <button
              onClick={() => tl.addTrack('extra', 'Track')}
              className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm"
            >+ Add Track</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TransportControls({ bpm, setBpm, playing, onPlay, onPause, onSeek, cur, loop, setLoop, zoom, setZoom, grid, setGrid, syncToDrop, setSyncToDrop, quantizeVocals, setQuantizeVocals }: { bpm: number; setBpm: (n: number) => void; playing: boolean; onPlay: () => void; onPause: () => void; onSeek: (t: number) => void; cur: number; loop: { enabled: boolean; start: number; end: number }; setLoop: (v: any) => void; zoom: number; setZoom: (n: number) => void; grid: '1/4' | '1/2' | '1'; setGrid: (g: '1/4' | '1/2' | '1') => void; syncToDrop: boolean; setSyncToDrop: (b: boolean) => void; quantizeVocals: boolean; setQuantizeVocals: (b: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={() => (playing ? onPause() : onPlay())} className="rounded-lg bg-[var(--neon)] text-black px-3 py-1 font-semibold">{playing ? 'Pause' : 'Play'}</button>
      <button onClick={() => onSeek(0)} className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1">Stop</button>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">BPM</label>
        <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value) || 120)} className="w-16 rounded bg-black/50 border border-white/10 px-2 py-1" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Zoom</label>
        <input type="range" min={40} max={240} value={zoom} onChange={e => setZoom(Number(e.target.value))} />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Loop</label>
        <input type="checkbox" checked={loop.enabled} onChange={e => setLoop({ ...loop, enabled: e.target.checked })} />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Snap</label>
        <select value={grid} onChange={e => setGrid(e.target.value as any)} className="rounded bg-black/50 border border-white/10 px-2 py-1">
          <option value="1/4">1/4</option>
          <option value="1/2">1/2</option>
          <option value="1">1</option>
        </select>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!syncToDrop} onChange={e => setSyncToDrop(e.target.checked)} /> Sync to Drop</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!quantizeVocals} onChange={e => setQuantizeVocals(e.target.checked)} /> Quantize Vocals</label>
      </div>
      <div className="text-xs opacity-70">{cur.toFixed(2)}s</div>
    </div>
  )
}

function Ruler({ bpm, zoom, cur, onSeek, dropSec }: { bpm: number; zoom: number; cur: number; onSeek: (t: number) => void; dropSec?: number }) {
  const bars = useMemo(() => 64, [])
  const barSec = 60 / bpm * 4
  return (
    <div className="relative h-8 select-none border-b border-white/10 bg-black/60">
      <div className="relative" style={{ width: bars * barSec * zoom }}>
        {Array.from({ length: bars }).map((_, i) => (
          <div key={i} className="absolute top-0 h-8 border-l border-white/10 text-[10px] text-white/70" style={{ left: i * barSec * zoom }}>
            <div className="pl-1">{i + 1}</div>
          </div>
        ))}
        {dropSec != null && (
          <div className="absolute top-0 bottom-0 w-[2px] bg-red-400 shadow-[0_0_10px_rgba(255,0,0,0.8)]" title="Beat Drop" style={{ left: dropSec * zoom }} />
        )}
        <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--neon)] shadow-[0_0_12px_var(--neon)]" style={{ left: cur * zoom }} />
        <div className="absolute inset-0" onMouseDown={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const x = e.clientX - rect.left
          onSeek(x / zoom)
        }} />
      </div>
    </div>
  )
}

function TrackRow({ track, zoom, cur, onSeek, onUpdateClip, onDeleteClip, snapSec, bpm }: { track: TrackModel; zoom: number; cur: number; onSeek: (t: number) => void; onUpdateClip: (clipId: string, patch: Partial<Clip>) => void; onDeleteClip: (clipId: string) => void; snapSec: (sec: number) => number; bpm: number }) {
  return (
    <div className="flex border-b border-white/10">
      <div className="w-36 shrink-0 p-2 text-sm border-r border-white/10">
        <div className="font-semibold">{track.name}</div>
        <div className="mt-2 flex items-center gap-1 text-xs">
          <button className="rounded bg-white/10 px-2 py-0.5">M</button>
          <button className="rounded bg-white/10 px-2 py-0.5">S</button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
    <div className="relative h-20">
          {track.clips.map((c: Clip) => (
            <ClipView key={c.id} clip={c} zoom={zoom} onUpdate={(p) => onUpdateClip(c.id, p)} onDelete={() => onDeleteClip(c.id)} snapSec={snapSec} bpm={bpm} />
          ))}
          <div className="absolute inset-0" onMouseDown={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const x = e.clientX - rect.left
            onSeek(x / zoom)
          }} />
        </div>
      </div>
    </div>
  )
}

function ClipView({ clip, zoom, onUpdate, onDelete, snapSec, bpm }: { clip: Clip; zoom: number; onUpdate: (patch: Partial<Clip>) => void; onDelete: () => void; snapSec: (sec: number) => number; bpm: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<null | { startX: number; origStart: number }>(null)
  const resizing = useRef<null | { startX: number; origDur: number; side: 'L' | 'R' }>(null)

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const w = WaveSurfer.create({
      container: el,
      height: 64,
      waveColor: '#2bcf5c66',
      progressColor: '#2bcf5c',
      cursorWidth: 0,
      interact: false,
      url: clip.url,
      plugins: [RegionsPlugin.create()]
    })
    wsRef.current = w
    return () => { try { w.destroy() } catch {} }
  }, [clip.url])

  // animate position/size
  useEffect(() => {
    const el = ref.current?.parentElement as HTMLDivElement | undefined
    if (!el) return
    const x = clip.start * zoom
    const w = Math.max(clip.duration * zoom, 12)
    gsap.to(el, { x, width: w, duration: 0.15, ease: 'power2.out' })
  }, [clip.start, clip.duration, zoom])

  return (
    <div className="absolute top-2 bottom-2" style={{ left: 0 }}>
      <div className="absolute inset-0 rounded border border-[var(--neon)]/40 bg-[var(--neon)]/10 overflow-hidden">
        <div ref={ref} className="h-full" />
        <div ref={leftRef} className="absolute left-0 top-0 bottom-0 w-1.5 bg-white/10 cursor-col-resize" onMouseDown={(e) => {
          e.stopPropagation()
          resizing.current = { startX: e.clientX, origDur: clip.duration, side: 'L' }
          const move = (ev: MouseEvent) => {
            const dx = ev.clientX - (resizing.current!.startX)
            const dt = dx / zoom
            let nextStart = clip.start + dt
            if (!ev.shiftKey) nextStart = snapSec(nextStart)
            const nextDur = clip.duration - dt
            if (nextDur > 0.1) onUpdate({ start: nextStart, duration: nextDur, offset: Math.max(0, (clip.offset || 0) + dt) })
          }
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); resizing.current = null }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }} />
        <div ref={rightRef} className="absolute right-0 top-0 bottom-0 w-1.5 bg-white/10 cursor-col-resize" onMouseDown={(e) => {
          e.stopPropagation()
          resizing.current = { startX: e.clientX, origDur: clip.duration, side: 'R' }
          const move = (ev: MouseEvent) => {
            const dx = ev.clientX - (resizing.current!.startX)
            const dt = dx / zoom
            let nextDur = Math.max(0.1, clip.duration + dt)
            if (!ev.shiftKey) {
              const snappedEnd = snapSec(clip.start + nextDur)
              nextDur = Math.max(0.1, snappedEnd - clip.start)
            }
            onUpdate({ duration: nextDur })
          }
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); resizing.current = null }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }} />
        <div className="absolute inset-0 cursor-grab active:cursor-grabbing" onMouseDown={(e) => {
          dragging.current = { startX: e.clientX, origStart: clip.start }
          const move = (ev: MouseEvent) => {
            const dx = ev.clientX - (dragging.current!.startX)
            const dt = dx / zoom
            let nextStart = Math.max(0, dragging.current!.origStart + dt)
            if (!ev.shiftKey) nextStart = snapSec(nextStart)
            onUpdate({ start: nextStart })
          }
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); dragging.current = null }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }} />
        <div className="absolute right-1 bottom-0.5 flex gap-1 text-[10px] opacity-80">
          <button className="rounded bg-black/40 px-1" onClick={onDelete}>Del</button>
          <NudgeControls bpm={bpm} onNudge={(ms) => {
            const dt = ms / 1000
            onUpdate({ start: Math.max(0, snapSec(clip.start + dt)) })
          }} />
        </div>
      </div>
    </div>
  )
}

// (removed: SyncQuantizeGroup – now controlled via TransportControls props)

function NudgeControls({ onNudge, bpm }: { onNudge: (ms: number) => void; bpm: number }) {
  return (
    <div className="flex gap-1">
      <button className="rounded bg-black/40 px-1" title="Nudge -10ms" onClick={() => onNudge(-10)}>−10ms</button>
      <button className="rounded bg-black/40 px-1" title="Nudge +10ms" onClick={() => onNudge(10)}>+10ms</button>
  <button className="rounded bg-black/40 px-1" title="Nudge -1 beat" onClick={() => onNudge(-(60 / bpm) * 1000)}>−1 beat</button>
  <button className="rounded bg-black/40 px-1" title="Nudge +1 beat" onClick={() => onNudge((60 / bpm) * 1000)}>+1 beat</button>
    </div>
  )
}
