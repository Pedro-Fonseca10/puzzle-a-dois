import { joinRoom, selfId, type Room } from 'trystero'
import type { CursorMsg, DropMsg, MoveMsg, PuzzleState, SnapshotMsg } from '../puzzle/types'

export const APP_ID = 'puzzle-a-dois-v1'
export { selfId }

export interface NetHandlers {
  onPeerJoin(peerId: string): void
  onPeerLeave(peerId: string): void
  onSnapshot(snap: SnapshotMsg, peerId: string): void
  onImage(buf: ArrayBuffer, peerId: string): void
  onImageProgress(fraction: number): void
  onMove(m: MoveMsg): void
  onDrop(m: DropMsg): void
  onGrab(id: number): void
  onCursor(c: CursorMsg): void
}

/** Thin wrapper over a Trystero room: one action per message kind. */
export class Net {
  readonly room: Room
  readonly peers = new Set<string>()
  private snapshot
  private image
  private move
  private drop
  private grab
  private cursor

  constructor(roomId: string, h: NetHandlers) {
    this.room = joinRoom(
      {
        appId: APP_ID,
        // Free public TURN relay as a fallback for restrictive NATs (best effort).
        turnConfig: [
          {
            urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        relayConfig: { warnOnRelayFailure: false },
      },
      roomId,
    )

    this.snapshot = this.room.makeAction<SnapshotMsg>('snapshot')
    this.image = this.room.makeAction<Blob | ArrayBuffer | Uint8Array>('image')
    this.move = this.room.makeAction<MoveMsg>('move')
    this.drop = this.room.makeAction<DropMsg>('drop')
    this.grab = this.room.makeAction<number>('grab')
    this.cursor = this.room.makeAction<CursorMsg>('cursor')

    this.room.onPeerJoin = id => {
      this.peers.add(id)
      h.onPeerJoin(id)
    }
    this.room.onPeerLeave = id => {
      this.peers.delete(id)
      h.onPeerLeave(id)
    }
    this.snapshot.onMessage = (data, { peerId }) => h.onSnapshot(data, peerId)
    this.image.onMessage = (data, { peerId }) => {
      // Trystero reassembles binary payloads as a Uint8Array; normalise to ArrayBuffer.
      if (data instanceof ArrayBuffer) h.onImage(data, peerId)
      else if (ArrayBuffer.isView(data)) h.onImage(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, peerId)
    }
    this.image.onReceiveProgress = p => h.onImageProgress(p)
    this.move.onMessage = m => h.onMove(m)
    this.drop.onMessage = m => h.onDrop(m)
    this.grab.onMessage = id => h.onGrab(id)
    this.cursor.onMessage = c => h.onCursor(c)
  }

  async sendImage(blob: Blob, target?: string): Promise<void> {
    await this.image.send(blob, { target })
  }
  sendSnapshot(state: PuzzleState, target?: string): void {
    void this.snapshot.send({ state }, { target })
  }
  sendMove(m: MoveMsg): void {
    void this.move.send(m)
  }
  sendDrop(m: DropMsg): void {
    void this.drop.send(m)
  }
  sendGrab(id: number): void {
    void this.grab.send(id)
  }
  sendCursor(c: CursorMsg): void {
    void this.cursor.send(c)
  }
  leave(): void {
    void this.room.leave()
  }
}
