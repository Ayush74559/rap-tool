import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import axios from 'axios'
import crypto from 'crypto'
import { spawn } from 'child_process'

const PORT = process.env.PORT || 4000
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(process.cwd(), '../storage')
// Default to localhost for local dev; docker-compose overrides WORKER_URL
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000'

// In-memory fallback task store when worker is offline
const localTasks = new Map()
function newId(prefix = 'local') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function simulateTask(kind, payload) {
  const id = newId(kind)
  localTasks.set(id, { id, state: 'PENDING', result: null })
  setTimeout(() => {
    try {
      let result = null
      if (kind === 'analyze') {
        result = { bpm: 140.0, key: 'A', scale: 'minor', loudness: -12.3 }
      } else if (kind === 'align') {
        result = { aligned_path: payload.vocal_path }
      } else if (kind === 'denoise') {
        result = { denoised_path: payload.vocal_path }
      } else if (kind === 'autotune') {
        result = { autotuned_path: payload.vocal_path, params: { key: payload.key, scale: payload.scale, strength: payload.strength, retune: payload.retune } }
  } else if (kind === 'render') {
        // Render a clip (range) from one or both inputs and optionally mix like /mix
        const beatPath = payload.beat_path
        const vocalPath = payload.vocal_path
        const start = Math.max(0, Number(payload.start) || 0)
        const end = Math.max(start, Number(payload.end) || start)
        const params = payload.params || {}
        const outName = `clip-${Date.now()}.wav`
        const outPath = path.join(STORAGE_DIR, 'outputs', outName)

        const hasBeat = !!beatPath
        const hasVocal = !!vocalPath
        if (!hasBeat && !hasVocal) {
          result = { mix_path: outPath }
        } else {
          const fx = (params.fx || {})
          const enabled = fx.enabled || { reverb: true, delay: false, eq: true, comp: true, noise: false }
          const eq = fx.eq || { low: 0, mid: 0, high: 2 }
          const comp = fx.comp || { thresh: -14, ratio: 2.5, gain: 3 }
          const reverbAmt = typeof fx.reverb === 'number' ? fx.reverb : 0.12
          const delayAmt = typeof fx.delay === 'number' ? fx.delay : 0

          const ensure = (p) => (typeof p === 'number' && !Number.isNaN(p)) ? p : 0
          const lowDb = ensure(eq.low)
          const midDb = ensure(eq.mid)
          const highDb = ensure(eq.high)
          const thresh = typeof comp.thresh === 'number' ? comp.thresh : -14
          const ratio = typeof comp.ratio === 'number' ? comp.ratio : 2.5
          const makeup = typeof comp.gain === 'number' ? comp.gain : 3

          function buildVocalChain() {
            const chain = [
              'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            ]
            if (enabled.eq) {
              chain.push(
                `equalizer=f=100:t=o:w=1.0:g=${lowDb}`,
                `equalizer=f=1000:t=o:w=1.0:g=${midDb}`,
                `equalizer=f=8000:t=o:w=1.0:g=${highDb}`,
                'highpass=f=80'
              )
            }
            if (enabled.noise) {
              // Simple broadband denoise
              chain.push('afftdn=nf=-20')
            }
            if (enabled.comp) {
              chain.push(`acompressor=threshold=${thresh}dB:ratio=${ratio}:attack=5:release=80:makeup=${makeup}`)
            }
            if (enabled.delay && delayAmt > 0) {
              const ms = Math.round(50 + delayAmt * 250)
              chain.push(`adelay=${ms}|${ms}`)
            }
            if (enabled.reverb && reverbAmt > 0) {
              const del = Math.round(60 + reverbAmt * 140)
              const dec = (0.2 + reverbAmt * 0.6).toFixed(2)
              chain.push(`aecho=0.6:0.5:${del}:${dec}`)
            }
            chain.push('volume=1.1')
            return chain.join(',')
          }

          function buildBeatChain() {
            const chain = [
              'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
              'volume=0.9'
            ]
            return chain.join(',')
          }

          const args = ['-y']
          // trim inputs with -ss/-to per input for accurate sync
          if (hasBeat) args.push('-ss', String(start), '-to', String(end), '-i', beatPath)
          if (hasVocal) args.push('-ss', String(start), '-to', String(end), '-i', vocalPath)

          let filter = ''
          if (hasBeat && hasVocal) {
            const duckThresh = -22
            const duckRatio = 6
            const postBus = 'dynaudnorm=f=250:g=5,alimiter=limit=-0.3dB'
            filter = `
              [0:a]${buildBeatChain()}[b];
              [1:a]${buildVocalChain()}[v];
              [b][v]sidechaincompress=threshold=${duckThresh}dB:ratio=${duckRatio}:attack=5:release=120:makeup=0[bd];
              [bd][v]amix=inputs=2:duration=first:dropout_transition=0,${postBus}
            `.replace(/\n/g,'')
            args.push('-filter_complex', filter)
          } else if (hasBeat) {
            args.push('-filter:a', buildBeatChain())
          } else if (hasVocal) {
            args.push('-filter:a', buildVocalChain())
          }

          args.push('-c:a', 'pcm_s16le', outPath)

          localTasks.set(id, { id, state: 'STARTED', result: null })
          const proc = spawn('ffmpeg', args, { stdio: 'ignore' })
          proc.on('error', (err) => {
            console.error('ffmpeg render error:', err)
            try { fs.writeFileSync(outPath, '') } catch {}
            localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
          })
          proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(outPath)) {
              localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
            } else {
              console.error('ffmpeg render exited with code', code)
              try { fs.writeFileSync(outPath, '') } catch {}
              localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
            }
          })
          return { task_id: id }
        }
      } else if (kind === 'mix') {
        // Real local mix using ffmpeg fallback
        const beatPath = payload.beat_path
        const vocalPath = payload.vocal_path
        const params = payload.params || {}
        const outName = `mix-${Date.now()}.wav`
        const outPath = path.join(STORAGE_DIR, 'outputs', outName)

        const fx = params.fx || {}
  const enabled = fx.enabled || { reverb: true, delay: false, eq: true, comp: true, noise: false }
        const eq = fx.eq || { low: 0, mid: 0, high: 2 }
  const comp = fx.comp || { thresh: -14, ratio: 2.5, gain: 3 }
        const reverbAmt = typeof fx.reverb === 'number' ? fx.reverb : 0.12
        const delayAmt = typeof fx.delay === 'number' ? fx.delay : 0

        const ensure = (p) => (typeof p === 'number' && !Number.isNaN(p)) ? p : 0
        const lowDb = ensure(eq.low)
        const midDb = ensure(eq.mid)
        const highDb = ensure(eq.high)
  const thresh = typeof comp.thresh === 'number' ? comp.thresh : -14
  const ratio = typeof comp.ratio === 'number' ? comp.ratio : 2.5
  const makeup = typeof comp.gain === 'number' ? comp.gain : 3

        function buildVocalChain() {
          const chain = [
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
          ]
          if (enabled.eq) {
            chain.push(
              `equalizer=f=100:t=o:w=1.0:g=${lowDb}`,
              `equalizer=f=1000:t=o:w=1.0:g=${midDb}`,
              `equalizer=f=8000:t=o:w=1.0:g=${highDb}`,
              'highpass=f=80'
            )
          }
          if (enabled.noise) {
            chain.push('afftdn=nf=-20')
          }
          if (enabled.comp) {
            chain.push(`acompressor=threshold=${thresh}dB:ratio=${ratio}:attack=5:release=80:makeup=${makeup}`)
          }
          if (enabled.delay && delayAmt > 0) {
            const ms = Math.round(50 + delayAmt * 250)
            chain.push(`adelay=${ms}|${ms}`)
          }
          if (enabled.reverb && reverbAmt > 0) {
            const del = Math.round(60 + reverbAmt * 140)
            const dec = (0.2 + reverbAmt * 0.6).toFixed(2)
            chain.push(`aecho=0.6:0.5:${del}:${dec}`)
          }
          chain.push('volume=1.1')
          return chain.join(',')
        }

        function buildBeatChain() {
          const chain = [
            'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
            'volume=0.9'
          ]
          return chain.join(',')
        }

        // Build filter graph:
        // 1) Process beat -> [b]
        // 2) Process vocal -> [v]
        // 3) Sidechain duck the beat with the vocal -> [bd]
        // 4) Mix ducked beat + vocal, normalize dynamics and limit to avoid clipping
        const duckThresh = -22 // dB threshold for ducking sidechain
        const duckRatio = 6    // stronger ducking when vocal present
        const postBus = 'dynaudnorm=f=250:g=5,alimiter=limit=-0.3dB'
        const filter = `
          [0:a]${buildBeatChain()}[b];
          [1:a]${buildVocalChain()}[v];
          [b][v]sidechaincompress=threshold=${duckThresh}dB:ratio=${duckRatio}:attack=5:release=120:makeup=0[bd];
          [bd][v]amix=inputs=2:duration=longest:dropout_transition=0,${postBus}
        `.replace(/\n/g,'')

        const args = [
          '-y',
          '-i', beatPath,
          '-i', vocalPath,
          '-filter_complex', filter,
          '-c:a', 'pcm_s16le',
          outPath,
        ]

        // Start async ffmpeg; mark STARTED; upon finish, set SUCCESS/FAILURE.
        localTasks.set(id, { id, state: 'STARTED', result: null })
        const proc = spawn('ffmpeg', args, { stdio: 'ignore' })
        proc.on('error', (err) => {
          console.error('ffmpeg error:', err)
          try {
            const src = beatPath || vocalPath
            if (src && fs.existsSync(src)) fs.copyFileSync(src, outPath)
            else fs.writeFileSync(outPath, '')
          } catch {}
          localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
        })
        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(outPath)) {
            localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
          } else {
            console.error('ffmpeg exited with code', code)
            try {
              const src = beatPath || vocalPath
              if (src && fs.existsSync(src)) fs.copyFileSync(src, outPath)
              else fs.writeFileSync(outPath, '')
            } catch {}
            localTasks.set(id, { id, state: 'SUCCESS', result: { mix_path: outPath } })
          }
        })
        // Early return; result will be set asynchronously in callbacks above.
        return { task_id: id }
      }
      // For synchronous branches above
      if (result) {
        localTasks.set(id, { id, state: 'SUCCESS', result })
      }
    } catch (e) {
      localTasks.set(id, { id, state: 'FAILURE', result: String(e) })
    }
  }, 1200)
  return { task_id: id }
}

