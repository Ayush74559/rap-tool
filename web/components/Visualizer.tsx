"use client"
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export default function Visualizer({ playing = false }: { playing?: boolean }) {
  const barsRef = useRef<HTMLDivElement[]>([])
  const tlRef = useRef<gsap.core.Timeline | null>(null)

  useEffect(() => {
    const bars = barsRef.current.filter(Boolean)
    if (!bars.length) return
    if (tlRef.current) { tlRef.current.kill(); tlRef.current = null }
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } })
    bars.forEach((b, i) => {
      tl.to(b, { height: `${20 + Math.random()*60}%`, duration: 0.4 + (i%5)*0.05 }, i*0.04)
        .to(b, { height: `${10 + Math.random()*70}%`, duration: 0.5 + (i%5)*0.05 }, ">")
    })
    tlRef.current = tl
    return () => { tl.kill() }
  }, [])

  useEffect(() => {
    const tl = tlRef.current
    if (!tl) return
    if (playing) tl.resume(); else tl.pause()
  }, [playing])

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
      <div className="text-sm text-white/80 mb-2">Visualizer</div>
      <div className="h-24 grid grid-cols-24 gap-1 items-end">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            ref={(el) => { if (el) barsRef.current[i] = el }}
            className="w-full rounded bg-[var(--neon)]/80 shadow-[0_0_12px_rgba(57,255,20,0.35)]"
            style={{ height: `${10 + (i%5)*8}%` }}
          />
        ))}
      </div>
    </div>
  )
}
