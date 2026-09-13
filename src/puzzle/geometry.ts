import { mulberry32 } from '../rng'
import type { PuzzleConfig } from './types'

/** Parameters of one shared edge between two pieces (classic jigsaw tab). */
export type EdgeParams = { a: number; b: number; c: number; d: number; e: number; t: number; flip: number }

type Pt = readonly [number, number]

/** Minimal subset of Path2D / CanvasRenderingContext2D used to emit a path. */
export interface PathSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void
  closePath(): void
}

export type Geometry = {
  cols: number
  rows: number
  pw: number // piece cell width in image px
  ph: number // piece cell height in image px
  pad: number // how far a tab can protrude beyond the cell
  hEdges: EdgeParams[][] // hEdges[r][c]: edge between row r and r+1 at column c
  vEdges: EdgeParams[][] // vEdges[r][c]: edge between col c and c+1 at row r
}

const TAB = 0.1 // tab size relative to edge length (head is 4*TAB wide, protrudes ~3*TAB)
const JITTER = 0.04

export function buildGeometry(cfg: PuzzleConfig): Geometry {
  const rng = mulberry32(cfg.seed)
  const jitter = () => (rng() * 2 - 1) * JITTER
  const makeEdge = (): EdgeParams => ({
    a: jitter(), b: jitter(), c: jitter(), d: jitter(), e: jitter(),
    t: TAB + (rng() - 0.5) * 0.02,
    flip: rng() < 0.5 ? 1 : -1,
  })

  const hEdges: EdgeParams[][] = []
  for (let r = 0; r < cfg.rows - 1; r++) {
    const row: EdgeParams[] = []
    for (let c = 0; c < cfg.cols; c++) row.push(makeEdge())
    hEdges.push(row)
  }
  const vEdges: EdgeParams[][] = []
  for (let r = 0; r < cfg.rows; r++) {
    const row: EdgeParams[] = []
    for (let c = 0; c < cfg.cols - 1; c++) row.push(makeEdge())
    vEdges.push(row)
  }

  const pw = cfg.imgW / cfg.cols
  const ph = cfg.imgH / cfg.rows
  const pad = Math.ceil(0.36 * Math.max(pw, ph))
  return { cols: cfg.cols, rows: cfg.rows, pw, ph, pad, hEdges, vEdges }
}

/** 10 control points of a tabbed edge from (0,0) to (1,0); second coord is the across-axis. */
function edgePoints(p: EdgeParams): Pt[] {
  const { a, b, c, d, e, t, flip: f } = p
  return [
    [0, 0],
    [0.2, a * f],
    [0.5 + b + d, (-t + c) * f],
    [0.5 - t + b, (t + c) * f],
    [0.5 - 2 * t + b - d, (3 * t + c) * f],
    [0.5 + 2 * t + b - d, (3 * t + c) * f],
    [0.5 + t + b, (t + c) * f],
    [0.5 + b + d, (-t + c) * f],
    [0.8, e * f],
    [1, 0],
  ]
}

function emitCurves(sink: PathSink, pts: Pt[], reverse: boolean) {
  if (!reverse) {
    for (let i = 1; i + 2 < pts.length; i += 3) {
      sink.bezierCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1])
    }
  } else {
    for (let i = pts.length - 2; i - 2 >= 0; i -= 3) {
      sink.bezierCurveTo(pts[i][0], pts[i][1], pts[i - 1][0], pts[i - 1][1], pts[i - 2][0], pts[i - 2][1])
    }
  }
}

/**
 * Emits the outline of piece (row, col) in piece-local coordinates
 * (origin at the top-left corner of its cell).
 */
export function emitPiecePath(geo: Geometry, row: number, col: number, sink: PathSink): void {
  const { pw, ph, cols, rows } = geo
  sink.moveTo(0, 0)

  // top edge, left -> right
  if (row > 0) {
    const pts = edgePoints(geo.hEdges[row - 1][col]).map(([l, w]) => [l * pw, w * pw] as const)
    emitCurves(sink, pts, false)
  } else sink.lineTo(pw, 0)

  // right edge, top -> bottom
  if (col < cols - 1) {
    const pts = edgePoints(geo.vEdges[row][col]).map(([l, w]) => [pw + w * ph, l * ph] as const)
    emitCurves(sink, pts, false)
  } else sink.lineTo(pw, ph)

  // bottom edge, right -> left (shared edge traversed in reverse)
  if (row < rows - 1) {
    const pts = edgePoints(geo.hEdges[row][col]).map(([l, w]) => [l * pw, ph + w * pw] as const)
    emitCurves(sink, pts, true)
  } else sink.lineTo(0, ph)

  // left edge, bottom -> top (reverse)
  if (col > 0) {
    const pts = edgePoints(geo.vEdges[row][col - 1]).map(([l, w]) => [w * ph, l * ph] as const)
    emitCurves(sink, pts, true)
  } else sink.lineTo(0, 0)

  sink.closePath()
}

export function piecePath2D(geo: Geometry, row: number, col: number): Path2D {
  const p = new Path2D()
  emitPiecePath(geo, row, col, p)
  return p
}
