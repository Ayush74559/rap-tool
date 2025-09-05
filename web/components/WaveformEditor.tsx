"use client"
import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RegionsPlugin: any = require('wavesurfer.js/dist/plugins/regions.esm.js')

export type WaveformEditorProps = {
  url: string
  height?: number
  onReady?: (ws: WaveSurfer) => void
  onSelect?: (region: { id: string; start: number; end: number } | null) => void
}

export default function WaveformEditor({ url, height = 80, onReady, onSelect }: WaveformEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<any>(null)
  const selectionRef = useRef<string | null>(null)

  // Suppress noisy AbortError from aborted fetches when components unmount or URLs change
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e.reason
      const name = reason?.name || reason
      if (name === 'AbortError' || String(reason).includes('AbortError')) {
        e.preventDefault()
      }
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    if (typeof url !== 'string' || !url) return

  const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(255,255,255,0.5)',
      progressColor: '#39FF14',
      cursorColor: '#39FF14',
      height,
      normalize: true,
      barWidth: 2,
    })

    ws.on('ready', () => onReady?.(ws))
    ws.on('error', (err) => console.error('WaveSurfer error:', err))
    // regions events
    // Register regions plugin and wire events
    const regions = ws.registerPlugin(RegionsPlugin.create({ dragSelection: true }))
    regionsRef.current = regions
    if (regionsRef.current) {
      regionsRef.current.on('region-created', (r: any) => {
        selectionRef.current = r.id
        onSelect?.({ id: r.id, start: r.start, end: r.end })
      })
      regionsRef.current.on('region-updated', (r: any) => {
        if (selectionRef.current === r.id) onSelect?.({ id: r.id, start: r.start, end: r.end })
      })
      regionsRef.current.on('region-removed', (r: any) => {
        if (selectionRef.current === r.id) {
          selectionRef.current = null
          onSelect?.(null)
        }
      })
    }

    ws.load(url)
    wsRef.current = ws

    return () => {
      try {
        // Clear regions and listeners first
        try { regionsRef.current?.clear?.() } catch {}
        ws.unAll()
        // Avoid calling destroy() which can trigger AbortError in some SSR/dev cases
        ws.stop?.()
      } catch {}
      if (wsRef.current === ws) wsRef.current = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [url, height, onReady])

  return (
    <div className="w-full">
      <div ref={containerRef} />
      <div className="mt-2 flex gap-2">
        <button onClick={() => wsRef.current?.playPause()} className="rounded px-3 py-1 bg-white/10 hover:bg-white/20">Play/Pause</button>
        <button onClick={() => wsRef.current?.stop()} className="rounded px-3 py-1 bg-white/10 hover:bg-white/20">Stop</button>
        <button onClick={() => {
          // create a region at current time with small default width if none exists
          const rp = regionsRef.current
          const ws = wsRef.current
          if (!rp || !ws) return
          const time = ws.getCurrentTime?.() ?? 0
          const existing = selectionRef.current && rp.regions?.[selectionRef.current]
          if (existing) return
          const end = Math.min(time + 1, ws.getDuration?.() ?? time + 1)
          const reg = rp.addRegion({ start: time, end, color: 'rgba(57,255,20,0.15)' })
          selectionRef.current = reg?.id ?? null
          if (reg) onSelect?.({ id: reg.id, start: reg.start, end: reg.end })
        }} className="rounded px-3 py-1 bg-white/10 hover:bg-white/20">Select</button>
        <button onClick={() => {
          // remove current selection
          const rp = regionsRef.current
          if (!rp || !selectionRef.current) return
          try { rp.removeRegion(selectionRef.current) } catch {}
          selectionRef.current = null
          onSelect?.(null)
        }} className="rounded px-3 py-1 bg-white/10 hover:bg-white/20">Clear</button>
      </div>
    </div>
  )
}