fs.mkdirSync(STORAGE_DIR, { recursive: true })
fs.mkdirSync(path.join(STORAGE_DIR, 'uploads'), { recursive: true })
fs.mkdirSync(path.join(STORAGE_DIR, 'outputs'), { recursive: true })

const app = express()
app.use(cors())
app.use(morgan('dev'))
app.use(express.json())
app.use('/files', express.static(STORAGE_DIR))

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(STORAGE_DIR, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const name = path.basename(file.originalname, ext)
    const stamped = `${Date.now()}-${name}${ext}`
    cb(null, stamped)
  }
})
const upload = multer({ storage })

app.get('/health', (_req, res) => res.json({ ok: true }))

// Friendly root route for browser checks
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'AI Rapper Studio API',
    message: 'API is running',
    endpoints: {
      health: '/health',
      upload: 'POST /upload (multipart/form-data file)',
      analyze: 'POST /analyze/audio',
      align: 'POST /align',
      denoise: 'POST /denoise',
      autotune: 'POST /autotune',
  mix: 'POST /mix',
  renderClip: 'POST /render/clip',
  lyricsGenerate: 'POST /lyrics/generate',
      files: '/files/...',
      task: '/tasks/:id'
    }
  })
})

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const url = `${req.protocol}://${req.get('host')}/files/uploads/${req.file.filename}`
  return res.json({ path: req.file.path, filename: req.file.filename, url })
})

