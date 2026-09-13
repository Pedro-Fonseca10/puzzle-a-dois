import './style.css'
import { Game } from './game'
import { prepareImage } from './image'
import { createState, makeConfig, progress } from './puzzle/engine'
import { randomId, randomSeed } from './rng'
import { latestRoom, loadRoom, saveRoom } from './storage'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

let chosen: { blob: Blob; width: number; height: number } | null = null
let pieces = 100
let game: Game | null = null

function roomFromHash(): string | null {
  const m = location.hash.match(/room=([a-z0-9]+)/i)
  return m ? m[1] : null
}

async function enterRoom(roomId: string): Promise<void> {
  $('lobby').hidden = true
  $('game').hidden = false
  const saved = await loadRoom(roomId)
  game = new Game(
    saved ? { roomId, role: saved.role, image: saved.image, state: saved.state } : { roomId, role: 'guest' },
    exitToLobby,
  )
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game
  await game.start()
}

function exitToLobby(): void {
  game?.destroy()
  game = null
  history.replaceState(null, '', location.pathname + location.search)
  location.reload()
}

// ---------- lobby ----------

async function handleFile(file: File | undefined): Promise<void> {
  if (!file) return
  const err = $('lobby-error')
  err.hidden = true
  try {
    $('drop-text').innerHTML = 'Preparando a foto…'
    chosen = await prepareImage(file)
    const preview = $<HTMLImageElement>('preview')
    preview.src = URL.createObjectURL(chosen.blob)
    preview.hidden = false
    $('drop').classList.add('has-image')
    $('drop-text').innerHTML = 'Trocar foto'
    $<HTMLButtonElement>('create').disabled = false
  } catch (e) {
    chosen = null
    err.textContent = e instanceof Error ? e.message : 'Não foi possível usar essa imagem.'
    err.hidden = false
    $('drop-text').innerHTML = 'Toque para escolher uma foto<br /><small>ou arraste aqui</small>'
  }
}

async function createRoom(): Promise<void> {
  if (!chosen) return
  const btn = $<HTMLButtonElement>('create')
  btn.disabled = true
  btn.textContent = 'Criando…'
  const cfg = makeConfig(chosen.width, chosen.height, pieces, randomSeed())
  const state = createState(cfg)
  const roomId = randomId()
  await saveRoom({ roomId, role: 'host', state, image: chosen.blob, savedAt: Date.now() })
  history.replaceState(null, '', `${location.pathname}${location.search}#room=${roomId}`)
  await enterRoom(roomId)
}

async function setupLobby(): Promise<void> {
  const fileInput = $<HTMLInputElement>('file')
  fileInput.addEventListener('change', () => void handleFile(fileInput.files?.[0]))

  const drop = $('drop')
  drop.addEventListener('dragover', e => {
    e.preventDefault()
    drop.classList.add('over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', e => {
    e.preventDefault()
    drop.classList.remove('over')
    void handleFile(e.dataTransfer?.files?.[0])
  })

  $('presets').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-n]')
    if (!btn) return
    pieces = Number(btn.dataset.n)
    for (const b of $('presets').querySelectorAll('button')) b.classList.toggle('active', b === btn)
  })

  $('create').addEventListener('click', () => void createRoom())

  const last = await latestRoom()
  if (last) {
    const card = $('resume')
    $<HTMLImageElement>('resume-thumb').src = URL.createObjectURL(last.image)
    const total = last.state.config.cols * last.state.config.rows
    $('resume-info').textContent = `${total} peças · ${Math.round(progress(last.state) * 100)}% montado`
    $('resume-btn').addEventListener('click', () => {
      history.replaceState(null, '', `${location.pathname}${location.search}#room=${last.roomId}`)
      void enterRoom(last.roomId)
    })
    card.hidden = false
  }
}

// ---------- boot ----------

window.addEventListener('hashchange', () => location.reload())

const roomId = roomFromHash()
if (roomId) void enterRoom(roomId)
else void setupLobby()
