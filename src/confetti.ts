const COLORS = ['#ef6c4d', '#2a9d8f', '#f4c95d', '#6c8ef5', '#e77fb3', '#1c1c1c']

type Particle = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string }

/** Lightweight confetti burst drawn on a dedicated overlay canvas. */
export function confetti(canvas: HTMLCanvasElement, durationMs = 4500): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = canvas.clientWidth, H = canvas.clientHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const parts: Particle[] = []
  for (let i = 0; i < 180; i++) {
    const fromLeft = i % 2 === 0
    parts.push({
      x: fromLeft ? -10 : W + 10,
      y: H * (0.3 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
      vy: -(8 + Math.random() * 8),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      color: COLORS[i % COLORS.length],
    })
  }

  const start = performance.now()
  const step = (now: number) => {
    const t = now - start
    ctx.clearRect(0, 0, W, H)
    const fade = t > durationMs - 800 ? Math.max(0, (durationMs - t) / 800) : 1
    for (const p of parts) {
      p.vy += 0.35
      p.vx *= 0.985
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      ctx.save()
      ctx.globalAlpha = fade
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }
    if (t < durationMs) requestAnimationFrame(step)
    else ctx.clearRect(0, 0, W, H)
  }
  requestAnimationFrame(step)
}
