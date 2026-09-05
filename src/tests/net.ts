// ============================================================
// 联机层自动化测试（npm run test 的第二段）
// 协议往返 / 校验和 / 双会话内存总线全链路锁帧
// ============================================================
import { NetSession } from '../net/lockstep'
import {
  BIT,
  checksum,
  decodeInput,
  encodeInput,
  stateChecksum,
} from '../net/protocol'
import type { NetTransport } from '../net/transport'
import { createInitialSim, step } from '../core/simulation'
import type { PlayerInput } from '../core/types'
import { emptyInput } from '../core/types'

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅ 通过' : '❌ 失败'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed = true
}

// ---- 1. 位编码往返：0~127 全部组合 ----
let roundtripOk = true
for (let bits = 0; bits < 128; bits++) {
  const input = decodeInput(bits)
  if (encodeInput(input) !== bits) roundtripOk = false
}
check('联机·输入位编码 128 种组合全部往返一致', roundtripOk)

// ---- 2. 单键位定义互不冲突 ----
check(
  '联机·7 个键位定义互不重叠',
  new Set(Object.values(BIT)).size === 7,
)

// ---- 3. 校验和：确定性 + 敏感性 ----
const simA = createInitialSim('pvp')
const simB = createInitialSim('pvp')
check(
  '联机·同一状态两遍哈希一致',
  stateChecksum(simA) === stateChecksum(simB),
)
simB.players[0].x += 1
check(
  '联机·状态任一数值变化哈希必变',
  stateChecksum(simA) !== stateChecksum(simB),
)
check(
  '联机·校验和为 8 位十六进制',
  /^[0-9a-f]{8}$/.test(checksum('onepg')),
)

// ---- 4. 双会话内存总线：完整锁帧链路 ----
class Bus {
  private ends: MemoryTransport[] = []
  register(t: MemoryTransport): void {
    this.ends.push(t)
  }
  deliver(from: MemoryTransport, data: string): void {
    for (const t of this.ends) {
      if (t !== from) t.receive(data)
    }
  }
}

class MemoryTransport implements NetTransport {
  readonly kind = 'loopback' as const
  private cbs: ((data: string) => void)[] = []
  private closeCbs: (() => void)[] = []
  constructor(private bus: Bus) {
    this.bus.register(this)
  }
  receive(data: string): void {
    for (const cb of this.cbs) cb(data)
  }
  send(data: string): void {
    this.bus.deliver(this, data)
  }
  onMessage(cb: (data: string) => void): void {
    this.cbs.push(cb)
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb)
  }
  close(): void {
    for (const cb of this.closeCbs) cb()
  }
  destroy(): void {
    this.close()
  }
}

// 双方输入脚本：P1 与 P2 各自的"按键时间表"（覆盖移动/跳跃/攻击）
const p1Script = (f: number): PlayerInput => {
  const p = emptyInput()
  if (f <= 35) p.right = true
  if (f === 92) p.attack = true
  if (f >= 130 && f < 160) p.left = true
  if (f === 170 || f === 180) p.up = true
  if (f >= 190 && f < 220) p.right = true
  if (f === 280) p.attack = true
  return p
}
const p2Script = (f: number): PlayerInput => {
  const p = emptyInput()
  if (f === 400) p.up = true
  if (f >= 500 && f < 560) p.left = true
  if (f === 570) p.attack = true
  if (f >= 600 && f < 640) p.right = true
  if (f === 700) p.shield = true
  return p
}

{
  const bus = new Bus()
  const tA = new MemoryTransport(bus)
  const tB = new MemoryTransport(bus)
  const sessionA = new NetSession(tA)
  const sessionB = new NetSession(tB)
  const simA = createInitialSim('pvp')
  const simB = createInitialSim('pvp')

  const TOTAL = 900
  let stalled = 0
  let maxP2Damage = 0
  let f = 1
  while (f <= TOTAL) {
    sessionA.pushLocal(encodeInput(p1Script(f)))
    sessionB.pushLocal(encodeInput(p2Script(f)))
    const pairA = sessionA.tryAdvance()
    const pairB = sessionB.tryAdvance()
    if (pairA === null || pairB === null) {
      stalled++
      continue // 模拟等待对方输入（真实网络里就是这里在等）
    }
    const inputA: [PlayerInput, PlayerInput] = [
      decodeInput(pairA[0]),
      decodeInput(pairA[1]),
    ]
    // 注意：两个模拟都是 [P1, P2] 顺序；会话 B 的本地输入是 P2，要换回来
    const inputB: [PlayerInput, PlayerInput] = [
      decodeInput(pairB[1]),
      decodeInput(pairB[0]),
    ]
    step(simA, inputA)
    step(simB, inputB)
    sessionA.afterStep(simA)
    sessionB.afterStep(simB)
    maxP2Damage = Math.max(maxP2Damage, simA.players[1].damage)
    f++
  }

  check(
    '联机·双会话推进 900 帧且帧号一致',
    simA.tick === TOTAL && simB.tick === TOTAL,
    `A=${simA.tick} B=${simB.tick}（含 ${stalled} 次等待）`,
  )
  check(
    '联机·两端状态校验和完全一致（无不同步）',
    stateChecksum(simA) === stateChecksum(simB) &&
      !sessionA.desync &&
      !sessionB.desync,
  )
  check(
    '联机·链路上战斗真实发生过（命中造成伤害）',
    maxP2Damage > 0,
    `P2 最大伤害 ${Math.floor(maxP2Damage)}%`,
  )
}

// ---- 5. 输入缺失时锁帧必须停下（宁可停，不可岔） ----
{
  const bus = new Bus()
  const tA = new MemoryTransport(bus)
  new MemoryTransport(bus) // 对端存在但不推送任何输入
  const session = new NetSession(tA)
  for (let i = 0; i < 10; i++) {
    session.pushLocal(0)
    session.tryAdvance()
  }
  check(
    '联机·对方输入缺失时推进冻结在第 3 帧',
    session.tick === 3 && session.waitingFrames > 0,
    `tick=${session.tick}`,
  )
}

// ---- 6. NetSession.reset：联机重开对齐两端 ----
{
  const bus = new Bus()
  const sA = new NetSession(new MemoryTransport(bus))
  const sB = new NetSession(new MemoryTransport(bus))
  for (let f = 1; f <= 150; f++) {
    sA.pushLocal(0)
    sB.pushLocal(0)
    const a = sA.tryAdvance()
    const b = sB.tryAdvance()
    if (a && b) {
      sA.tick = f
      sB.tick = f
    }
  }
  sA.reset()
  sB.reset()
  check(
    '联机·reset 后两端会话对齐回第 0 帧',
    sA.tick === 0 && sB.tick === 0 && !sA.desync,
  )
}

if (failed) {
  throw new Error('联机测试未通过：上面的 ❌ 项必须先修好')
}
console.log('\n联机测试全部通过 ✔')