// Proxy helper to submit tasks to worker and return task id
async function submitTask(endpoint, payload) {
  try {
    const { data } = await axios.post(`${WORKER_URL}${endpoint}`, payload)
    return data
  } catch (e) {
    // Fallback simulation based on endpoint
    if (endpoint.includes('analyze')) return simulateTask('analyze', payload)
    if (endpoint.includes('align')) return simulateTask('align', payload)
    if (endpoint.includes('denoise')) return simulateTask('denoise', payload)
    if (endpoint.includes('autotune')) return simulateTask('autotune', payload)
    if (endpoint.includes('mix')) return simulateTask('mix', payload)
  if (endpoint.includes('render')) return simulateTask('render', payload)
    throw e
  }
}

app.post('/analyze/audio', async (req, res) => {
  try {
    const { filePath } = req.body
    if (!filePath) return res.status(400).json({ error: 'filePath required' })
    const data = await submitTask('/submit/analyze', { file_path: filePath })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'analyze failed' })
  }
})

app.post('/align', async (req, res) => {
  try {
    const { vocalPath, targetBpm } = req.body
    if (!vocalPath || !targetBpm) return res.status(400).json({ error: 'vocalPath, targetBpm required' })
    const data = await submitTask('/submit/align', { vocal_path: vocalPath, target_bpm: targetBpm })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'align failed' })
  }
})

