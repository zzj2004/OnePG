import type { PlayerInput } from '../core/types'

// ============================================================
// 键位映射：默认键位 + 用户自定义覆盖（localStorage 持久化）
// 改键走界面（标题菜单按 3），也可以直接改 DEFAULT_KEYMAPS
// 键帽名参考 KeyboardEvent.code：KeyA=字母A，ArrowLeft=左方向键，Numpad0=小键盘0
// ============================================================
export type ActionName =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'attack'
  | 'shield'
  | 'dodge'
export type PlayerSlot = 'p1' | 'p2'
export type Keymap = Record<ActionName, string[]>

export const DEFAULT_KEYMAPS: Record<PlayerSlot, Keymap> = {
  p1: {
    left: ['KeyA'],
    right: ['KeyD'],
    up: ['KeyW'],
    down: ['KeyS'],
    attack: ['KeyF'],
    shield: ['KeyG'],
    dodge: ['KeyH'],
  },
  p2: {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up: ['ArrowUp', 'Space'], // 空格 = P2 副跳跃键（照顾"空格跳"的习惯）
    down: ['ArrowDown'],
    attack: ['Numpad0', 'Slash'], // 没有小键盘的笔记本可用 / 键
    shield: ['Numpad1', 'Period'],
    dodge: ['Numpad2', 'ShiftRight'],
  },
}

export const ACTIONS: ActionName[] = [
  'left',
  'right',
  'up',
  'down',
  'attack',
  'shield',
  'dodge',
]
export const ACTION_NAMES: Record<ActionName, string> = {
  left: '向左',
  right: '向右',
  up: '跳跃',
  down: '下/快落',
  attack: '攻击/蓄力',
  shield: '防御',
  dodge: '闪避',
}
export const SLOT_NAMES: Record<PlayerSlot, string> = {
  p1: 'P1（红）',
  p2: 'P2（蓝）',
}

const STORAGE_KEY = 'onepg-keybinds'

// 用户覆盖表：如 { "p2.attack": "KeyM" }（数组第一项被替换）
type Overrides = Record<string, string>
let overrides: Overrides = loadOverrides()

function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Overrides) : {}
  } catch {
    return {} // 非浏览器环境（测试）或解析失败：用默认键位
  }
}

function saveOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // 无法持久化时静默降级：本次会话内仍然生效
  }
}

/** 当前生效的键位表（默认 + 用户覆盖） */
export function getKeymaps(): Record<PlayerSlot, Keymap> {
  const merged: Record<PlayerSlot, Keymap> = {
    p1: { ...DEFAULT_KEYMAPS.p1 },
    p2: { ...DEFAULT_KEYMAPS.p2 },
  }
  for (const [key, code] of Object.entries(overrides)) {
    const [slot, action] = key.split('.') as [PlayerSlot, ActionName]
    if (merged[slot] && merged[slot][action]) merged[slot][action] = [code]
  }
  return merged
}

/** 设置一条绑定并持久化 */
export function setBinding(slot: PlayerSlot, action: ActionName, code: string): void {
  overrides[`${slot}.${action}`] = code
  saveOverrides()
}

/** 清空自定义，恢复默认 */
export function resetBindings(): void {
  overrides = {}
  saveOverrides()
}

export const ALL_BOUND_CODES: ReadonlySet<string> = new Set(
  Object.values(DEFAULT_KEYMAPS).flatMap((m) =>
    Object.values(m).flat(),
  ),
)

/** 需要拦下浏览器默认行为（滚动/搜索）的游戏键（含用户自定义的） */
export function gameKeys(): ReadonlySet<string> {
  return new Set(
    Object.values(getKeymaps()).flatMap((m) => Object.values(m).flat()),
  )
}

export function readInput(held: ReadonlySet<string>, map: Keymap): PlayerInput {
  const any = (codes: readonly string[]): boolean => codes.some((c) => held.has(c))
  return {
    left: any(map.left),
    right: any(map.right),
    up: any(map.up),
    down: any(map.down),
    attack: any(map.attack),
    shield: any(map.shield),
    dodge: any(map.dodge),
  }
}

/** 键帽代号 → 人话（菜单显示用） */
export function keyDisplayName(code: string): string {
  const table: Record<string, string> = {
    Space: '空格',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Enter: '回车',
    Escape: 'Esc',
    ShiftLeft: '左Shift',
    ShiftRight: '右Shift',
    ControlLeft: '左Ctrl',
    ControlRight: '右Ctrl',
    Period: '句号',
    Comma: '逗号',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Tab: 'Tab',
    Backquote: '`',
  }
  if (table[code]) return table[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6)
  return code
}
