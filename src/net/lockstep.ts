// ============================================================
// 锁帧同步会话：联机对战的节拍器
// 每帧双方互发按键位；收齐才推进模拟，绝不猜测、绝不假推
// ============================================================
import type { SimState } from '../core/types'
import type { NetTransport } from './transport'
import {
  decodeMessage,
  encodeMessage,
  EMPTY_BITS,
  stateChecksum,
  type InputBits,
  type NetMessage,
} from './protocol'

export const INPUT_DELAY = 3 // 输入延迟帧数（局域网 50ms 足够）
const CHECKSUM_EVERY = 60 // 每 60 帧互发一次状态校验和

export class NetSession {
  /** 下一个待推进的帧号（与 sim.tick 保持一致） */
  tick = 0
  /** 连续等待对方输入的帧数（>10 时界面提示"等待对手"） */
  waitingFrames = 0
  /** 检测到状态不同步（粘滞：一旦 true 保持 true） */
  desync = false
  desyncFrame = -1

  private local = new Map<number, InputBits>()
  private remote = new Map<number, InputBits>()
  private localChk = new Map<number, string>()
  private remoteChk = new Map<number, string>()

  constructor(
    private transport: NetTransport,
    readonly inputDelay: number = INPUT_DELAY,
  ) {
    transport.onMessage((data) => this.onMessage(data))
    // 注意：输入延迟窗口（前 inputDelay 帧）双方协议约定为空输入，
    // 不靠开局时发送——避免"预填消息比对方监听还早"的竞态
  }

  /** 每帧调用一次：把本地方案排入 inputDelay 帧之后的队列，并立即发给对方 */
  pushLocal(bits: InputBits): void {
    this.pushLocalAt(this.tick + this.inputDelay, bits)
  }

  private pushLocalAt(frame: number, bits: InputBits): void {
    if (this.local.has(frame)) return
    this.local.set(frame, bits)
    this.transport.send(encodeMessage({ t: 'in', f: frame, b: bits }))
  }

  /** 尝试推进一帧：返回 [本地方案, 对方输入]；null = 对方输入未到，本次不推进 */
  tryAdvance(): [InputBits, InputBits] | null {
    // 输入延迟窗口内的帧，协议定义为空输入（双方一致，无需传输）
    const l =
      this.local.get(this.tick) ??
      (this.tick < this.inputDelay ? EMPTY_BITS : undefined)
    const r =
      this.remote.get(this.tick) ??
      (this.tick < this.inputDelay ? EMPTY_BITS : undefined)
    if (l === undefined || r === undefined) {
      this.waitingFrames++
      return null
    }
    this.local.delete(this.tick)
    this.remote.delete(this.tick)
    const pair: [InputBits, InputBits] = [l, r]
    this.tick++
    this.waitingFrames = 0
    return pair
  }

  /** 每次成功推进后调用：定期计算并发送状态校验和 */
  afterStep(sim: SimState): void {
    const frame = this.tick - 1
    if (frame % CHECKSUM_EVERY === 0) {
      const h = stateChecksum(sim)
      this.localChk.set(frame, h)
      this.transport.send(encodeMessage({ t: 'chk', f: frame, h }))
      this.compare(frame)
    }
  }

  /** 重开一局：对齐两端到第 0 帧（联机按 R 重match 时用） */
  reset(): void {
    this.tick = 0
    this.waitingFrames = 0
    this.desync = false
    this.desyncFrame = -1
    this.local.clear()
    this.remote.clear()
    this.localChk.clear()
    this.remoteChk.clear()
  }

  private onMessage(data: string): void {
    const msg: NetMessage | null = decodeMessage(data)
    if (!msg) return
    if (msg.t === 'in') {
      this.remote.set(msg.f, msg.b)
    } else if (msg.t === 'chk') {
      this.remoteChk.set(msg.f, msg.h)
      this.compare(msg.f)
    }
  }

  /** 本地与远端校验和都到齐的帧，逐一比对 */
  private compare(frame: number): void {
    const lh = this.localChk.get(frame)
    const rh = this.remoteChk.get(frame)
    if (lh === undefined || rh === undefined) return
    if (lh !== rh && !this.desync) {
      this.desync = true
      this.desyncFrame = frame
    }
    this.localChk.delete(frame)
    this.remoteChk.delete(frame)
  }
}
