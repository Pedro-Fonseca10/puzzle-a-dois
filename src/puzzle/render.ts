import type { Geometry } from './geometry'
import { piecePath2D } from './geometry'
import type { PuzzleConfig, PuzzleState } from './types'

export type ViewState = {
  heldId: number | null
  remoteHeldId: number | null
  remoteCursor: { x: number; y: number } | null
  remoteColor: string
  remoteLabel: string
}

const BG = '#eeeeeb'
const TABLE = '#ffffff'
const TABLE_LINE = '#dedeD9'

export class Renderer {
  camera = { x: 0, y: 0, scale: 1 } // screen = (world - cam) * scale, in CSS px
  width = 0
  height = 0
  minScale = 0.05
  maxScale = 4

  private ctx: CanvasRenderingContext2D
  private hitCtx: CanvasRenderingContext2D
  private dpr = 1
  private sprites: HTMLCanvasElement[] = []
  private paths: Path2D[] = []
  private dirty = true
  private raf = 0
  private frame: (() => [PuzzleState, ViewState]) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private geo: Geometry,
    private image: CanvasImageSource,
    private cfg: PuzzleConfig,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.hitCtx = document.createElement('canvas').getContext('2d')!
    for (let r = 0; r < geo.rows; r++)
      for (let c = 0; c < geo.cols; c++) this.paths.push(piecePath2D(geo, r, c))
    this.resize()
  }

  /** Pre-renders each piece (image clipped to its outline, with a subtle bevel). */
  buildSprites(): void {
    const { pw, ph, pad, cols, rows } = this.geo
    const sw = Math.ceil(pw + 2 * pad), sh = Math.ceil(ph + 2 * pad)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const cv = document.createElement('canvas')
        cv.width = sw
        cv.height = sh
        const ctx = cv.getContext('2d')!
        const path = this.paths[i]
        // sprite origin corresponds to world (c*pw - pad, r*ph - pad)
        const sx = c * pw - pad, sy = r * ph - pad
        const sx0 = Math.max(0, sx), sy0 = Math.max(0, sy)
        const sx1 = Math.min(this.cfg.imgW, sx + sw), sy1 = Math.min(this.cfg.imgH, sy + sh)
        ctx.save()
        ctx.translate(pad, pad)
        ctx.clip(path)
        ctx.translate(-pad, -pad)
        if (sx1 > sx0 && sy1 > sy0) {
          ctx.drawImage(this.image, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - sx, sy0 - sy, sx1 - sx0, sy1 - sy0)
        }
        ctx.translate(pad, pad)
        // inner edge: dark line + faint highlight (half of each stroke is clipped away)
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(0,0,0,0.30)'
        ctx.lineWidth = Math.max(2, Math.min(pw, ph) * 0.02)
        ctx.stroke(path)
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.lineWidth = Math.max(1, Math.min(pw, ph) * 0.008)
        ctx.stroke(path)
        ctx.restore()
        this.sprites[i] = cv
      }
    }
  }

  setFrameSource(fn: () => [PuzzleState, ViewState]): void {
    this.frame = fn
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.width = rect.width
    this.height = rect.height
    this.canvas.width = Math.round(rect.width * this.dpr)
    this.canvas.height = Math.round(rect.height * this.dpr)
    this.requestRender()
  }

  fitTable(): void {
    const { tableW, tableH } = this.cfg
    const scale = Math.min(this.width / tableW, this.height / tableH) * 0.96
    this.camera.scale = scale
    this.minScale = scale * 0.5
    this.camera.x = tableW / 2 - this.width / (2 * scale)
    this.camera.y = tableH / 2 - this.height / (2 * scale)
    this.requestRender()
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.camera.x + sx / this.camera.scale, y: this.camera.y + sy / this.camera.scale }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.camera.x) * this.camera.scale, y: (wy - this.camera.y) * this.camera.scale }
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy)
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.camera.scale * factor))
    this.camera.scale = next
    this.camera.x = before.x - sx / next
    this.camera.y = before.y - sy / next
    this.clampCamera()
    this.requestRender()
  }

  panBy(dx: number, dy: number): void {
    this.camera.x -= dx / this.camera.scale
    this.camera.y -= dy / this.camera.scale
    this.clampCamera()
    this.requestRender()
  }

  /** Never lets the table drift completely out of view. */
  clampCamera(): void {
    const { tableW, tableH } = this.cfg
    const vw = this.width / this.camera.scale, vh = this.height / this.camera.scale
    const marginX = vw * 0.8, marginY = vh * 0.8
    this.camera.x = Math.min(Math.max(this.camera.x, -marginX), tableW - vw + marginX)
    this.camera.y = Math.min(Math.max(this.camera.y, -marginY), tableH - vh + marginY)
  }

  /** Topmost group under a world point, ignoring ids in `skip`. */
  hitTest(state: PuzzleState, wx: number, wy: number, skip: Set<number>): number | null {
    const { pw, ph, pad, cols } = this.geo
    for (let i = state.groups.length - 1; i >= 0; i--) {
      const g = state.groups[i]
      if (skip.has(g.id)) continue
      for (const p of g.pieces) {
        const r = Math.floor(p / cols), c = p % cols
        const lx = wx - (g.x + c * pw), ly = wy - (g.y + r * ph)
        if (lx < -pad || ly < -pad || lx > pw + pad || ly > ph + pad) continue
        if (this.hitCtx.isPointInPath(this.paths[p], lx, ly)) return g.id
      }
    }
    return null
  }

  requestRender(): void {
    this.dirty = true
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick())
  }

  private tick(): void {
    this.raf = 0
    if (!this.dirty || !this.frame) return
    this.dirty = false
    const [state, view] = this.frame()
    this.draw(state, view)
  }

  private draw(state: PuzzleState, view: ViewState): void {
    const { ctx, dpr, camera: cam } = this
    const { pw, ph, pad, cols } = this.geo
    const sw = Math.ceil(pw + 2 * pad), sh = Math.ceil(ph + 2 * pad)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.setTransform(cam.scale * dpr, 0, 0, cam.scale * dpr, -cam.x * cam.scale * dpr, -cam.y * cam.scale * dpr)
    ctx.fillStyle = TABLE
    ctx.fillRect(0, 0, this.cfg.tableW, this.cfg.tableH)
    ctx.strokeStyle = TABLE_LINE
    ctx.lineWidth = 1 / cam.scale
    ctx.strokeRect(0, 0, this.cfg.tableW, this.cfg.tableH)

    const vx0 = cam.x, vy0 = cam.y
    const vx1 = cam.x + this.width / cam.scale, vy1 = cam.y + this.height / cam.scale

    for (const g of state.groups) {
      const held = g.id === view.heldId
      if (held) {
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = 18 * dpr
        ctx.shadowOffsetY = 8 * dpr
      }
      for (const p of g.pieces) {
        const r = Math.floor(p / cols), c = p % cols
        const wx = g.x + c * pw - pad, wy = g.y + r * ph - pad
        if (wx + sw < vx0 || wy + sh < vy0 || wx > vx1 || wy > vy1) continue
        const sprite = this.sprites[p]
        if (sprite) ctx.drawImage(sprite, wx, wy, sw, sh)
      }
      if (held) ctx.restore()

      if (g.id === view.remoteHeldId) {
        ctx.save()
        ctx.strokeStyle = view.remoteColor
        ctx.lineWidth = 3 / cam.scale
        ctx.lineJoin = 'round'
        for (const p of g.pieces) {
          const r = Math.floor(p / cols), c = p % cols
          ctx.save()
          ctx.translate(g.x + c * pw, g.y + r * ph)
          ctx.stroke(this.paths[p])
          ctx.restore()
        }
        ctx.restore()
      }
    }

    // remote cursor, constant screen size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (view.remoteCursor) {
      const s = this.worldToScreen(view.remoteCursor.x, view.remoteCursor.y)
      if (s.x > -40 && s.y > -40 && s.x < this.width + 40 && s.y < this.height + 40) {
        ctx.save()
        ctx.translate(s.x, s.y)
        ctx.fillStyle = view.remoteColor
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, 18)
        ctx.lineTo(4.5, 13.5)
        ctx.lineTo(11.5, 13.5)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        if (view.remoteLabel) {
          ctx.font = '12px -apple-system, system-ui, sans-serif'
          const tw = ctx.measureText(view.remoteLabel).width
          ctx.fillStyle = view.remoteColor
          ctx.beginPath()
          ctx.roundRect(12, 16, tw + 12, 20, 10)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.textBaseline = 'middle'
          ctx.fillText(view.remoteLabel, 18, 26)
        }
        ctx.restore()
      }
    }
  }
}
