"use client"
import axios, { type AxiosProgressEvent } from 'axios'
import { useRef, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export type UploadedMeta = { url: string; path: string; filename: string }

export function AudioUploader({ onUploaded, label = 'Upload Audio' }: { onUploaded: (meta: UploadedMeta) => void, label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    // Basic extension validation to give fast feedback
    const okExt = ['.mp3', '.wav', '.m4a', '.webm', '.mp4']
    const name = file.name || ''
    const lower = name.toLowerCase()
    const ext = okExt.find(e => lower.endsWith(e))
    if (!ext && !(file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
      setError('Unsupported format. Use: mp3, wav, m4a, webm, mp4')
      return
    }
    const form = new FormData()
    form.append('file', file)
    try {
      setError(null)
      // Quick health check to surface offline API early
      await axios.get(`${API_URL}/health`, { timeout: 3000 })
      const res = await axios.post(`${API_URL}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e: AxiosProgressEvent) => setProgress(Math.round((e.loaded! / (e.total || 1)) * 100))
      })
      onUploaded(res.data as UploadedMeta)
      setProgress(0)
    } catch (e: any) {
      console.error(e)
      let msg = e?.response?.data?.error || e?.message || 'Upload failed'
      if (msg === 'Network Error' || (!e?.response && e?.request)) {
        msg = 'Network error: API unreachable. Ensure server on http://localhost:4000 and NEXT_PUBLIC_API_URL is set.'
      }
      setError(String(msg))
      setProgress(0)
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onDragOver={(e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={`rounded-xl border border-white/10 bg-white/5 backdrop-blur p-4 text-center cursor-pointer ${isDragging ? 'ring-2 ring-[var(--neon)]' : ''}`}
      >
        <p className="text-white/80">{label} or drag & drop</p>
        {progress > 0 && progress < 100 && (
          <div className="mt-2 h-2 bg-white/10 rounded">
            <div className="h-2 bg-[var(--neon)] rounded" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-400">
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="audio/*,video/*"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
      />
  <p className="mt-2 text-xs text-white/50">Supported: mp3, wav, m4a, webm, mp4</p>
    </div>
  )
}
