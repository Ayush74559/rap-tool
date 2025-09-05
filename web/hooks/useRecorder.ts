import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

export type RecordingTake = { url: string; path?: string; blob?: Blob }

export function useRecorder() {
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)

  useEffect(() => {
    return () => { try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {} }
  }, [])

  const start = useCallback(async () => {
    if (recording) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId || undefined } as any })
    streamRef.current = stream
    const rec = new MediaRecorder(stream)
    chunksRef.current = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.start(100)
    mediaRef.current = rec
    setRecording(true)
  }, [recording, deviceId])

  const stop = useCallback(async (): Promise<RecordingTake | null> => {
    return new Promise((resolve) => {
      const rec = mediaRef.current
      if (!rec) return resolve(null)
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        try {
          const form = new FormData()
          form.append('file', blob, 'take.webm')
          const { data } = await api.post('/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
          resolve({ url: data.url, path: data.path, blob })
        } catch {
          resolve({ url, blob })
        }
      }
      rec.stop()
      setRecording(false)
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
      streamRef.current = null
      mediaRef.current = null
    })
  }, [])

  return { recording, start, stop, deviceId, setDeviceId }
}
