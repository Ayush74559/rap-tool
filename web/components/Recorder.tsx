"use client"
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { UploadedMeta } from './AudioUploader'
import dynamic from 'next/dynamic'

const WaveformEditor = dynamic(() => import('./WaveformEditor'), { ssr: false })

type TakeMeta = UploadedMeta & { _blob?: Blob; _local?: boolean }

export default function Recorder({ onRecorded, beatUrl, bpm }: { onRecorded: (meta: UploadedMeta) => void; beatUrl?: string; bpm?: number }) {
  const [recording, setRecording] = useState(false)
  const [recError, setRecError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState<boolean>(true)
  const [takes, setTakes] = useState<TakeMeta[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const beatAudioRef = useRef<HTMLAudioElement | null>(null)
  const chosenTypeRef = useRef<string | null>(null)
  const [countInBars, setCountInBars] = useState<number>(1)
  const [metronome, setMetronome] = useState<boolean>(true)
  const [offsetMs, setOffsetMs] = useState<number>(0)
  const [level, setLevel] = useState<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const meterRAF = useRef<number | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const [monitor, setMonitor] = useState<boolean>(false)
  const [beatVol, setBeatVol] = useState<number>(0.8)
  const [metroVol, setMetroVol] = useState<number>(0.5)
  const [autoBars, setAutoBars] = useState<number>(0) // 0 = off
  const metroGainRef = useRef<GainNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)
  const autoStopTimerRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState<number>(0)
  const [barsElapsed, setBarsElapsed] = useState<number>(0)
  const [levelDb, setLevelDb] = useState<number>(-96)
  const [clipping, setClipping] = useState<boolean>(false)
  const levelHistRef = useRef<number[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [gate, setGate] = useState<number>(-55) // dB gate for monitor
  const [enhancing, setEnhancing] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let active = true
  ;(async () => {
      try {
        if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
          setIsSupported(false)
          return
        }
        // Pick best supported mime type
        const candidates = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/mpeg',
          'audio/ogg;codecs=opus',
          'audio/ogg',
        ]
        const pick = candidates.find(t => (window as any).MediaRecorder?.isTypeSupported?.(t)) || null
        chosenTypeRef.current = pick

        // enumerate devices for user selection
        try {
          const list = await navigator.mediaDevices.enumerateDevices()
          setDevices(list.filter(d => d.kind === 'audioinput'))
        } catch {}
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId || undefined } as any })
        if (!active) { s.getTracks().forEach(t => t.stop()); return }
        streamRef.current = s
        // Setup level meter
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
          audioCtxRef.current = ctx
          const source = ctx.createMediaStreamSource(s)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          source.connect(analyser)
          // Optional monitoring route to speakers
          const mGain = ctx.createGain()
          mGain.gain.value = 0
          try { source.connect(mGain).connect(ctx.destination) } catch {}
          monitorGainRef.current = mGain
          sourceRef.current = source
          analyserRef.current = analyser
          const data = new Uint8Array(analyser.fftSize)
          const loop = () => {
            analyser.getByteTimeDomainData(data)
            // Compute simple peak
            let peak = 0
            let sum = 0
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128
              peak = Math.max(peak, Math.abs(v))
              sum += v * v
            }
            setLevel(peak)
            const rms = Math.sqrt(sum / data.length)
            const db = 20 * Math.log10(Math.max(1e-6, rms))
            setLevelDb(Math.max(-96, Math.min(0, db)))
            setClipping(peak > 0.98)
            // noise gate for monitoring
            try {
              if (monitorGainRef.current) {
                const open = db > gate
                const target = monitor && open ? 1 : 0
                const now = audioCtxRef.current?.currentTime || 0
                monitorGainRef.current.gain.cancelScheduledValues(now)
                monitorGainRef.current.gain.setTargetAtTime(target, now, 0.03)
              }
            } catch {}
            // Keep short history of RMS for sparkline
            const hist = levelHistRef.current
            hist.push(rms)
            if (hist.length > 48) hist.shift()
            meterRAF.current = requestAnimationFrame(loop)
          }
          meterRAF.current = requestAnimationFrame(loop)
        } catch {}
      } catch (e) { console.error(e) }
    })()
    return () => {
      active = false
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      if (meterRAF.current) cancelAnimationFrame(meterRAF.current)
      try { audioCtxRef.current?.close() } catch {}
    }
  }, [])

  // React to monitor toggle
  useEffect(() => {
    try {
      const ctx = audioCtxRef.current
      if (ctx && ctx.state !== 'running') ctx.resume?.()
      if (!monitorGainRef.current && audioCtxRef.current && sourceRef.current) {
        const g = audioCtxRef.current.createGain()
        g.gain.value = monitor ? 1 : 0
        try { sourceRef.current.connect(g).connect(audioCtxRef.current.destination) } catch {}
        monitorGainRef.current = g
      } else if (monitorGainRef.current) {
        monitorGainRef.current.gain.value = monitor ? 1 : 0
      }
    } catch {}
  }, [monitor])

  // Re-init stream when device selection changes
  useEffect(() => {
    let cancelled = false
    const reinit = async () => {
      try {
        // stop old
        try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
        if (meterRAF.current) cancelAnimationFrame(meterRAF.current)
        try { await audioCtxRef.current?.close() } catch {}
        audioCtxRef.current = null
        analyserRef.current = null
        monitorGainRef.current = null

        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId || undefined } as any })
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        streamRef.current = s
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(s)
        sourceRef.current = source
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        const mGain = ctx.createGain()
        mGain.gain.value = 0
        try { source.connect(mGain).connect(ctx.destination) } catch {}
        monitorGainRef.current = mGain
        analyserRef.current = analyser
        const data = new Uint8Array(analyser.fftSize)
        const loop = () => {
          analyser.getByteTimeDomainData(data)
          let peak = 0, sum = 0
          for (let i = 0; i < data.length; i++) { const v = (data[i]-128)/128; peak = Math.max(peak, Math.abs(v)); sum += v*v }
          setLevel(peak)
          const rms = Math.sqrt(sum / data.length)
          const db = 20 * Math.log10(Math.max(1e-6, rms))
          setLevelDb(Math.max(-96, Math.min(0, db)))
          setClipping(peak > 0.98)
          const hist = levelHistRef.current; hist.push(rms); if (hist.length > 48) hist.shift()
          const open = db > gate
          try { const now = ctx.currentTime; monitorGainRef.current!.gain.setTargetAtTime((monitor && open) ? 1 : 0, now, 0.03) } catch {}
          meterRAF.current = requestAnimationFrame(loop)
        }
        meterRAF.current = requestAnimationFrame(loop)
      } catch (e) { console.error(e) }
    }
    reinit()
    return () => { cancelled = true }
  }, [deviceId, gate, monitor])

  // Track elapsed time and bars while recording
  useEffect(() => {
    if (!recording) { setElapsed(0); setBarsElapsed(0); return }
    const startTs = performance.now()
    let raf: number | null = null
    const tick = () => {
      const ms = performance.now() - startTs
      const sec = ms / 1000
      setElapsed(sec)
      const useBpm = Math.max(1, bpm || 140)
      const spb = 60 / useBpm
      setBarsElapsed((sec / (spb * 4)))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [recording, bpm])

  const start = async () => {
    if (!streamRef.current || recording) return
    if (!isSupported) { setRecError('Recording not supported in this browser.'); return }
    setRecError(null)
    const offsetSec = Math.max(0, offsetMs / 1000)
    // Optional count-in with metronome clicks
    const doCountIn = async () => {
      const useBpm = Math.max(40, Math.min(240, bpm || 140))
      const spb = 60 / useBpm
      if (!metronome || countInBars <= 0) return Promise.resolve()
      try {
        const ctx = audioCtxRef.current || new (window.AudioContext || (window as any).webkitAudioContext)()
        if (!audioCtxRef.current) audioCtxRef.current = ctx
        const bars = countInBars
        const beats = bars * 4
        const startAt = ctx.currentTime + 0.05
        for (let i = 0; i < beats; i++) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'square'
          osc.frequency.value = (i % 4 === 0) ? 1400 : 1000
          gain.gain.value = 0.0001
          osc.connect(gain).connect(ctx.destination)
          const t0 = startAt + i * spb
          gain.gain.setValueAtTime(0.0001, t0)
          gain.gain.linearRampToValueAtTime(0.4, t0 + 0.005)
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08)
          osc.start(t0)
          osc.stop(t0 + 0.12)
        }
        // wait for count-in to finish
        await new Promise(res => setTimeout(res, Math.round(beats * spb * 1000)))
      } catch {}
    }
    await doCountIn()
    // Start beat with latency offset if provided
    try {
      if (beatUrl) {
        beatAudioRef.current!.currentTime = offsetSec
        beatAudioRef.current!.volume = Math.max(0, Math.min(1, beatVol))
        await beatAudioRef.current?.play()?.catch(()=>{})
      }
    } catch {}
    const opts: MediaRecorderOptions = {}
    if (chosenTypeRef.current) opts.mimeType = chosenTypeRef.current as any
    const rec = new MediaRecorder(streamRef.current, opts)
    mediaRecorderRef.current = rec
    chunksRef.current = []
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      try { beatAudioRef.current?.pause() } catch {}
      try { if (metroGainRef.current) metroGainRef.current.gain.value = 0 } catch {}
      if (autoStopTimerRef.current) { try { clearTimeout(autoStopTimerRef.current) } catch {}; autoStopTimerRef.current = null }
      const blobType = chosenTypeRef.current || (chunksRef.current[0] && (chunksRef.current[0] as any).type) || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: blobType })
      chunksRef.current = []
      const form = new FormData()
      const ext = blobType.includes('mp4') ? 'm4a' : blobType.includes('mpeg') ? 'mp3' : blobType.includes('ogg') ? 'ogg' : 'webm'
      form.append('file', blob, `take.${ext}`)
      try {
        const { data } = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
        const uploaded: TakeMeta = { ...data }
        // Auto trim + normalize on server
        let finalMeta: TakeMeta = uploaded
        try {
          const t = await api.post('/trim', { vocalPath: uploaded.path, autoTrim: true, normalize: true })
          const taskId = t.data?.task_id
          if (taskId) {
            for (let i = 0; i < 40; i++) {
              const r = await api.get(`/tasks/${taskId}`)
              if (r.data?.state === 'SUCCESS' && (r.data?.result?.trimmed_url || r.data?.result?.trimmed_path)) {
                const url = r.data.result.trimmed_url || uploaded.url
                const path = r.data.result.trimmed_path || uploaded.path
                finalMeta = { url, path, filename: uploaded.filename }
                break
              }
              await new Promise(res => setTimeout(res, 700))
            }
          }
        } catch {}
        setTakes(prev => [finalMeta, ...prev])
        onRecorded(finalMeta)
      } catch (e) {
        console.error(e)
        setRecError('Upload failed. Please check API is running on 4000 and try again.')
        const url = URL.createObjectURL(blob)
        const fallback: TakeMeta = { url, path: url, filename: `take.${ext}` , _blob: blob, _local: true }
        setTakes(prev => [fallback, ...prev])
  // Not calling onRecorded here to avoid blob paths in mix; user can save this take to server below
      }
    }
    // Auto-stop after N bars (if set)
    if (autoBars && bpm) {
      const useBpm = Math.max(40, Math.min(240, bpm || 140))
      const spb = 60 / useBpm
      const ms = Math.round(autoBars * 4 * spb * 1000)
      autoStopTimerRef.current = window.setTimeout(() => { try { mediaRecorderRef.current?.stop() } catch {} }, ms)
    }
    rec.start()
    setRecording(true)
  }

  const stop = () => {
    if (!recording) return
  try { mediaRecorderRef.current?.stop() } catch {}
  if (autoStopTimerRef.current) { try { clearTimeout(autoStopTimerRef.current) } catch {}; autoStopTimerRef.current = null }
    setRecording(false)
  }

  const saveToServer = async (i: number) => {
    const t = takes[i]
    try {
      setRecError(null)
      let blob: Blob | null = t._blob || null
      if (!blob) {
        // Fallback: fetch blob from object URL or remote URL
        const res = await fetch(t.url)
        blob = await res.blob()
      }
      const form = new FormData()
      const ext = t.filename.split('.').pop() || 'webm'
      form.append('file', blob!, `take.${ext}`)
      const { data } = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      const next: TakeMeta = { ...data }
      setTakes(prev => prev.map((x, idx) => idx === i ? next : x))
      onRecorded(next)
    } catch (e) {
      console.error(e)
      setRecError('Save failed. Check API and try again.')
    }
  }

  const useTake = async (i: number) => {
    const t = takes[i]
    if (t.path.startsWith('blob:') || t._local) {
      await saveToServer(i)
    } else {
      onRecorded(t)
    }
  }

  const deleteTake = (i: number) => {
    setTakes(prev => prev.filter((_, idx) => idx !== i))
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={recording ? stop : start} className={`rounded-xl px-4 py-2 border border-white/10 ${recording ? 'bg-red-600' : 'bg-white/10 hover:bg-white/15'}`}>
          {recording ? 'Stop' : 'Record'}
        </button>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Mic:
          <select className="rounded bg-black/40 border border-white/10 px-2 py-1"
            value={deviceId || ''}
            onChange={e => setDeviceId(e.target.value || null)}
          >
            <option value="">Default</option>
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,6)}`}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--neon)]" checked={metronome} onChange={e => setMetronome(e.target.checked)} />
          Metronome count-in
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Bars:
          <input type="number" min={0} max={8} value={countInBars} onChange={e => setCountInBars(Math.max(0, Math.min(8, Number(e.target.value)||0)))} className="w-14 rounded bg-black/40 border border-white/10 px-2 py-1" />
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Auto stop (bars):
          <input type="number" min={0} max={64} value={autoBars} onChange={e => setAutoBars(Math.max(0, Math.min(64, Number(e.target.value)||0)))} className="w-16 rounded bg-black/40 border border-white/10 px-2 py-1" />
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Latency (ms):
          <input type="number" step={10} min={-500} max={500} value={offsetMs} onChange={e => setOffsetMs(Math.max(-500, Math.min(500, Number(e.target.value)||0)))} className="w-20 rounded bg-black/40 border border-white/10 px-2 py-1" />
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Beat vol
          <input type="range" min={0} max={1} step={0.05} value={beatVol} onChange={e => setBeatVol(Number(e.target.value))} />
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Metro vol
          <input type="range" min={0} max={1} step={0.05} value={metroVol} onChange={e => setMetroVol(Number(e.target.value))} />
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--neon)]" checked={monitor} onChange={e => setMonitor(e.target.checked)} />
          Monitor (use headphones)
        </label>
        <label className="text-xs text-white/70 flex items-center gap-2">
          Gate
          <input type="range" min={-80} max={-20} step={1} value={gate} onChange={e => setGate(Number(e.target.value))} />
          <span className="tabular-nums">{gate} dB</span>
        </label>
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span>Level</span>
          <div className="h-2 w-40 bg-white/10 rounded overflow-hidden">
            <div className={`h-2 ${clipping ? 'bg-red-400' : 'bg-[var(--neon)]'}`} style={{ width: `${Math.min(100, Math.round(level*100))}%` }} />
          </div>
          <span className="tabular-nums">{levelDb.toFixed(1)} dB</span>
        </div>
        {/* Segmented meter */}
        <div className="flex items-center gap-1">
          {Array.from({ length: 12 }).map((_, i) => {
            const th = (i + 1) / 12
            const on = level >= th * 0.9
            const danger = i >= 10
            return <div key={i} className={`w-1.5 h-6 rounded ${on ? (danger ? 'bg-red-400' : 'bg-[var(--neon)]') : 'bg-white/10'}`} />
          })}
        </div>
        {/* Level sparkline */}
        <div className="flex items-end gap-0.5 h-8">
          {levelHistRef.current.map((r, idx) => (
            <div key={idx} className="w-1 bg-[var(--neon)]/60" style={{ height: `${Math.min(100, Math.round(r*100))}%` }} />
          ))}
        </div>
        <span className="text-xs text-white/60">{recording ? `Rec ${elapsed.toFixed(1)}s · ${barsElapsed.toFixed(2)} bars` : 'Use your mic to capture takes.'}</span>
      </div>
      {!isSupported && (
        <div className="mt-2 text-xs text-red-400">Recording is not supported in this browser. Try Chrome or Edge.</div>
      )}
      {recError && (
        <div className="mt-2 text-xs text-red-400">{recError}</div>
      )}
      <div className="mt-3 space-y-3">
        {takes.map((t, i) => (
          <div key={i} className="rounded-xl bg-black/40 border border-white/10 p-3">
            <div className="flex items-center justify-between mb-2 text-sm">
              <div className="text-white/70 flex items-center gap-2">
                <span>Take {takes.length - i}</span>
                {t._local && <span className="text-amber-300/90 text-xs">local (not uploaded)</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => useTake(i)} className="rounded bg-[var(--neon)]/90 text-black hover:bg-[var(--neon)] px-2 py-1">Use</button>
                {t._local && (
                  <button onClick={() => saveToServer(i)} className="rounded bg-white/10 hover:bg-white/20 border border-white/10 px-2 py-1">Save to server</button>
                )}
                {!t._local && (
                  <button disabled={!!enhancing[i]} onClick={async () => {
                    setEnhancing(prev => ({ ...prev, [i]: true }))
                    try {
                      const { data } = await api.post('/enhance', { vocalPath: t.path })
                      const taskId = data?.task_id
                      if (taskId) {
                        for (let k = 0; k < 40; k++) {
                          const r = await api.get(`/tasks/${taskId}`)
                          if (r.data?.state === 'SUCCESS' && (r.data?.result?.enhanced_url || r.data?.result?.enhanced_path)) {
                            const url = r.data.result.enhanced_url || t.url
                            const path = r.data.result.enhanced_path || t.path
                            const next: TakeMeta = { url, path, filename: t.filename }
                            setTakes(prev => prev.map((x, idx) => idx === i ? next : x))
                            onRecorded(next)
                            break
                          }
                          await new Promise(res => setTimeout(res, 700))
                        }
                      }
                    } catch (e) {
                      console.error(e)
                      setRecError('Enhance failed. Try again.')
                    } finally {
                      setEnhancing(prev => ({ ...prev, [i]: false }))
                    }
                  }} className="rounded bg-white/10 hover:bg-white/20 border border-white/10 px-2 py-1">{enhancing[i] ? 'Enhancing…' : 'Enhance'}</button>
                )}
                <a href={t.url} download className="rounded bg-white/10 hover:bg-white/20 px-2 py-1">Download</a>
                <button onClick={() => deleteTake(i)} className="rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 px-2 py-1 text-red-100">Delete</button>
              </div>
            </div>
            <WaveformEditor url={t.url} height={64} />
          </div>
        ))}
        {takes.length === 0 && (
          <div className="text-xs text-white/50">No takes yet.</div>
        )}
      </div>
      {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" className="hidden" />}
    </div>
  )
}
