"use client"
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { FXPanel } from '@/components/FXPanel'
import type { FxParams } from '@/components/FXPanel'
import type { PitchParams } from '@/components/PitchEditor'
import { AudioUploader, type UploadedMeta } from '@/components/AudioUploader'
import { Timeline } from '@/components/Timeline'
import { api } from '@/lib/api'
import { LyricsPanel } from '@/components/LyricsPanel'
const RapTimelineEditor = dynamic(() => import('@/components/RapTimelineEditor'), { ssr: false })

const WaveformEditor = dynamic(() => import('@/components/WaveformEditor'), { ssr: false })
const PitchEditor = dynamic(() => import('@/components/PitchEditor'), { ssr: false })
const Visualizer = dynamic(() => import('@/components/Visualizer'), { ssr: false })
const Recorder = dynamic(() => import('@/components/Recorder'), { ssr: false })

export default function StudioPage() {
  const [beat, setBeat] = useState<UploadedMeta | null>(null)
  const [vocal, setVocal] = useState<UploadedMeta | null>(null)
  const [exporting, setExporting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [autoTaskId, setAutoTaskId] = useState<string | null>(null)
  const [mixUrl, setMixUrl] = useState<string | null>(null)
  const [stems, setStems] = useState<{ beat?: string; vocal?: string } | null>(null)
  const [projectKey, setProjectKey] = useState<number>(() => Date.now())
  const [clientError, setClientError] = useState<string | null>(null)
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null)
  const mixSectionRef = useRef<HTMLDivElement | null>(null)
  const [fx, setFx] = useState<FxParams>({
  enabled: { reverb: true, delay: false, eq: true, comp: true, noise: false, autotune: true },
    reverb: 0.12,
    delay: 0,
    eq: { low: 0, mid: 0, high: 2 },
  comp: { thresh: -14, ratio: 2.5, gain: 3 },
    preset: null,
  })
  const [pitch, setPitch] = useState<PitchParams>({ key: 'A', scale: 'minor', strength: 0.8, retune: 0.2, preset: 'Trap Vocal' })
  const [pitchBusy, setPitchBusy] = useState(false)
  const [lyrics, setLyrics] = useState<string>(() => {
    try {
      const k = `lyrics-${projectKey}`
      return localStorage.getItem(k) || ''
    } catch { return '' }
  })
  const [playing, setPlaying] = useState(false)

  // Diagnostics: capture runtime errors so users don't see a silent white screen
  useEffect(() => {
    const onErr = (e: ErrorEvent) => setClientError(e?.error?.message || e.message || 'Runtime error')
    const onRej = (e: PromiseRejectionEvent) => setClientError((e.reason && (e.reason.message || String(e.reason))) || 'Unhandled promise rejection')
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej as any)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej as any)
    }
  }, [])

  // API health check (uses shared axios client + timeout) with retry
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        await api.get('/health', { timeout: 3000 })
        if (mounted) setApiHealthy(true)
      } catch {
        if (mounted) setApiHealthy(false)
      }
    }
    check()
    const id = setInterval(check, 5000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!taskId) return
    let mounted = true
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/tasks/${taskId}`)
        if (!mounted) return
        if (data.state === 'SUCCESS' && (data.result?.mix_url || data.result?.mix_path)) {
          setExporting(false)
          setTaskId(null)
          const url = data.result?.mix_url ?? `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/files/outputs/${data.result.mix_path.split('outputs/').pop()}`
          setMixUrl(url)
          // scroll mix section into view
          try { mixSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch {}
          clearInterval(interval)
        } else if (['FAILURE', 'REVOKED'].includes(data.state)) {
          setExporting(false)
          setTaskId(null)
          clearInterval(interval)
          alert('Mix failed')
        }
      } catch (e) {
        console.error(e)
      }
    }, 1500)
    return () => { mounted = false; clearInterval(interval) }
  }, [taskId])

  useEffect(() => {
    if (!autoTaskId) return
    let mounted = true
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/tasks/${autoTaskId}`)
        if (!mounted) return
        if (data.state === 'SUCCESS' && (data.result?.autotuned_url || data.result?.autotuned_path)) {
          let url = data.result?.autotuned_url as string | undefined
          const path = data.result?.autotuned_path ?? undefined
          if (!url && path) {
            const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
            const p = String(path)
            if (p.includes('/storage/')) {
              url = `${base}/files/${p.split('/storage/')[1]}`
            } else if (p.includes('uploads/')) {
              url = `${base}/files/uploads/${p.split('uploads/')[1]}`
            } else if (p.includes('outputs/')) {
              url = `${base}/files/outputs/${p.split('outputs/')[1]}`
            }
          }
          setVocal((prev) => prev ? { ...prev, url: url || prev.url, path: path || prev.path } : prev)
          setPitchBusy(false)
          setAutoTaskId(null)
          clearInterval(interval)
        } else if (['FAILURE', 'REVOKED'].includes(data.state)) {
          setPitchBusy(false)
          setAutoTaskId(null)
          clearInterval(interval)
          alert('Autotune failed')
        }
      } catch (e) {
        console.error(e)
      }
    }, 1200)
    return () => { mounted = false; clearInterval(interval) }
  }, [autoTaskId])

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-6">
      {clientError && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-lg border border-red-500/40 bg-red-500/15 text-red-100 px-3 py-2 text-sm">
          Error: {clientError}
        </div>
      )}
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Studio</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (!beat || !vocal) { alert('Upload beat and vocal first'); return }
              if (beat.path.startsWith('blob:') || vocal.path.startsWith('blob:')) { alert('Please upload files to the server before mixing. Recording upload may have failed.'); return }
              try {
                const { data } = await api.post('/mix', { beatPath: beat.path, vocalPath: vocal.path, params: { fx, pitch } })
                if (data?.task_id) { setTaskId(data.task_id); setExporting(true) }
              } catch (e) { console.error(e) }
            }}
            className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2"
          >
            Preview Mix
          </button>
          <button
            onClick={() => {
              if (!beat || !vocal) { alert('Upload beat and vocal first'); return }
              setStems({ beat: beat.url, vocal: vocal.url })
            }}
            className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2"
          >
            Export Stems
          </button>
          <button
            onClick={() => {
              // Optional confirm if there is unsaved work
              const hasSomething = !!(beat || vocal || mixUrl || taskId)
              if (!hasSomething || confirm('Start a new project? Current session will be cleared.')) {
                setBeat(null)
                setVocal(null)
                setMixUrl(null)
                setStems(null)
                setTaskId(null)
                setExporting(false)
                setProjectKey(Date.now())
                setPitch({ key: 'A', scale: 'minor', strength: 0.8, retune: 0.2, preset: 'Trap Vocal' })
                setLyrics('')
              }
            }}
            className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2"
          >
            New Project
          </button>
          <button
            disabled={!beat || !vocal || exporting}
            onClick={async () => {
              if (!beat || !vocal) return
              if (beat.path.startsWith('blob:') || vocal.path.startsWith('blob:')) { alert('Please upload files to the server before exporting.'); return }
              setExporting(true)
              setMixUrl(null)
              try {
                const { data } = await api.post('/mix', { beatPath: beat.path, vocalPath: vocal.path, params: { fx, pitch } })
                setTaskId(data.task_id)
                setProjectKey(Date.now())
                setFx({ enabled: { reverb: true, delay: false, eq: true, comp: true, noise: false, autotune: true }, reverb: 0.12, delay: 0, eq: { low: 0, mid: 0, high: 2 }, comp: { thresh: -14, ratio: 2.5, gain: 3 }, preset: null })
              } catch (e) {
                console.error(e)
                setExporting(false)
              }
            }}
            className="rounded-xl bg-[var(--neon)] disabled:opacity-50 text-black px-4 py-2 font-semibold"
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>
      {exporting && (
        <div className="text-sm text-white/70">Mixing… This can take a few seconds.</div>
      )}
      <div className="text-xs text-white/50">
        <span>API: {apiHealthy == null ? 'checking…' : apiHealthy ? 'online' : 'offline'}</span>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <div key={`uploads-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
            <AudioUploader onUploaded={setBeat} label="Upload Beat" />
            {beat?.url && <WaveformEditor url={beat.url} height={96} />}
            {beat?.url && (
              <div className="mt-3">
                <Recorder onRecorded={setVocal} beatUrl={beat.url} bpm={140} />
              </div>
            )}
          </div>
          {vocal?.url && (
            <div key={`vocal-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
              <WaveformEditor url={vocal.url} height={96} />
            </div>
          )}
          {/* Timeline + Editor */}
          <div key={`timeline-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/60">Timeline</div>
              <button
                type="button"
                onClick={() => setProjectKey(Date.now())}
                className="text-sm rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 px-3 py-1"
                title="Remove all sections/clips from the editors"
              >
                Delete All Sections
              </button>
            </div>
            <Timeline beatUrl={beat?.url ?? undefined} vocalUrl={vocal?.url ?? undefined} beatPath={beat?.path ?? undefined} vocalPath={vocal?.path ?? undefined} />
            <RapTimelineEditor beat={beat ? { url: beat.url, path: beat.path } : undefined} vocals={vocal ? [{ url: vocal.url, path: vocal.path }] : []} />
          </div>
          <Visualizer playing={playing} />
        </div>
        <div className="space-y-4">
          <div key={`lyrics-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
            <LyricsPanel
              value={lyrics}
              onChange={setLyrics}
              beatUrl={beat?.url || undefined}
              storageKey={`lyrics-${projectKey}`}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1 text-sm"
                onClick={async () => {
                  try {
                    const { data } = await api.post('/lyrics/generate', { topic: 'night drive', mood: 'confident' })
                    if (data?.lyrics) setLyrics(data.lyrics)
                  } catch (e) { console.error(e) }
                }}
              >
                Generate Lyrics
              </button>
            </div>
          </div>
          <div key={`pitch-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
            <PitchEditor
              value={pitch}
              onChange={setPitch}
              busy={pitchBusy}
              disabled={!vocal}
              onApply={async (p: PitchParams) => {
                if (!vocal?.path) { alert('Record or upload a vocal first'); return }
                try {
                  setPitchBusy(true)
                  const { data } = await api.post('/autotune', { vocalPath: vocal.path, key: p.key, scale: p.scale, strength: p.strength, retune: p.retune })
                  setAutoTaskId(data.task_id)
                } catch (e) {
                  console.error(e)
                  setPitchBusy(false)
                }
              }}
            />
          </div>
          <div key={`fx-${projectKey}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4">
            <FXPanel value={fx} onChange={setFx} />
          </div>
          {mixUrl && (
            <div ref={mixSectionRef} className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-sm mb-2">Mix ready</div>
              <audio src={mixUrl} controls className="w-full" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
              <div className="mt-2 flex items-center gap-2">
                <a href={mixUrl} download className="rounded bg-white/10 hover:bg-white/20 px-3 py-1">Download</a>
              </div>
            </div>
          )}
          {stems && (stems.beat || stems.vocal) && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-sm mb-2">Stems</div>
              <div className="flex items-center gap-2">
                {stems.beat && <a href={stems.beat} download className="rounded bg-white/10 hover:bg-white/20 px-3 py-1">Beat</a>}
                {stems.vocal && <a href={stems.vocal} download className="rounded bg-white/10 hover:bg-white/20 px-3 py-1">Vocal</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
