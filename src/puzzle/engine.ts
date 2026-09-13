import { mulberry32 } from '../rng'
import type { Geometry } from './geometry'
import type { DropMsg, Group, PuzzleConfig, PuzzleState } from './types'

/** Grid closest to the requested count while matching the image aspect ratio. */
export function computeGrid(n: number, imgW: number, imgH: number): { cols: number; rows: number } {
  const aspect = imgW / imgH
  const cols = Math.max(2, Math.round(Math.sqrt(n * aspect)))
  const rows = Math.max(2, Math.round(n / cols))
  return { cols, rows }
}

export function makeConfig(imgW: number, imgH: number, pieces: number, seed: number): PuzzleConfig {
  const { cols, rows } = computeGrid(pieces, imgW, imgH)
  const side = Math.round(Math.max(imgW, imgH) * 2.3)
  return { seed, cols, rows, imgW, imgH, tableW: side, tableH: side }
}

/** Scatters every piece as its own group across the table. Deterministic per seed. */
export function createState(cfg: PuzzleConfig): PuzzleState {
  const rng = mulberry32((cfg.seed ^ 0x5bd1e995) >>> 0)
  const pw = cfg.imgW / cfg.cols
  const ph = cfg.imgH / cfg.rows
  const pad = 0.36 * Math.max(pw, ph)
  const groups: Group[] = []
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const i = r * cfg.cols + c
      const px = pad + rng() * (cfg.tableW - pw - 2 * pad)
      const py = pad + rng() * (cfg.tableH - ph - 2 * pad)
      groups.push({ id: i, x: px - c * pw, y: py - r * ph, pieces: [i] })
    }
  }
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[groups[i], groups[j]] = [groups[j], groups[i]]
  }
  return { config: cfg, groups, elapsedMs: 0, finished: false }
}

export function groupById(state: PuzzleState, id: number): Group | undefined {
  return state.groups.find(g => g.id === id)
}

export function bringToFront(state: PuzzleState, id: number): void {
  const i = state.groups.findIndex(g => g.id === id)
  if (i < 0 || i === state.groups.length - 1) return
  const [g] = state.groups.splice(i, 1)
  state.groups.push(g)
}

function cellBounds(g: Group, cols: number) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
  for (const p of g.pieces) {
    const r = Math.floor(p / cols), c = p % cols
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (c < minC) minC = c
    if (c > maxC) maxC = c
  }
  return { minR, maxR, minC, maxC }
}

/** Keeps every cell of the group inside the table. */
export function clampGroup(state: PuzzleState, geo: Geometry, g: Group): void {
  const { minR, maxR, minC, maxC } = cellBounds(g, geo.cols)
  const { tableW, tableH } = state.config
  const minX = -minC * geo.pw, maxX = tableW - (maxC + 1) * geo.pw
  const minY = -minR * geo.ph, maxY = tableH - (maxR + 1) * geo.ph
  g.x = Math.min(Math.max(g.x, minX), maxX)
  g.y = Math.min(Math.max(g.y, minY), maxY)
}

export function moveGroup(state: PuzzleState, geo: Geometry, id: number, x: number, y: number): Group | undefined {
  const g = groupById(state, id)
  if (!g) return undefined
  g.x = x
  g.y = y
  clampGroup(state, geo, g)
  return g
}

/**
 * Decides where a released group lands and which neighbouring groups it fuses with.
 * Pure: does not mutate state. The result is broadcast so both peers apply the same thing.
 */
export function computeSnap(state: PuzzleState, geo: Geometry, id: number): DropMsg {
  const g = groupById(state, id)
  if (!g) return { id, x: 0, y: 0, merges: [] }
  const { cols, rows } = geo
  const owner = new Map<number, Group>()
  for (const grp of state.groups) for (const p of grp.pieces) owner.set(p, grp)

  const neighbours = (): Group[] => {
    const out = new Map<number, Group>()
    for (const p of g.pieces) {
      const r = Math.floor(p / cols), c = p % cols
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        const q = owner.get(nr * cols + nc)
        if (q && q.id !== g.id) out.set(q.id, q)
      }
    }
    return [...out.values()]
  }

  let x = g.x, y = g.y
  const threshold = 0.22 * Math.min(geo.pw, geo.ph)
  let best: Group | null = null
  let bestDist = threshold
  for (const q of neighbours()) {
    const d = Math.hypot(q.x - g.x, q.y - g.y)
    if (d <= bestDist) { best = q; bestDist = d }
  }
  const merges: number[] = []
  if (best) {
    x = best.x
    y = best.y
    for (const q of neighbours()) {
      if (Math.hypot(q.x - x, q.y - y) < 0.5) merges.push(q.id)
    }
  }
  return { id, x, y, merges }
}

/** Applies a drop (local or remote). Returns true when the puzzle is complete. */
export function applyDrop(state: PuzzleState, geo: Geometry, msg: DropMsg): boolean {
  const g = groupById(state, msg.id)
  if (!g) return state.finished
  g.x = msg.x
  g.y = msg.y
  for (const mid of msg.merges) {
    const idx = state.groups.findIndex(q => q.id === mid)
    if (idx < 0) continue
    const [q] = state.groups.splice(idx, 1)
    g.pieces.push(...q.pieces)
  }
  clampGroup(state, geo, g)
  bringToFront(state, g.id)
  if (state.groups.length === 1) state.finished = true
  return state.finished
}

export function progress(state: PuzzleState): number {
  const total = state.config.cols * state.config.rows
  if (total <= 1) return 1
  return 1 - (state.groups.length - 1) / (total - 1)
}
