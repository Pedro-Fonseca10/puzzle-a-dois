// Message/state types are `type` aliases (not interfaces) so they satisfy
// Trystero's JSON payload constraint.

export type PuzzleConfig = {
  seed: number
  cols: number
  rows: number
  imgW: number
  imgH: number
  tableW: number
  tableH: number
}

/** A cluster of connected pieces. Piece world position = group origin + cell offset. */
export type Group = {
  id: number
  x: number
  y: number
  pieces: number[] // piece index = row * cols + col
}

export type PuzzleState = {
  config: PuzzleConfig
  groups: Group[] // draw order: first = bottom, last = top
  elapsedMs: number
  finished: boolean
}

export type MoveMsg = { id: number; x: number; y: number }
export type DropMsg = { id: number; x: number; y: number; merges: number[] }
export type CursorMsg = { x: number; y: number } | null
export type SnapshotMsg = { state: PuzzleState }
