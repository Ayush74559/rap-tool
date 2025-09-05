"use client"
import dynamic from 'next/dynamic'
import type WaveSurfer from 'wavesurfer.js'
import React, { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

const WaveformEditor = dynamic(() => import('./WaveformEditor'), { ssr: false })

type Track = { id: 'beat' | 'vocal'; name: string; url: string; muted?: boolean }

export function Timeline({ beatUrl, vocalUrl, beatPath, vocalPath }: { beatUrl?: string, vocalUrl?: string, beatPath?: string, vocalPath?: string }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [zoom, setZoom] = useState<number>(0)
  const wsMap = useRef<Record<string, WaveSurfer | null>>({})
  const selection = useRef<{ id: string; start: number; end: number } | null>(null)
  const [aligning, setAligning] = useState(false)
  const [loop, setLoop] = useState<boolean>(false)
  const [snap, setSnap] = useState<boolean>(true)
  const [gridDiv, setGridDiv] = useState<number>(4)
  const [bpm, setBpm] = useState<number>(140)
  const [solo, setSolo] = useState<Track['id'] | null>(null)
  const rafRef = useRef<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [clipTaskId, setClipTaskId] = useState<string | null>(null)
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number>(0)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [editMode, setEditMode] = useState<'select' | 'split' | 'trim'>('select')
  const [markers, setMarkers] = useState<number[]>([])

  // Sync tracks with incoming URLs but preserve mute states
  useEffect(() => {
    const next: Track[] = []
    if (beatUrl) {
      const existing = tracks.find(t => t.id === 'beat')
      next.push({ id: 'beat', name: 'Beat', url: beatUrl, muted: existing?.muted ?? false })
    }
    if (vocalUrl) {
      const existing = tracks.find(t => t.id === 'vocal')
      next.push({ id: 'vocal', name: 'Vocal', url: vocalUrl, muted: existing?.muted ?? false })
    }
    setTracks(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatUrl, vocalUrl])

  const applyAll = (fn: (ws: WaveSurfer) => void) => {
    Object.values(wsMap.current).forEach(ws => { if (ws) fn(ws) })
  }

  const toggleMute = (id: Track['id']) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, muted: !t.muted } : t))
    const ws = wsMap.current[id]
    if (ws) ws.setVolume(ws.getVolume() > 0 ? 0 : 1)
  }

  const removeTrack = (id: Track['id']) => {
    setTracks(prev => prev.filter(t => t.id !== id))
    const ws = wsMap.current[id]
    if (ws) { try { ws.destroy() } catch {} }
    wsMap.current[id] = null
  }

  const zoomIn = () => {
    const next = Math.min(zoom + 10, 200)
    setZoom(next)
    applyAll(ws => ws.zoom(next))
  }
  const zoomOut = () => {
    const next = Math.max(zoom - 10, 0)
    setZoom(next)
    applyAll(ws => ws.zoom(next))
  }

  // Helpers: regions plugin accessor per ws
  const getRegions = (ws: any) => ws?.plugins?.regions || ws?.regions || null

  // Propagate selection region to every track as a unified "sel" region
  const setSelectionAll = (start: number, end: number) => {
    const s = Math.max(0, Math.min(start, end))
    const e = Math.max(s + 0.01, Math.max(start, end))
    selection.current = { id: 'sel', start: s, end: e }
    Object.values(wsMap.current).forEach((inst) => {
      if (!inst) return
      const rp: any = getRegions(inst)
      if (!rp) return
      try {
        const existing = rp.regions?.['sel']
        if (existing) {
          existing.update({ start: s, end: e })
        } else {
          rp.addRegion({ id: 'sel', start: s, end: e, color: 'rgba(57,255,20,0.15)' })
        }
      } catch {}
    })
  }

  // Simple markers for split points
  const addMarker = (t: number) => {
    setMarkers(prev => [...prev, t].sort((a,b)=>a-b))
  }

  const clearSelectionAll = () => {
    selection.current = null
    Object.values(wsMap.current).forEach((inst) => {
      const rp: any = getRegions(inst)
      if (!rp) return
      try { if (rp.regions?.['sel']) rp.removeRegion('sel') } catch {}
    })
  }

  const getPrimaryWs = () => wsMap.current['beat'] || wsMap.current['vocal'] || Object.values(wsMap.current).find(Boolean) || null

  const snapTime = (t: number) => {
    if (!snap || !bpm || bpm <= 0) return t
    const spb = 60 / bpm
    const step = spb / Math.max(1, gridDiv)
    return Math.round(t / step) * step
  }

  // Looping watcher
  useEffect(() => {
    if (!loop) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      return
    }
    const jumpTo = (ws: any, t: number) => {
      try {
        if (typeof ws.setTime === 'function') ws.setTime(t)
        else if (typeof ws.seekTo === 'function' && typeof ws.getDuration === 'function') {
          const dur = ws.getDuration() || 1
          ws.seekTo(Math.max(0, Math.min(1, t / dur)))
        }
      } catch {}
    }
    const tick = () => {
      if (selection.current) {
        const { start, end } = selection.current
        Object.values(wsMap.current).forEach(ws => {
          if (!ws) return
          const t = ws.getCurrentTime?.() ?? 0
          if (t >= end - 0.01) {
            try { jumpTo(ws, start); ws.play() } catch {}
          }
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [loop])

  // Track current time and duration for ruler and transport
  useEffect(() => {
    let raf: number | null = null
    const primary = getPrimaryWs() as any
    const run = () => {
      try {
        const d = primary?.getDuration?.() || 0
        const t = primary?.getCurrentTime?.() || 0
        setDuration(d)
        setCurrentTime(t)
      } catch {}
      raf = requestAnimationFrame(run)
    }
    raf = requestAnimationFrame(run)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [tracks.length])

  // Keyboard shortcuts removed with editing UI

  // Solo handling: if a track is soloed, mute all others
  useEffect(() => {
    if (!solo) return
    setTracks(prev => prev.map(t => ({ ...t, muted: t.id !== solo })))
    Object.entries(wsMap.current).forEach(([id, ws]) => {
      if (!ws) return
      ws.setVolume(id === solo ? 1 : 0)
    })
  }, [solo])

  const zoomToSelection = () => {
    const sel = selection.current
    if (!sel) return
    const len = Math.max(0.05, sel.end - sel.start)
    const px = Math.min(200, Math.max(10, Math.round(80 / len)))
    setZoom(px)
    applyAll(ws => ws.zoom(px))
    // seek viewport near selection start
    const primary = getPrimaryWs()
    const dur = primary?.getDuration?.() || 0
    if (primary && dur > 0) {
      try { primary.seekTo(Math.max(0, Math.min(1, sel.start / dur))) } catch {}
    }
  }

  const setIn = () => {
    const ws = getPrimaryWs()
    if (!ws) return
    const t = ws.getCurrentTime?.() ?? 0
    const end = selection.current?.end ?? Math.max(t + 1, t + 0.1)
    const s = snapTime(t)
    setSelectionAll(s, Math.max(s + 0.05, end))
  }
  const setOut = () => {
    const ws = getPrimaryWs()
    if (!ws) return
    const t = ws.getCurrentTime?.() ?? 0
    const start = selection.current?.start ?? Math.max(0, t - 1)
    const e = snapTime(t)
    setSelectionAll(Math.min(start, e - 0.05), e)
  }

  const playSelection = () => {
    const sel = selection.current
    if (!sel) return
    const { start } = sel
    const jumpTo = (ws: any, t: number) => {
      try {
        if (typeof ws.setTime === 'function') ws.setTime(t)
        else if (typeof ws.seekTo === 'function' && typeof ws.getDuration === 'function') {
          const dur = ws.getDuration() || 1
          ws.seekTo(Math.max(0, Math.min(1, t / dur)))
        }
      } catch {}
    }
    applyAll(ws => { jumpTo(ws as any, start); ws.play() })
  }

  const onReadyWave = (id: Track['id']) => (ws: any) => {
    wsMap.current[id] = ws
    if (zoom) ws.zoom(zoom)
    const rp: any = getRegions(ws)
    if (rp) {
      // enable trimming handles by adjusting region visually; functional trimming is via export clip
      rp.on('region-updated', (r: any) => {
        if (r.id === 'sel') {
          selection.current = { id: 'sel', start: r.start, end: r.end }
          setSelectionAll(r.start, r.end)
        }
      })
    }
  }

  const handleExport = async (which: 'both' | 'beat' | 'vocal') => {
    if (!selection.current) { alert('Select a range first'); return }
    if (clipTaskId) return
    const { start, end } = selection.current
    const payload: any = { start, end, params: {} }
    if ((which === 'both' || which === 'beat') && beatPath) payload.beatPath = beatPath
    if ((which === 'both' || which === 'vocal') && vocalPath) payload.vocalPath = vocalPath
    if (!payload.beatPath && !payload.vocalPath) { alert('No source to export'); return }
    try {
      setExporting(true)
      setClipUrl(null)
      const { data } = await api.post('/render/clip', payload)
      setClipTaskId(data.task_id)
    } catch (e) {
      console.error(e)
      setExporting(false)
    }
  }

  // Poll export task
  useEffect(() => {
    if (!clipTaskId) return
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/tasks/${clipTaskId}`)
        if (r.data.state === 'SUCCESS' && r.data.result?.mix_url) {
          setClipUrl(r.data.result.mix_url)
          setExporting(false)
          setClipTaskId(null)
        } else if ([ 'FAILURE', 'REVOKED' ].includes(r.data.state)) {
          setExporting(false)
          setClipTaskId(null)
        }
      } catch {}
    }, 1200)
    return () => clearInterval(t)
  }, [clipTaskId])

  return (
  <div>
      <div className="space-y-3">
        {tracks.map(t => (
          <div key={t.id} className="rounded-xl bg-black/40 border border-white/10 p-3">
            {/* per-track controls */}
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-white/70">{t.name}</div>
              <div className="flex gap-2">
                <ToolButton label={t.muted ? 'Unmute' : 'Mute'} onClick={() => toggleMute(t.id)}>
                  <IconMute />
                </ToolButton>
                <ToolButton label="Delete" variant="danger" onClick={() => removeTrack(t.id)}>
                  <IconTrash />
                </ToolButton>
              </div>
            </div>
            <WaveformEditor url={t.url} height={64} onReady={onReadyWave(t.id)} onSelect={(r) => {
              if (!r) { clearSelectionAll(); return }
              const s = snapTime(r.start)
              const e = snapTime(r.end)
              setSelectionAll(s, e)
            }} />
          </div>
        ))}
        {tracks.length === 0 && (
          <div className="text-white/50 text-sm">Upload a beat and record a vocal to start.</div>
        )}
        {/* Transport and edit controls */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <ToolButton label="Zoom In" onClick={zoomIn}><IconZoomIn /></ToolButton>
          <ToolButton label="Zoom Out" onClick={zoomOut}><IconZoomOut /></ToolButton>
          <ToolButton label="Set In" onClick={setIn}><IconSetIn /></ToolButton>
          <ToolButton label="Set Out" onClick={setOut}><IconSetOut /></ToolButton>
          <ToolButton label="Play Sel" onClick={playSelection}><IconPlaySel /></ToolButton>
          <ToolButton label={loop ? 'Loop On' : 'Loop Off'} onClick={()=>setLoop(!loop)}><IconLoop /></ToolButton>
          <ToolButton label={snap ? 'Snap On' : 'Snap Off'} onClick={()=>setSnap(!snap)}><IconSnap /></ToolButton>
        </div>
        <TimeRuler
          bpm={bpm}
          gridDiv={gridDiv}
          duration={duration}
          currentTime={currentTime}
          markers={markers}
          onSeek={(t)=>{ const primary = getPrimaryWs() as any; try{ primary?.setTime?.(t) }catch{} }}
          onAddMarker={addMarker}
        />
  {/* Editing markers removed */}
  {clipUrl && (
          <div className="rounded-xl bg-black/40 border border-white/10 p-3">
            <div className="text-sm mb-2">Exported Clip</div>
            <audio src={clipUrl} controls className="w-full" />
            <div className="mt-2">
              <a href={clipUrl} download className="rounded bg-white/10 hover:bg-white/20 px-3 py-1">Download</a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// TimeRuler with forwardRef to accept ref prop
type TimeRulerProps = {
  bpm: number
  gridDiv: number
  duration: number
  currentTime: number
  markers: number[]
  onSeek: (time: number) => void
  onAddMarker: (time: number) => void
}

const TimeRuler = React.forwardRef<HTMLDivElement, TimeRulerProps>(function TimeRuler(
  { bpm, gridDiv, duration, currentTime, markers, onSeek, onAddMarker },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Mirror forwarded ref
  useEffect(() => {
    if (!ref) return
    const node = containerRef.current
    if (typeof ref === 'function') ref(node as HTMLDivElement)
    else (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
  }, [ref])

  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setWidth(el.clientWidth))
    obs.observe(el)
    setWidth(el.clientWidth)
    return () => obs.disconnect()
  }, [])

  const beats: { t: number; bar: boolean }[] = []
  if (bpm > 0 && duration > 0) {
    const spb = 60 / bpm
    const step = spb / Math.max(1, gridDiv)
    for (let t = 0, i = 0; t <= duration + 1e-3; t += step, i++) {
      const isBar = (i % (gridDiv * 4) === 0)
      beats.push({ t: Math.min(t, duration), bar: isBar })
    }
  }
  const xFor = (t: number) => width > 0 && duration > 0 ? (t / duration) * width : 0

  return (
    <div ref={containerRef} className="relative w-full h-8 mb-2 rounded border border-white/10 bg-black/30 select-none"
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const x = e.clientX - rect.left
        const t = duration > 0 && width > 0 ? (x / width) * duration : 0
        onSeek(t)
      }}
      onDoubleClick={(e) => {
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
        const x = e.clientX - rect.left
        const t = duration > 0 && width > 0 ? (x / width) * duration : 0
        onAddMarker(t)
      }}
    >
      {beats.map((b, idx) => (
        <div key={idx} className="absolute top-0 bottom-0" style={{ left: `${xFor(b.t)}px`, width: 1, background: b.bar ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)' }} />
      ))}
      {beats.filter(b => b.bar).map((b, idx) => (
        <div key={`lbl-${idx}`} className="absolute text-[10px] text-white/70" style={{ left: `${xFor(b.t) + 2}px`, top: 0 }}>Bar {idx + 1}</div>
      ))}
      {markers.map((m, i) => (
        <div key={`m-${i}`} className="absolute" style={{ left: `${xFor(m)}px`, top: 0 }}>
          <div className="w-0 h-0 border-l-4 border-r-4 border-b-8 border-l-transparent border-r-transparent border-b-[var(--neon)]" />
        </div>
      ))}
      <div className="absolute top-0 bottom-0" style={{ left: `${xFor(currentTime)}px`, width: 1, background: 'var(--neon)' }} />
    </div>
  )
})

function ToolButton({ label, children, title, onClick, variant }: { label: string; children: React.ReactNode; title?: string; onClick?: () => void; variant?: 'default' | 'danger' }) {
  const isDanger = variant === 'danger'
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      onClick={onClick}
      className={
        `group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all `+
        `backdrop-blur shadow-glass focus:outline-none focus:ring-2 focus:ring-[var(--neon)]/60 `+
        `${isDanger ? 'border-red-500/30 bg-red-500/10 hover:bg-red-500/15 text-red-200' : 'border-white/10 bg-white/5 hover:bg-white/10 text-white/90'}`
      }
    >
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${isDanger ? 'text-red-300' : 'text-[var(--neon)]'} group-hover:scale-110 transition-transform`}>
        {children}
      </span>
      <span>{label}</span>
    </button>
  )
}

const IconPlayPause = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
    <rect x="3" y="3" width="4" height="18"></rect>
  </svg>
)
const IconStop = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)
const IconZoomIn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    <line x1="11" y1="8" x2="11" y2="14"></line>
    <line x1="8" y1="11" x2="14" y2="11"></line>
  </svg>
)
const IconZoomOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    <line x1="8" y1="11" x2="14" y2="11"></line>
  </svg>
)
const IconAlign = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18"/>
    <path d="M3 12h10"/>
    <path d="M3 18h18"/>
  </svg>
)
const IconSplit = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v18"/>
    <path d="M3 8c8 0 10 8 18 8"/>
  </svg>
)
const IconMute = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>
)
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
  </svg>
)

