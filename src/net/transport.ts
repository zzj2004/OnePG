// ============================================================
// 网络传输层：统一接口 + 两个实现
// - PeerTransport：PeerJS 公共服务撮合 + WebRTC 直连（真实局域网对战）
// - BroadcastTransport：同机双标签回环（开发/测试用，协议栈完全一致）
// ============================================================
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'

export interface NetTransport {
  readonly kind: 'peer' | 'loopback'
  send(data: string): void
  onMessage(cb: (data: string) => void): void
  onClose(cb: () => void): void
  /** 释放底层资源 */
  destroy(): void
}

// ---- PeerJS 实现 ----
export class PeerTransport implements NetTransport {
  readonly kind = 'peer' as const
  private peer: Peer | null = null
  private conn: DataConnection | null = null
  private msgCbs: ((data: string) => void)[] = []
  private closeCbs: (() => void)[] = []
  private destroyed = false
  private closed = false

  /** 连接成功后由 main 调用；发送前必须有连接 */
  attach(conn: DataConnection): void {
    this.conn = conn
    conn.on('data', (data) => {
      for (const cb of this.msgCbs) cb(String(data))
    })
    const emitClose = () => {
      if (this.closed || this.destroyed) return
      this.closed = true
      for (const cb of this.closeCbs) cb()
    }
    conn.on('close', emitClose)
    conn.on('error', emitClose)
    // ICE 断连/失败也要当成断线（后台标签页节流常导致连接悄悄死掉）
    conn.on('iceStateChanged', (state: string) => {
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        emitClose()
      }
    })
  }

  send(data: string): void {
    if (this.conn && this.conn.open) {
      this.conn.send(data)
    } else {
      // 通道已死还发数据 = 静默丢包，必须显式触发断线，让两端干净退出
      if (!this.closed && !this.destroyed) {
        this.closed = true
        for (const cb of this.closeCbs) cb()
      }
    }
  }
  onMessage(cb: (data: string) => void): void {
    this.msgCbs.push(cb)
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb)
  }
  destroy(): void {
    this.destroyed = true
    try {
      this.peer?.destroy()
    } catch {
      // 忽略销毁异常
    }
  }
  get isDestroyed(): boolean {
    return this.destroyed
  }

  /** 房主：以房间码注册到撮合服务，等待对手连接 */
  static host(
    code: string,
    hooks: {
      onReady: () => void
      onPeerJoined: () => void
      onError: (msg: string) => void
    },
  ): PeerTransport {
    const t = new PeerTransport()
    const peer = new Peer(`onepg-room-${code}`)
    t.peer = peer
    peer.on('open', () => hooks.onReady())
    peer.on('connection', (conn) => {
      if (t.conn) {
        // 房间已有对手，拒绝后来者
        conn.on('open', () => conn.close())
        return
      }
      t.attach(conn)
      conn.on('open', () => hooks.onPeerJoined())
    })
    peer.on('error', (err) => {
      if (!t.isDestroyed) hooks.onError(err.type ?? String(err))
    })
    return t
  }

  /** 对手：凭房间码连接房主 */
  static join(
    code: string,
    hooks: {
      onReady: () => void
      onError: (msg: string) => void
    },
  ): PeerTransport {
    const t = new PeerTransport()
    const peer = new Peer()
    t.peer = peer
    peer.on('open', () => {
      const conn = peer.connect(`onepg-room-${code}`, { reliable: true })
      t.attach(conn)
      conn.on('open', () => hooks.onReady())
      conn.on('error', () => hooks.onError('room-not-found'))
    })
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type ?? ''
      if (type === 'peer-unavailable') hooks.onError('room-not-found')
      else if (!t.isDestroyed) hooks.onError(type ?? String(err))
    })
    return t
  }
}

// ---- BroadcastChannel 回环实现（同机双标签，协议栈与真实联机一致） ----
export class BroadcastTransport implements NetTransport {
  readonly kind = 'loopback' as const
  private ch: BroadcastChannel
  private msgCbs: ((data: string) => void)[] = []
  private closeCbs: (() => void)[] = []

  constructor(room: string) {
    this.ch = new BroadcastChannel(`onepg-loop-${room}`)
    this.ch.onmessage = (e) => {
      for (const cb of this.msgCbs) cb(String(e.data))
    }
  }
  send(data: string): void {
    this.ch.postMessage(data)
  }
  onMessage(cb: (data: string) => void): void {
    this.msgCbs.push(cb)
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb)
  }
  destroy(): void {
    this.ch.close()
  }
}
