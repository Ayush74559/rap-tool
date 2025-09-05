"use client"
import { useParams } from 'next/navigation'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-2xl font-bold">Project {id}</h1>
      <p className="text-white/70 mt-2">Saved stems and mix preview will appear here.</p>
    </div>
  )
}
