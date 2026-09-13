const MAX_SIDE = 1600

export type Decoded = ImageBitmap | HTMLImageElement

function loadImg(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem'))
    }
    img.src = url
  })
}

export async function decodeImage(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* fall through */
    }
  }
  return loadImg(blob)
}

export function sizeOf(img: Decoded): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight }
  return { w: img.width, h: img.height }
}

/**
 * Normalises an uploaded file: applies EXIF orientation, downsizes to MAX_SIDE
 * and re-encodes as JPEG so both peers work from identical pixels.
 */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const src = await decodeImage(file)
  const { w, h } = sizeOf(src)
  if (!w || !h) throw new Error('Imagem inválida')
  const k = Math.min(1, MAX_SIDE / Math.max(w, h))
  const width = Math.max(1, Math.round(w * k))
  const height = Math.max(1, Math.round(h * k))
  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(src, 0, 0, width, height)
  if ('close' in src) src.close()
  const blob = await new Promise<Blob | null>(res => cv.toBlob(res, 'image/jpeg', 0.88))
  if (!blob) throw new Error('Falha ao processar a imagem')
  return { blob, width, height }
}
