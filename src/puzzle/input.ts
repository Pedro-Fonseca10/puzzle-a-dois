import type { Renderer } from './render'

export interface InputHandlers {
  hitTest(wx: number, wy: number): number | null
  groupPos(id: number): { x: number; y: number } | null
  onGrab(id: number): void
  onDrag(id: number, x: number, y: number): void
  onDrop(id: number): void
  onCursor(wx: number, wy: number, visible: boolean): void
  onViewChange(): void
}

type P = { x: number; y: number; type: string }

/** Unifies mouse, pen and touch: drag pieces, pan the table, pinch/wheel to zoom. */
export class InputController {
  private pointers = new Map<number, P>()
  private mode: 'idle' | 'drag' | 'pan' | 'pinch' = 'idle'
  private drag: { id: number; offX: number; offY: number } | null = null
  private pan: { id: number; lastX: number; lastY: number } | null = null
  private pinch: { dist0: number; scale0: number; wx: number; wy: number } | null = null
  private rect: DOMRect

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, private h: InputHandlers) {
    this.rect = canvas.getBoundingClientRect()
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('pointerleave', this.onLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('resize', this.onResize)
  }

  destroy(): void {
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onUp)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.rect = this.canvas.getBoundingClientRect()
  }

  private local(e: PointerEvent) {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault()
    this.canvas.setPointerCapture(e.pointerId)
    const s = this.local(e)
    this.pointers.set(e.pointerId, { ...s, type: e.pointerType })

    if (this.pointers.size === 1) {
      const w = this.renderer.screenToWorld(s.x, s.y)
      const id = e.button === 0 || e.pointerType !== 'mouse' ? this.h.hitTest(w.x, w.y) : null
      if (id !== null) {
        const pos = this.h.groupPos(id)
        if (pos) {
          this.mode = 'drag'
          this.drag = { id, offX: pos.x - w.x, offY: pos.y - w.y }
          this.canvas.classList.add('dragging')
          this.h.onGrab(id)
          return
        }
      }
      this.mode = 'pan'
      this.pan = { id: e.pointerId, lastX: s.x, lastY: s.y }
    } else if (this.pointers.size === 2) {
      if (this.mode === 'drag' && this.drag) {
        this.h.onDrop(this.drag.id)
        this.drag = null
        this.canvas.classList.remove('dragging')
      }
      const [a, b] = [...this.pointers.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const w = this.renderer.screenToWorld(mid.x, mid.y)
      this.mode = 'pinch'
      this.pinch = { dist0: Math.hypot(a.x - b.x, a.y - b.y), scale0: this.renderer.camera.scale, wx: w.x, wy: w.y }
      this.pan = null
    }
  }

  private onMove = (e: PointerEvent) => {
    const s = this.local(e)
    const tracked = this.pointers.get(e.pointerId)
    if (tracked) {
      tracked.x = s.x
      tracked.y = s.y
    }

    if (this.mode === 'drag' && this.drag && tracked) {
      const w = this.renderer.screenToWorld(s.x, s.y)
      this.h.onDrag(this.drag.id, w.x + this.drag.offX, w.y + this.drag.offY)
      this.h.onCursor(w.x, w.y, true)
    } else if (this.mode === 'pan' && this.pan && this.pan.id === e.pointerId) {
      this.renderer.panBy(s.x - this.pan.lastX, s.y - this.pan.lastY)
      this.pan.lastX = s.x
      this.pan.lastY = s.y
      this.h.onViewChange()
      const w = this.renderer.screenToWorld(s.x, s.y)
      this.h.onCursor(w.x, w.y, true)
    } else if (this.mode === 'pinch' && this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const cam = this.renderer.camera
      const next = Math.min(this.renderer.maxScale, Math.max(this.renderer.minScale, this.pinch.scale0 * (dist / this.pinch.dist0)))
      cam.scale = next
      cam.x = this.pinch.wx - mid.x / next
      cam.y = this.pinch.wy - mid.y / next
      this.renderer.clampCamera()
      this.renderer.requestRender()
      this.h.onViewChange()
    } else if (e.pointerType === 'mouse') {
      const w = this.renderer.screenToWorld(s.x, s.y)
      this.h.onCursor(w.x, w.y, true)
    }
  }

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.mode === 'drag' && this.drag) {
      this.h.onDrop(this.drag.id)
      this.drag = null
      this.canvas.classList.remove('dragging')
      this.mode = 'idle'
    } else if (this.mode === 'pinch') {
      this.pinch = null
      if (this.pointers.size === 1) {
        const [[id, rest]] = [...this.pointers.entries()]
        this.mode = 'pan'
        this.pan = { id, lastX: rest.x, lastY: rest.y }
      } else this.mode = 'idle'
    } else if (this.mode === 'pan') {
      this.pan = null
      this.mode = 'idle'
    }
    if (p && p.type !== 'mouse') this.h.onCursor(0, 0, false)
  }

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.mode === 'idle') this.h.onCursor(0, 0, false)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const s = { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    this.renderer.zoomAt(s.x, s.y, Math.exp(-dy * 0.0022))
    this.h.onViewChange()
  }
}
