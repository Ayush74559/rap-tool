import { useState } from 'react'

export type MasterFX = {
  limiter: boolean
  compressor: boolean
  stereoWidth: number
  preset?: 'Trap' | 'Drill' | 'Boom Bap' | 'Freestyle' | null
}

export function useFX() {
  const [master, setMaster] = useState<MasterFX>({ limiter: true, compressor: true, stereoWidth: 1, preset: null })
  return { master, setMaster }
}