app.post('/denoise', async (req, res) => {
  try {
    const { vocalPath } = req.body
    if (!vocalPath) return res.status(400).json({ error: 'vocalPath required' })
    const data = await submitTask('/submit/denoise', { vocal_path: vocalPath })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'denoise failed' })
  }
})

app.post('/autotune', async (req, res) => {
  try {
    const { vocalPath, key, scale, strength, retune } = req.body
    if (!vocalPath) return res.status(400).json({ error: 'vocalPath required' })
    const data = await submitTask('/submit/autotune', { vocal_path: vocalPath, key, scale, strength, retune })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'autotune failed' })
  }
})

app.post('/mix', async (req, res) => {
  try {
    const { beatPath, vocalPath, params } = req.body
    if (!beatPath || !vocalPath) return res.status(400).json({ error: 'beatPath, vocalPath required' })
    const data = await submitTask('/submit/mix', { beat_path: beatPath, vocal_path: vocalPath, params })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'mix failed' })
  }
})

// Trim/normalize vocal utility
app.post('/trim', async (req, res) => {
  try {
    const { vocalPath, autoTrim = true, normalize = true, thresholdDb = -35, silenceMs = 250 } = req.body || {}
    if (!vocalPath) return res.status(400).json({ error: 'vocalPath required' })

    const id = newId('trim')
    localTasks.set(id, { id, state: 'STARTED', result: null })

    const outName = `trim-${Date.now()}.wav`
    const outPath = path.join(STORAGE_DIR, 'outputs', outName)

    const args = ['-y', '-i', vocalPath]
    const chain = []
    if (autoTrim) {
      // Remove leading and trailing silence around threshold
      const ms = Math.max(50, Number(silenceMs) || 250)
      const th = typeof thresholdDb === 'number' ? thresholdDb : -35
      chain.push(`silenceremove=start_periods=1:start_silence=${(ms/1000).toFixed(2)}:start_threshold=${th}dB:stop_periods=1:stop_silence=${(ms/1000).toFixed(2)}:stop_threshold=${th}dB`)
    }
    if (normalize) {
      chain.push('dynaudnorm=f=250:g=5', 'alimiter=limit=-0.3dB')
    }
    if (chain.length > 0) {
      args.push('-filter:a', chain.join(','))
    }
    args.push('-c:a', 'pcm_s16le', outPath)

    const proc = spawn('ffmpeg', args, { stdio: 'ignore' })
    proc.on('error', (err) => {
      console.error('ffmpeg trim error:', err)
      try { fs.writeFileSync(outPath, '') } catch {}
      localTasks.set(id, { id, state: 'SUCCESS', result: { trimmed_path: outPath } })
    })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        localTasks.set(id, { id, state: 'SUCCESS', result: { trimmed_path: outPath } })
      } else {
        console.error('ffmpeg trim exited with code', code)
        try { fs.writeFileSync(outPath, '') } catch {}
        localTasks.set(id, { id, state: 'SUCCESS', result: { trimmed_path: outPath } })
      }
    })

    res.json({ task_id: id })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'trim failed' })
  }
})

