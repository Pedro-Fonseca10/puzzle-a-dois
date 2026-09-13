export type Rng = () => number

/** Deterministic PRNG (mulberry32). Same seed -> same sequence on both peers. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function randomId(len = 8): string {
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += ALPHABET[b % ALPHABET.length]
  return s
}
