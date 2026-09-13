/**
 * Retransmissão TURN e diagnóstico de ICE.
 *
 * WebRTC direto não passa em NAT simétrico (comum em CGNAT de operadora e em
 * redes corporativas). Nesses casos a conexão só acontece através de um
 * servidor TURN, que retransmite o tráfego já criptografado.
 *
 * As credenciais vêm de variáveis de ambiente do Vite: `.env.local` no
 * desenvolvimento e secrets do repositório no deploy (ver README). Num site
 * estático elas acabam visíveis no bundle — por isso use uma conta com cota
 * limitada e troque a credencial se notar consumo estranho.
 */

export type TurnServer = { urls: string[]; username?: string; credential?: string }

const read = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const host = read(import.meta.env.VITE_TURN_HOST)
const username = read(import.meta.env.VITE_TURN_USERNAME)
const credential = read(import.meta.env.VITE_TURN_CREDENTIAL)

/** True quando há um TURN próprio configurado, em vez do relay público. */
export const hasOwnTurn = Boolean(host && username && credential)

/**
 * Relay público do Open Relay Project, usado só enquanto não há TURN próprio.
 * É best-effort: os endereços saem do ar sem aviso.
 */
const FALLBACK: TurnServer = {
  urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
  username: 'openrelayproject',
  credential: 'openrelayproject',
}

/**
 * As quatro URLs cobrem cenários progressivamente mais restritivos: UDP nas
 * portas 80 e 443 para a maioria das redes, TCP quando o UDP está bloqueado, e
 * `turns:` (TLS sobre TCP) na 443 para firewalls que só deixam passar o que
 * parece HTTPS. O navegador tenta todas e fica com a primeira que responder.
 */
export function turnServers(): TurnServer[] {
  if (!hasOwnTurn) return [FALLBACK]
  return [
    {
      urls: [
        `turn:${host}:80`,
        `turn:${host}:80?transport=tcp`,
        `turn:${host}:443`,
        `turns:${host}:443?transport=tcp`,
      ],
      username,
      credential,
    },
  ]
}

/** Dois STUN porque o do Google falha em algumas redes; basta um responder. */
const STUN = ['stun:stun.relay.metered.ca:80', 'stun:stun.l.google.com:19302']

/** iceServers equivalentes aos que o Trystero monta, para uso no diagnóstico. */
function iceServers(): RTCIceServer[] {
  return [{ urls: STUN }, ...turnServers()]
}

export type IceProbe = {
  /** Candidatos da própria máquina — sempre presentes; sozinhos só servem na mesma rede. */
  host: boolean
  /** O STUN respondeu e descobriu o IP público. */
  srflx: boolean
  /** O TURN respondeu e aceitou alocar uma porta de retransmissão. */
  relay: boolean
}

/**
 * Abre uma conexão descartável só para ver quais tipos de candidato ICE a rede
 * atual consegue produzir. Sem `relay`, duas pessoas em redes diferentes com
 * NAT restrito não têm como se conectar.
 */
export async function probeIce(timeoutMs = 8000): Promise<IceProbe> {
  const result: IceProbe = { host: false, srflx: false, relay: false }
  if (typeof RTCPeerConnection === 'undefined') return result

  const pc = new RTCPeerConnection({ iceServers: iceServers() })
  try {
    pc.createDataChannel('probe')
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeoutMs)
      const finish = () => {
        clearTimeout(timer)
        resolve()
      }
      pc.onicecandidate = e => {
        // Candidato nulo marca o fim da coleta.
        if (!e.candidate) return finish()
        const type = e.candidate.type ?? e.candidate.candidate.split(' ')[7]
        if (type === 'relay') {
          result.relay = true
          finish() // achou o que importa, não precisa esperar o resto
        } else if (type === 'srflx' || type === 'prflx') {
          result.srflx = true
        } else if (type === 'host') {
          result.host = true
        }
      }
    })
  } catch (err) {
    console.warn('ice probe failed', err)
  } finally {
    pc.close()
  }
  return result
}

export type ConnectionKind = 'direct' | 'relay' | 'unknown'

/** Descobre se o par em uso passa por TURN ou é ponto a ponto direto. */
export async function connectionKind(pc: RTCPeerConnection): Promise<ConnectionKind> {
  try {
    const stats = await pc.getStats()
    let pairId: string | null = null
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.localCandidateId) pairId = r.localCandidateId as string
    })
    if (!pairId) return 'unknown'
    const local = stats.get(pairId) as { candidateType?: string } | undefined
    if (!local?.candidateType) return 'unknown'
    return local.candidateType === 'relay' ? 'relay' : 'direct'
  } catch {
    return 'unknown'
  }
}
