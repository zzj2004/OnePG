// ============================================================
// 联机协议：输入位编码、状态校验和、握手消息
// 全部纯函数，核心之外，不碰 DOM / 网络 API
// ============================================================
import type { MatchSettings, SimState } from '../core/types'

/** 协议版本：两端不一致拒绝开战 */
export const NET_VERSION = 'onepg-m3.1'

/** 输入位定义（1 字节装 7 个键） */
export const BIT = {
  left: 1,
  right: 2,
  up: 4,
  down: 8,
  attack: 16,
  shield: 32,
  dodge: 64,
} as const

export type InputBits = number

export function encodeInput(input: {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  attack: boolean
  shield: boolean
  dodge: boolean
}): InputBits {
  let b = 0
  if (input.left) b |= BIT.left
  if (input.right) b |= BIT.right
  if (input.up) b |= BIT.up
  if (input.down) b |= BIT.down
  if (input.attack) b |= BIT.attack
  if (input.shield) b |= BIT.shield
  if (input.dodge) b |= BIT.dodge
  return b
}

export function decodeInput(bits: InputBits): {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  attack: boolean
  shield: boolean
  dodge: boolean
} {
  return {
    left: (bits & BIT.left) !== 0,
    right: (bits & BIT.right) !== 0,
    up: (bits & BIT.up) !== 0,
    down: (bits & BIT.down) !== 0,
    attack: (bits & BIT.attack) !== 0,
    shield: (bits & BIT.shield) !== 0,
    dodge: (bits & BIT.dodge) !== 0,
  }
}

export const EMPTY_BITS = 0

// ---- 状态校验和：FNV-1a 32位，逐帧比对防"两台电脑算岔" ----

/** 提取参与校验的状态快照（字段增减会改变哈希——这是特性，逼两端跑同一版本） */
export function stateFingerprint(sim: SimState): string {
  return JSON.stringify({
    t: sim.tick,
    p: sim.players,
    w: sim.weapons,
    seed: sim.aiSeed,
  })
}

export function checksum(fingerprint: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < fingerprint.length; i++) {
    h ^= fingerprint.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function stateChecksum(sim: SimState): string {
  return checksum(stateFingerprint(sim))
}

// ---- 消息类型（JSON 走数据通道，局域网带宽足够） ----
export type NetMessage =
  | { t: 'hello'; v: string } // 连接后第一句，互报版本
  | { t: 'cfg'; v: string; settings: MatchSettings } // 主机下发对局配置
  | { t: 'cfgAck'; v: string } // 客户端确认配置
  | { t: 'go' } // 主机宣布开战
  | { t: 'in'; f: number; b: InputBits } // 每帧按键
  | { t: 'chk'; f: number; h: string } // 每 60 帧状态校验
  | { t: 'rematch' } // 对局结束后请求重开（任一方按 R）
  | { t: 'toselect' } // 对局结束后返回选人（任一方按 C）
  | { t: 'pick'; c: number } // 联机各自选人：对手报自己选的角色
  | { t: 'bye' } // 好聚好散

export function encodeMessage(msg: NetMessage): string {
  return JSON.stringify(msg)
}

export function decodeMessage(data: string): NetMessage | null {
  try {
    return JSON.parse(data) as NetMessage
  } catch {
    return null
  }
}

/** 生成 4 位房间码（去掉易混淆字符） */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function makeRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

/** 房间码合法性检查（加入房间时输入用） */
export function isValidRoomCode(input: string): boolean {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(input)
}
