"use client"
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import Link from 'next/link'

export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.glow', { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power2.out' })
      gsap.from(heroRef.current, { y: 20, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.2 })
      gsap.to(btnRef.current, {
        scale: 1.04,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        duration: 1.4,
      })
    })
    return () => ctx.revert()
  }, [])

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 opacity-30 glow" style={{
        background: 'radial-gradient(circle at 50% 30%, rgba(57,255,20,0.35), transparent 50%)'
      }} />
      <section ref={heroRef} className="relative z-10 flex flex-col items-center justify-center text-center py-32 px-6">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight">
          AI Rapper <span className="text-[var(--neon)]">Studio</span>
        </h1>
        <p className="mt-6 max-w-2xl text-white/70">
          Upload your beat, record vocals, autotune with style, and export a polished mix—all in your browser.
        </p>
        <div className="mt-10">
          <Link ref={btnRef} href="/studio" className="inline-block rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-8 py-4 text-lg font-medium shadow-glass hover:shadow-neon transition-all hover:scale-[1.02]" style={{
            boxShadow: '0 0 24px rgba(57,255,20,0.25)'
          }}>
            Enter Studio →
          </Link>
        </div>
      </section>
    </main>
  )
}
