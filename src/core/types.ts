/** 一帧的按键输入（原始按住状态，"刚按下"的边沿由模拟核心自己推导） */
export interface PlayerInput {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  attack: boolean
  shield: boolean
  dodge: boolean
}

export function emptyInput(): PlayerInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: false,
    shield: false,
    dodge: false,
  }
}

/** 一个角色在某帧的完整状态。x/y = 脚底中心坐标 */
export interface Player {
  id: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  grounded: boolean
  platformId: number | null
  jumpsUsed: number
  coyote: number
  jumpBuffer: number
  dropTimer: number
  damage: number
  stocks: number
  out: boolean
  invuln: number
  hitstun: number
  attackTimer: number
  attackActive: boolean
  attackHasHit: boolean
  /** 本次攻击的蓄力档位（0/1/2），出招时确定 */
  attackTier: number
  /** 本次攻击的招式总帧数（前摇+判定+后摇，随角色/武器变化） */
  attackTotal: number
  /** 正在蓄力（攻击键按住中，未放出） */
  charging: boolean
  /** 蓄力已持续帧数 */
  chargeFrames: number
  /** 护盾值 0~SHIELD_MAX */
  shieldHp: number
  /** 是否处于防御状态 */
  shielding: boolean
  /** 通用行动硬直（收盾/闪避收招），>0 时不能行动 */
  actLag: number
  /** 闪避剩余帧数，>0 = 闪避中 */
  dodgeTimer: number
  /** 本次闪避是否为空中闪避 */
  dodgeAir: boolean
  /** 闪避冷却剩余帧数 */
  dodgeCooldown: number
  /** 使用的角色（0=疾风 1=磐石 2=惊雷 3=青鸾） */
  characterId: 0 | 1 | 2 | 3
  /** 手中武器类型；null = 空手 */
  weapon: 0 | 1 | 2 | 3 | null
  /** 拾取硬直剩余帧数 */
  pickupLag: number
  /** 双击冲刺：上一次同向按键的方向（0=无） */
  lastTapDir: -1 | 0 | 1
  /** 双击冲刺：上一次同向按键的帧号 */
  lastTapFrame: number
  /** 连段链当前段数（0 = 起手） */
  comboStep: number
  /** 连招窗口剩余帧数（命中后开启，窗口内可接下一段） */
  comboOpen: number
  /** 攻击中预输入的"接下一段" */
  chainQueued: boolean
}

/** 场上的一把掉落武器 */
export interface WeaponEntity {
  id: number
  /** 武器类型（0=双刃 1=巨锤 2=长枪 3=战扇） */
  type: 0 | 1 | 2 | 3
  x: number
  y: number // 底部高度
  vy: number
  grounded: boolean
  /** 刚刷出/掉落后的不可拾取帧数 */
  pickupCooldown: number
}

/** 角色定义（数据驱动，见 characters.ts）。招式是"连段链"，index 0 为起手 */
export interface MoveDef {
  damage: number
  kbMult: number
  startup: number
  active: number
  recovery: number
  hitW: number
  hitH: number
  /** 竖直击飞倍率（末段挑飞用，默认 1） */
  upMult?: number
  /** 出招滑步（px/帧，向前位移的惯性） */
  lunge?: number
}

export interface CharacterDef {
  id: 0 | 1 | 2 | 3
  name: string
  /** 专属武器名 */
  weaponName: string
  /** 专属武器类型 */
  weaponType: 0 | 1 | 2 | 3
  speedMult: number
  jumpMult: number
  /** 体重：被击飞时击飞力度除以该值 */
  weight: number
  /** 空手连段链（≥1 段） */
  unarmed: MoveDef[]
  /** 专属武器连段链（≥1 段） */
  weapon: MoveDef[]
}

export type MatchMode = 'pvp' | 'pve'

/** 一局比赛的配置（从菜单带入） */
export interface MatchSettings {
  mode: MatchMode
  p1Char: 0 | 1 | 2 | 3
  p2Char: 0 | 1 | 2 | 3
  mapId: 0 | 1 | 2
  /** 新手教学：假人不还手、命数无限 */
  tutorial?: boolean
  /** 训练场：同教学规则，另配连击统计面板 */
  training?: boolean
  /** 人机难度（0 简单 / 1 普通 / 2 困难），默认 1 */
  aiLevel?: 0 | 1 | 2
}

export interface SimState {
  tick: number
  hitstop: number
  /** 0 = 进行中；1/2 = 该编号玩家获胜 */
  matchOver: 0 | 1 | 2
  settings: MatchSettings
  players: [Player, Player]
  prev: [PlayerInput, PlayerInput]
  /** 场上掉落的武器 */
  weapons: WeaponEntity[]
  /** 距下一次武器刷新的帧数 */
  weaponTimer: number
  /** 已刷新武器计数（刷新点轮换用，确定性） */
  weaponSpawnCount: number
  /** 下一个武器实体 id */
  nextWeaponId: number
  /** AI 决策：当前行为与计划截止帧 */
  aiAction: string
  aiUntil: number
  aiNextThink: number
  /** AI 伪随机种子（LCG，确定性） */
  aiSeed: number
}
