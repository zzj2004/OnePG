// ============================================================
// 角色数据（数据驱动：加角色 = 在这里填一份新数据，核心代码零改动）
// 招式是连段链：[起手, 二段, 挑飞]；命中开启连招窗口后可接下一段
// 角色0 = M0白盒基线（首段数值与旧版单招一致，保证回归测试语义）
// ============================================================
import type { CharacterDef, MoveDef } from './types'

/** 快捷构造：普通段 */
const m = (
  damage: number, kbMult: number, startup: number, active: number,
  recovery: number, hitW: number, hitH: number,
  extra: Partial<MoveDef> = {},
): MoveDef => ({ damage, kbMult, startup, active, recovery, hitW, hitH, ...extra })

export const CHARACTERS: [CharacterDef, CharacterDef, CharacterDef, CharacterDef] = [
  {
    id: 0,
    name: '疾风',
    weaponName: '双刃',
    weaponType: 0,
    speedMult: 1.12,
    jumpMult: 1.06,
    weight: 0.92, // <1 更容易被击飞
    unarmed: [
      m(8, 0.45, 4, 3, 8, 64, 44), // 1 快拳（基线伤害；轻击退保证连段可衔接）
      m(6, 0.4, 3, 3, 7, 60, 44, { lunge: 2.5 }), // 2 逆拳
      m(9, 0.9, 6, 4, 12, 70, 56, { upMult: 2.2, lunge: 3 }), // 3 旋风腿挑飞
    ],
    weapon: [
      m(7, 0.5, 3, 3, 6, 76, 40), // 1 双刃横斩（基线伤害）
      m(6, 0.38, 3, 3, 6, 72, 40, { lunge: 3 }), // 2 回斩
      m(9, 0.9, 5, 4, 10, 80, 62, { upMult: 2.4, lunge: 3.5 }), // 3 升龙斩挑飞
    ],
  },
  {
    id: 1,
    name: '磐石',
    weaponName: '巨锤',
    weaponType: 1,
    speedMult: 0.88,
    jumpMult: 0.95,
    weight: 1.18, // >1 更扛击飞
    unarmed: [
      m(11, 0.5, 6, 3, 11, 70, 48), // 1 重拳（基线伤害）
      m(9, 0.5, 5, 3, 10, 66, 48, { lunge: 2 }), // 2 崩肘
      m(14, 1.0, 9, 4, 16, 78, 62, { upMult: 2.5, lunge: 2.5 }), // 3 顶天肘挑飞
    ],
    weapon: [
      m(13, 0.8, 8, 4, 13, 88, 54), // 1 巨锤横扫（基线伤害，重武器击退略高）
      m(11, 0.55, 7, 4, 12, 84, 54, { lunge: 2 }), // 2 回马锤
      m(16, 1.0, 10, 5, 18, 92, 70, { upMult: 2.6, lunge: 2.5 }), // 3 开山锤挑飞
    ],
  },
  {
    id: 2,
    name: '惊雷',
    weaponName: '长枪',
    weaponType: 2,
    speedMult: 1.0,
    jumpMult: 1.0,
    weight: 1.0, // 完全平衡
    unarmed: [
      m(8, 0.45, 4, 3, 9, 60, 44), // 1 直拳
      m(7, 0.45, 3, 3, 8, 62, 44, { lunge: 2.5 }), // 2 连环拳
      m(10, 0.9, 6, 4, 12, 72, 58, { upMult: 2.3, lunge: 3 }), // 3 雷光脚挑飞
    ],
    weapon: [
      m(8, 0.5, 4, 3, 8, 112, 40, { lunge: 1.5 }), // 1 枪出如雷（超长判定）
      m(7, 0.4, 3, 3, 7, 104, 40, { lunge: 3 }), // 2 拨云枪
      m(11, 0.9, 7, 4, 13, 118, 56, { upMult: 2.4, lunge: 3.5 }), // 3 贯日枪挑飞
    ],
  },
  {
    id: 3,
    name: '青鸾',
    weaponName: '战扇',
    weaponType: 3,
    speedMult: 1.02,
    jumpMult: 1.22, // 跳得最高——空中特化
    weight: 0.85, // 最轻：难抓但也最容易飞
    unarmed: [
      m(7, 0.45, 4, 3, 8, 58, 48), // 1 燕踢
      m(6, 0.4, 3, 3, 7, 60, 48, { lunge: 2.5 }), // 2 双踢
      m(9, 0.9, 6, 4, 12, 72, 60, { upMult: 2.3, lunge: 3 }), // 3 旋踢挑飞
    ],
    weapon: [
      m(7, 0.5, 3, 3, 7, 92, 52), // 1 扇击（宽弧）
      m(6, 0.4, 3, 3, 7, 88, 52, { lunge: 3 }), // 2 回扇
      m(9, 0.9, 5, 4, 11, 96, 66, { upMult: 2.5, lunge: 3.5 }), // 3 风暴扇挑飞
    ],
  },
]

export function characterOf(id: 0 | 1 | 2 | 3): CharacterDef {
  return CHARACTERS[id]
}

/** 武器类型的名字（按武器类型而非角色） */
export const WEAPON_TYPE_NAMES = ['双刃', '巨锤', '长枪', '战扇'] as const