const IconRew = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="11 19 2 12 11 5 11 19"></polygon>
    <polygon points="22 19 13 12 22 5 22 19"></polygon>
  </svg>
)
const IconFwd = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="13 19 22 12 13 5 13 19"></polygon>
    <polygon points="2 19 11 12 2 5 2 19"></polygon>
  </svg>
)

const IconLoop = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 11 3 7 7 7"></polyline>
    <path d="M7 7a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H3"></path>
    <polyline points="21 13 21 17 17 17"></polyline>
    <path d="M17 17a5 5 0 0 1-5-5v0a5 5 0 0 1 5-5h4"></path>
  </svg>
)
const IconSnap = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 3h18v18H3z" />
    <path d="M3 9h18M9 3v18" />
  </svg>
)
const IconSetIn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="10 6 4 12 10 18"></polyline>
    <line x1="20" y1="12" x2="4" y2="12"></line>
  </svg>
)
const IconSetOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="14 6 20 12 14 18"></polyline>
    <line x1="4" y1="12" x2="20" y2="12"></line>
  </svg>
)
const IconPlaySel = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="6" width="6" height="12" rx="1" />
    <polygon points="11,6 21,12 11,18" />
  </svg>
)
const IconExport = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12" />
    <path d="M7 8l5-5 5 5" />
    <rect x="4" y="15" width="16" height="6" rx="2" />
  </svg>
)
const IconSolo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="8" />
  </svg>
)
