// ============================================================
// 手柄支持（浏览器标准 Gamepad API，Xbox/PS 标准布局）
// 摇杆/十字键 = 移动，A = 跳，X = 攻击(按住蓄力)，B = 防御，Y = 闪避
// 输入层职责：把手柄状态翻译成 PlayerInput，合并规则由 main 决定
// ============================================================
import type { PlayerInput } from '../core/types'
import { emptyInput } from '../core/types'

const DEADZONE = 0.35

/** 手柄快照（与浏览器 API 解耦，方便测试） */
export interface PadSnapshot {
  axes: readonly number[]
  buttons: readonly { pressed: boolean }[]
}

/** 手柄 → 输入。同方向多来源（摇杆+十字键+按键）取或 */
export function padToInput(pad: PadSnapshot): PlayerInput {
  const inp = emptyInput()
  const ax = pad.axes[0] ?? 0
  const ay = pad.axes[1] ?? 0
  const btn = (i: number): boolean => pad.buttons[i]?.pressed ?? false

  if (ax < -DEADZONE || btn(14)) inp.left = true // 左摇杆左 / 十字键左
  if (ax > DEADZONE || btn(15)) inp.right = true // 右
  if (ay > DEADZONE || btn(13)) inp.down = true // 下（快速下落/下穿）
  if (ay < -DEADZONE || btn(12)) inp.up = true // 上
  if (btn(0)) inp.up = true // A/交叉 = 跳
  if (btn(2)) inp.attack = true // X/方块 = 攻击（按住蓄力）
  if (btn(1)) inp.shield = true // B/圆圈 = 防御
  if (btn(3)) inp.dodge = true // Y/三角 = 闪避
  return inp
}

/** 读取当前连接的手柄列表（断开的槽位为 null） */
export function pollGamepads(): (PadSnapshot | null)[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
  return Array.from(navigator.getGamepads()).map((p) =>
    p ? { axes: p.axes, buttons: p.buttons } : null,
  )
}
