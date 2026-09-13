import type { PuzzleState } from './puzzle/types'

export type SavedRoom = {
  roomId: string
  role: 'host' | 'guest'
  state: PuzzleState
  image: Blob
  savedAt: number
}

const DB_NAME = 'puzzle-a-dois'
const STORE = 'rooms'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'roomId' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function saveRoom(room: SavedRoom): Promise<void> {
  try {
    await tx('readwrite', s => s.put(room))
  } catch (err) {
    console.warn('save failed', err)
  }
}

export async function loadRoom(roomId: string): Promise<SavedRoom | undefined> {
  try {
    return (await tx<SavedRoom | undefined>('readonly', s => s.get(roomId))) ?? undefined
  } catch {
    return undefined
  }
}

export async function latestRoom(): Promise<SavedRoom | undefined> {
  try {
    const all = await tx<SavedRoom[]>('readonly', s => s.getAll())
    return all.filter(r => r.role === 'host' && !r.state.finished).sort((a, b) => b.savedAt - a.savedAt)[0]
  } catch {
    return undefined
  }
}

export async function deleteRoom(roomId: string): Promise<void> {
  try {
    await tx('readwrite', s => s.delete(roomId))
  } catch {
    /* ignore */
  }
}
