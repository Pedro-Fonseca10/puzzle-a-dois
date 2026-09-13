import { confetti } from './confetti'
import { decodeImage } from './image'
import { Net } from './net/room'
import { hasOwnTurn, probeIce } from './net/turn'
import { applyDrop, bringToFront, computeSnap, groupById, moveGroup, progress } from './puzzle/engine'
import { buildGeometry, type Geometry } from './puzzle/geometry'
import { InputController } from './puzzle/input'
import { Renderer, type ViewState } from './puzzle/render'
import type { CursorMsg, DropMsg, MoveMsg, PuzzleState, SnapshotMsg } from './puzzle/types'
import { saveRoom } from './storage'

export type Role = 'host' | 'guest'
export type GameInit = { roomId: string; role: Role; image?: Blob; state?: PuzzleState }

const HOST_COLOR = '#ef6c4d'
const GUEST_COLOR = '#2a9d8f'
const MOVE_INTERVAL = 33
const CURSOR_INTERVAL = 40
/** Quanto esperar por um par antes de investigar a rede. */
const CONNECT_TIMEOUT = 15000

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export function roomLink(roomId: string): string {
  return `${location.origin}${location.pathname}${location.search}#room=${roomId}`
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export class Game {
  private net: Net
  state: PuzzleState | null = null
  private geo: Geometry | null = null
  renderer: Renderer | null = null
  private input: InputController | null = null
  private imageBlob: Blob | null = null
  private pendingState: PuzzleState | null = null
  private view: ViewState
  private locked = new Set<number>()
  private runningSince: number | null = null
  private timerHandle = 0
  private saveHandle = 0
  private pendingMove: MoveMsg | null = null
  private moveHandle = 0
  private lastCursorSent = 0
  private toastHandle = 0
  private connectHandle = 0
  private diagnosed = false
  private listeners: Array<() => void> = []

  constructor(private init: GameInit, private onExit: () => void) {
    this.view = {
      heldId: null,
      remoteHeldId: null,
      remoteCursor: null,
      remoteColor: init.role === 'host' ? GUEST_COLOR : HOST_COLOR,
      remoteLabel: '',
    }
    this.net = new Net(init.roomId, {
      onPeerJoin: id => void this.peerJoined(id),
      onPeerLeave: () => this.peerLeft(),
      onSnapshot: snap => void this.receiveSnapshot(snap),
      onImage: buf => void this.receiveImage(buf),
      onImageProgress: p => this.setWaitingProgress(p),
      onMove: m => this.remoteMove(m),
      onDrop: m => this.remoteDrop(m),
      onGrab: id => this.remoteGrab(id),
      onCursor: c => this.remoteCursor(c),
      onJoinError: msg => this.joinFailed(msg),
      onPeerFailed: () => this.peerFailed(),
    })
    this.bindHud()
  }

  async start(): Promise<void> {
    if (this.init.image && this.init.state) {
      await this.loadPuzzle(this.init.image, this.init.state)
      if (this.init.role === 'host' && this.net.peers.size === 0 && !this.init.state.finished) this.showShare()
    } else {
      $('waiting').hidden = false
    }
    this.setStatus()
    this.connectHandle = window.setTimeout(() => void this.diagnose(), CONNECT_TIMEOUT)
  }

  destroy(): void {
    this.flushSave()
    this.input?.destroy()
    clearInterval(this.timerHandle)
    clearTimeout(this.moveHandle)
    clearTimeout(this.connectHandle)
    for (const off of this.listeners) off()
    this.net.leave()
  }

  // ---------- setup ----------

  private async loadPuzzle(blob: Blob, state: PuzzleState): Promise<void> {
    this.imageBlob = blob
    this.pendingState = null
    const img = await decodeImage(blob)
    this.state = state
    this.geo = buildGeometry(state.config)
    this.locked.clear()
    this.view.heldId = null
    this.view.remoteHeldId = null

    this.input?.destroy()
    const canvas = $<HTMLCanvasElement>('board')
    this.renderer = new Renderer(canvas, this.geo, img, state.config)
    this.renderer.buildSprites()
    this.renderer.setFrameSource(() => [this.state!, this.view])
    this.renderer.fitTable()
    this.input = new InputController(canvas, this.renderer, {
      hitTest: (wx, wy) => this.renderer!.hitTest(this.state!, wx, wy, this.locked),
      groupPos: id => {
        const g = groupById(this.state!, id)
        return g ? { x: g.x, y: g.y } : null
      },
      onGrab: id => this.localGrab(id),
      onDrag: (id, x, y) => this.localDrag(id, x, y),
      onDrop: id => this.localDrop(id),
      onCursor: (x, y, visible) => this.localCursor(x, y, visible),
      onViewChange: () => {},
    })

    const onResize = () => this.renderer?.resize()
    window.addEventListener('resize', onResize)
    this.listeners.push(() => window.removeEventListener('resize', onResize))

    this.runningSince = state.finished ? null : performance.now()
    clearInterval(this.timerHandle)
    this.timerHandle = window.setInterval(() => this.updateTimer(), 250)
    this.updateTimer()
    this.updateProgress()
    $('waiting').hidden = true
    if (state.finished) this.showDone(false)
  }

  private bindHud(): void {
    const on = (id: string, ev: string, fn: (e: Event) => void) => {
      const el = $(id)
      el.addEventListener(ev, fn)
      this.listeners.push(() => el.removeEventListener(ev, fn))
    }
    on('btn-share', 'click', () => this.copyLink())
    on('btn-fit', 'click', () => this.renderer?.fitTable())
    on('btn-zoom-in', 'click', () => this.renderer?.zoomAt(this.renderer.width / 2, this.renderer.height / 2, 1.3))
    on('btn-zoom-out', 'click', () => this.renderer?.zoomAt(this.renderer.width / 2, this.renderer.height / 2, 1 / 1.3))
    on('btn-exit', 'click', () => this.onExit())
    on('share-copy', 'click', () => this.copyLink())
    on('share-close', 'click', () => ($('share').hidden = true))
    on('done-new', 'click', () => this.onExit())
    on('done-close', 'click', () => ($('done').hidden = true))
    on('net-help-close', 'click', () => this.hideNetHelp())

    const persist = () => {
      if (document.visibilityState === 'hidden') this.flushSave()
    }
    document.addEventListener('visibilitychange', persist)
    window.addEventListener('pagehide', this.flushSave)
    this.listeners.push(() => document.removeEventListener('visibilitychange', persist))
    this.listeners.push(() => window.removeEventListener('pagehide', this.flushSave))
  }

  // ---------- network ----------

  private async peerJoined(peerId: string): Promise<void> {
    clearTimeout(this.connectHandle)
    this.hideNetHelp()
    $('share').hidden = true
    this.setStatus()
    this.toast('Conectados! 💛')
    // As estatísticas só nomeiam o par vencedor depois que o ICE assenta.
    window.setTimeout(() => void this.showKind(), 1500)
    if (this.init.role === 'host' && this.state && this.imageBlob) {
      this.commitElapsed()
      try {
        await this.net.sendImage(this.imageBlob, peerId)
        this.net.sendSnapshot(this.state, peerId)
      } catch (err) {
        console.warn('failed to send puzzle', err)
      }
    } else if (this.init.role === 'guest' && !this.state) {
      $('waiting-title').textContent = 'Recebendo a foto…'
      $('waiting-text').textContent = 'Só um instante.'
    }
  }

  private peerLeft(): void {
    this.setStatus()
    this.diagnosed = false
    this.view.remoteCursor = null
    this.view.remoteHeldId = null
    this.locked.clear()
    this.renderer?.requestRender()
    this.toast('A outra pessoa saiu')
  }

  private async receiveSnapshot(snap: SnapshotMsg): Promise<void> {
    if (this.init.role === 'host') return
    const incoming = snap.state
    const same =
      this.state &&
      this.state.config.seed === incoming.config.seed &&
      this.state.config.cols === incoming.config.cols &&
      this.state.config.rows === incoming.config.rows
    if (same) {
      this.state = incoming
      this.locked.clear()
      this.view.heldId = null
      this.view.remoteHeldId = null
      this.runningSince = incoming.finished ? null : performance.now()
      this.updateProgress()
      this.renderer?.requestRender()
      if (incoming.finished) this.showDone(false)
      return
    }
    this.pendingState = incoming
    if (this.imageBlob) await this.loadPuzzle(this.imageBlob, incoming)
  }

  private async receiveImage(buf: ArrayBuffer): Promise<void> {
    if (this.init.role === 'host') return
    const blob = new Blob([buf], { type: 'image/jpeg' })
    if (this.pendingState) await this.loadPuzzle(blob, this.pendingState)
    else this.imageBlob = blob
  }

  private remoteMove(m: MoveMsg): void {
    if (!this.state || !this.geo) return
    if (m.id === this.view.heldId) return
    moveGroup(this.state, this.geo, m.id, m.x, m.y)
    bringToFront(this.state, m.id)
    this.renderer?.requestRender()
  }

  private remoteGrab(id: number): void {
    if (!this.state) return
    this.locked.add(id)
    this.view.remoteHeldId = id
    bringToFront(this.state, id)
    this.renderer?.requestRender()
  }

  private remoteDrop(m: DropMsg): void {
    if (!this.state || !this.geo) return
    this.locked.delete(m.id)
    if (this.view.remoteHeldId === m.id) this.view.remoteHeldId = null
    const done = applyDrop(this.state, this.geo, m)
    this.afterChange(done)
  }

  private remoteCursor(c: CursorMsg): void {
    this.view.remoteCursor = c
    this.renderer?.requestRender()
  }

  // ---------- local interaction ----------

  private localGrab(id: number): void {
    if (!this.state) return
    bringToFront(this.state, id)
    this.view.heldId = id
    if (this.net.peers.size) this.net.sendGrab(id)
    this.renderer?.requestRender()
  }

  private localDrag(id: number, x: number, y: number): void {
    if (!this.state || !this.geo) return
    const g = moveGroup(this.state, this.geo, id, x, y)
    if (!g) return
    this.renderer?.requestRender()
    if (!this.net.peers.size) return
    this.pendingMove = { id, x: g.x, y: g.y }
    if (!this.moveHandle) {
      this.moveHandle = window.setTimeout(() => {
        this.moveHandle = 0
        if (this.pendingMove) this.net.sendMove(this.pendingMove)
        this.pendingMove = null
      }, MOVE_INTERVAL)
    }
  }

  private localDrop(id: number): void {
    if (!this.state || !this.geo) return
    clearTimeout(this.moveHandle)
    this.moveHandle = 0
    this.pendingMove = null
    const msg = computeSnap(this.state, this.geo, id)
    const done = applyDrop(this.state, this.geo, msg)
    this.view.heldId = null
    if (this.net.peers.size) this.net.sendDrop(msg)
    this.afterChange(done)
  }

  private localCursor(x: number, y: number, visible: boolean): void {
    if (!this.net.peers.size) return
    const now = performance.now()
    if (visible && now - this.lastCursorSent < CURSOR_INTERVAL) return
    this.lastCursorSent = now
    this.net.sendCursor(visible ? { x, y } : null)
  }

  private afterChange(done: boolean): void {
    this.updateProgress()
    this.renderer?.requestRender()
    this.scheduleSave()
    if (done && this.runningSince !== null) this.finish()
  }

  // ---------- timer / progress / persistence ----------

  private elapsedNow(): number {
    if (!this.state) return 0
    return this.state.elapsedMs + (this.runningSince !== null ? performance.now() - this.runningSince : 0)
  }

  private commitElapsed(): void {
    if (!this.state || this.runningSince === null) return
    this.state.elapsedMs = this.elapsedNow()
    this.runningSince = performance.now()
  }

  private updateTimer(): void {
    $('timer').textContent = formatTime(this.elapsedNow())
  }

  private updateProgress(): void {
    if (!this.state) return
    $('progress').textContent = `${Math.round(progress(this.state) * 100)}%`
  }

  private finish(): void {
    this.commitElapsed()
    this.runningSince = null
    this.updateTimer()
    this.showDone(true)
    this.flushSave()
  }

  private showDone(celebrate: boolean): void {
    if (!this.state) return
    $('done-text').textContent = `Montaram ${this.state.config.cols * this.state.config.rows} peças em ${formatTime(this.state.elapsedMs)}.`
    $('done').hidden = false
    if (celebrate) confetti($<HTMLCanvasElement>('confetti'))
  }

  private scheduleSave(): void {
    if (this.init.role !== 'host') return
    clearTimeout(this.saveHandle)
    this.saveHandle = window.setTimeout(this.flushSave, 800)
  }

  private flushSave = (): void => {
    clearTimeout(this.saveHandle)
    if (this.init.role !== 'host' || !this.state || !this.imageBlob) return
    this.commitElapsed()
    void saveRoom({
      roomId: this.init.roomId,
      role: 'host',
      state: JSON.parse(JSON.stringify(this.state)) as PuzzleState,
      image: this.imageBlob,
      savedAt: Date.now(),
    })
  }

  // ---------- HUD helpers ----------

  private setStatus(): void {
    const dot = $('status').querySelector('.dot')!
    const text = $('status-text')
    if (this.net.peers.size > 0) {
      dot.className = 'dot ok'
      text.textContent = 'Conectados'
    } else {
      dot.className = 'dot'
      text.textContent = this.init.role === 'host' ? 'Aguardando a outra pessoa' : 'Procurando a sala…'
    }
  }

  // ---------- diagnóstico de rede ----------

  /** Distingue "conectado direto" de "conectado via retransmissão" no HUD. */
  private async showKind(): Promise<void> {
    if (this.net.peers.size === 0) return
    const kind = await this.net.kind()
    if (kind === 'relay') $('status-text').textContent = 'Conectados · via relay'
  }

  /**
   * Ninguém apareceu no prazo. Antes de culpar a outra pessoa, verifica se esta
   * rede consegue sequer produzir um candidato de retransmissão — sem ele, duas
   * redes diferentes com NAT restrito nunca fecham conexão.
   */
  private async diagnose(): Promise<void> {
    if (this.net.peers.size > 0 || this.diagnosed) return
    this.diagnosed = true
    const ice = await probeIce()
    if (this.net.peers.size > 0) return

    if (!ice.relay && !ice.srflx) {
      this.showNetHelp(
        'Sua rede está bloqueando a conexão',
        'Nem o STUN nem o TURN responderam daqui. Isso costuma ser firewall de rede corporativa ou VPN. ' +
          'Tente outra rede — mas note que dados móveis normalmente pioram, por causa do CGNAT da operadora.',
      )
    } else if (!ice.relay) {
      this.showNetHelp(
        'A retransmissão não está disponível',
        'Esta rede descobriu seu IP público, mas nenhum servidor de retransmissão (TURN) respondeu. ' +
          'Se vocês dois estiverem em redes diferentes com NAT restrito, a conexão não vai fechar. ' +
          (hasOwnTurn
            ? 'Verifique as credenciais do TURN configuradas no projeto.'
            : 'O projeto está usando o relay público gratuito, que é instável — configure um TURN próprio (ver README).'),
      )
    } else {
      this.showNetHelp(
        'Tudo certo do seu lado',
        'Sua rede está pronta para conectar, inclusive com retransmissão. ' +
          (this.init.role === 'host'
            ? 'Falta a outra pessoa abrir o link da sala.'
            : 'Quem criou a sala precisa estar com a página aberta no mesmo link.'),
      )
    }
  }

  private joinFailed(message: string): void {
    clearTimeout(this.connectHandle)
    this.showNetHelp(
      'Não foi possível entrar na sala',
      `O aperto de mão inicial falhou: ${message}. Recarregue a página; se persistir, sua rede pode estar ` +
        'bloqueando os relays usados para encontrar a outra pessoa.',
    )
  }

  private peerFailed(): void {
    this.setStatus()
    this.showNetHelp(
      'A conexão caiu',
      'A ligação com a outra pessoa se perdeu por problema de rede, não porque ela saiu. ' +
        'Vocês dois podem recarregar a página com o mesmo link para retomar de onde parou.',
    )
  }

  private showNetHelp(title: string, text: string): void {
    $('net-help-title').textContent = title
    $('net-help-text').textContent = text
    $('net-help').hidden = false
  }

  private hideNetHelp(): void {
    $('net-help').hidden = true
  }

  private setWaitingProgress(p: number): void {
    const bar = $('waiting-bar')
    bar.hidden = false
    ;(bar.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`
  }

  private showShare(): void {
    $<HTMLInputElement>('share-url').value = roomLink(this.init.roomId)
    $('share').hidden = false
  }

  private async copyLink(): Promise<void> {
    const url = roomLink(this.init.roomId)
    try {
      await navigator.clipboard.writeText(url)
      this.toast('Link copiado')
    } catch {
      const input = $<HTMLInputElement>('share-url')
      input.value = url
      $('share').hidden = false
      input.focus()
      input.select()
    }
  }

  private toast(msg: string): void {
    const el = $('toast')
    el.textContent = msg
    el.hidden = false
    clearTimeout(this.toastHandle)
    this.toastHandle = window.setTimeout(() => (el.hidden = true), 2200)
  }
}