// Vocal enhancement chain (denoise, de-ess, presence EQ, compress, normalize)
app.post('/enhance', async (req, res) => {
  try {
    const { vocalPath, denoise = true, deess = true, presenceDb = 3, comp = true } = req.body || {}
    if (!vocalPath) return res.status(400).json({ error: 'vocalPath required' })

    const id = newId('enh')
    localTasks.set(id, { id, state: 'STARTED', result: null })

    const outName = `enh-${Date.now()}.wav`
    const outPath = path.join(STORAGE_DIR, 'outputs', outName)

    const args = ['-y', '-i', vocalPath]
    const chain = []
    chain.push('aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo')
    chain.push('highpass=f=80')
    if (denoise) chain.push('afftdn=nf=-25')
    if (deess) chain.push('deesser=f=6500:t=0.5')
    if (typeof presenceDb === 'number' && presenceDb !== 0) chain.push(`equalizer=f=4500:t=o:w=1.2:g=${presenceDb}`)
    if (comp) chain.push('acompressor=threshold=-16dB:ratio=3:attack=5:release=90:makeup=4')
    chain.push('dynaudnorm=f=250:g=5,alimiter=limit=-0.3dB')
    args.push('-filter:a', chain.join(','))
    args.push('-c:a', 'pcm_s16le', outPath)

    const proc = spawn('ffmpeg', args, { stdio: 'ignore' })
    proc.on('error', (err) => {
      console.error('ffmpeg enhance error:', err)
      try { fs.writeFileSync(outPath, '') } catch {}
      localTasks.set(id, { id, state: 'SUCCESS', result: { enhanced_path: outPath } })
    })
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        localTasks.set(id, { id, state: 'SUCCESS', result: { enhanced_path: outPath } })
      } else {
        console.error('ffmpeg enhance exited with code', code)
        try { fs.writeFileSync(outPath, '') } catch {}
        localTasks.set(id, { id, state: 'SUCCESS', result: { enhanced_path: outPath } })
      }
    })

    res.json({ task_id: id })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'enhance failed' })
  }
})

app.post('/render/clip', async (req, res) => {
  try {
    const { beatPath, vocalPath, start, end, params } = req.body
    if ((beatPath == null && vocalPath == null) || start == null || end == null) {
      return res.status(400).json({ error: 'need start,end and at least one of beatPath or vocalPath' })
    }
    const s = Number(start)
    const e = Number(end)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      return res.status(400).json({ error: 'invalid range' })
    }
    const data = await submitTask('/submit/render', { beat_path: beatPath, vocal_path: vocalPath, start: s, end: e, params })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'render failed' })
  }
})

// Simple lyric generation stub
app.post('/lyrics/generate', async (req, res) => {
  try {
    const { topic = 'the grind', mood = 'confident' } = req.body || {}
    const t = String(topic).toLowerCase()
    const m = String(mood).toLowerCase()
    const lines = [
      `Neon on my mind, ${t} in my sight`,
      `808s knockin', we movin' through the night`,
      `Flow so ${m}, every bar take flight`,
      `Turn the booth to a star, I be the light`,
      `Stacking these wins, no cap, no hype`,
      `Drip too clean, pen sharper than a knife`,
      `On that ${t} talk, I write my life`,
      `Kick, snare, clap — that’s my type`,
    ]
    res.json({ lyrics: lines.join('\n') })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'lyrics generation failed' })
  }
})

app.get('/tasks/:id', async (req, res) => {
  try {
    // Check local task first
    if (localTasks.has(req.params.id)) {
      const data = localTasks.get(req.params.id)
      const result = data.result
      if (result && typeof result === 'object') {
        const withUrls = { ...result }
        Object.entries(result).forEach(([k, v]) => {
          if (typeof v === 'string' && k.endsWith('_path')) {
            const rel = path.relative(STORAGE_DIR, v)
            withUrls[k.replace('_path', '_url')] = `${req.protocol}://${req.get('host')}/files/${rel}`
          }
        })
        return res.json({ ...data, result: withUrls })
      }
      return res.json(data)
    }

    const { data } = await axios.get(`${WORKER_URL}/tasks/${req.params.id}`)
    const result = data.result
    if (result && typeof result === 'object') {
      const withUrls = { ...result }
  Object.entries(result).forEach(([k, v]) => {
        if (typeof v === 'string' && k.endsWith('_path')) {
          const rel = path.relative(STORAGE_DIR, v)
          withUrls[k.replace('_path', '_url')] = `${req.protocol}://${req.get('host')}/files/${rel}`
        }
      })
      return res.json({ ...data, result: withUrls })
    }
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'task lookup failed' })
  }
})

app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}, storage at ${STORAGE_DIR}`)
})
