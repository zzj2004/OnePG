// ============================================================
// OnePG 手感参数面板（M0 白盒）
// 单位约定：速度 = 像素/帧，时间 = 帧（1 帧 = 1/60 秒）
// 改完保存，浏览器页面自动热更新，立刻能试
// ============================================================

/** 模拟节拍：每秒固定步数。这是确定性模拟的心跳，改之前先商量 */
export const TICK_RATE = 60

/** 角色碰撞体尺寸（像素） */
export const PLAYER_W = 48
export const PLAYER_H = 72

// ---- 地面移动 ----
export const GROUND_MAX_SPEED = 7 // 地面跑动极限
export const GROUND_ACCEL = 1.4 // 起步加速度（拧大 = 起步贼快）
export const GROUND_FRICTION = 1.0 // 地面刹车（拧大 = 停得脆）

// ---- 空中移动 ----
export const AIR_MAX_SPEED = 7 // 空中水平极限（只约束操作，不约束击飞惯性）
export const AIR_ACCEL = 0.9 // 空中操控性（拧小 = 更飘）
export const AIR_DRAG = 0.08 // 空中无输入时的阻力（击飞速度衰减快慢）

// ---- 跳跃 ----
export const JUMP_VEL = 16 // 地面起跳力度
export const DOUBLE_JUMP_VEL = 15 // 空中二段跳力度
export const MAX_JUMPS = 2 // 总跳数：1 = 地面跳，2 = 二段跳
export const COYOTE_FRAMES = 6 // 土狼时间：走出平台边缘后几帧内仍可起跳
export const JUMP_BUFFER_FRAMES = 6 // 跳跃预输入：落地前几帧按跳会被记住

// ---- 重力与下落 ----
export const GRAVITY = 0.85 // 重力
export const FALL_CAP = 14 // 普通下落极限
export const FAST_FALL_MULT = 1.7 // 空中按住"下"时的重力倍率（快速下落）
export const FAST_FALL_CAP = 20 // 快速下落极限

// ---- 下穿软平台 ----
export const DROP_THROUGH_FRAMES = 12 // 下穿后多少帧内忽略软平台

// ---- 攻击（M0 唯一招式：横扫）----
export const ATTACK_STARTUP = 4 // 前摇：按攻击到判定出现的帧数
export const ATTACK_ACTIVE = 3 // 判定持续帧数
export const ATTACK_RECOVERY = 8 // 后摇：判定结束到可再次行动
export const ATTACK_HITBOX_W = 64 // 判定盒宽
export const ATTACK_HITBOX_H = 44 // 判定盒高
export const ATTACK_DAMAGE = 8 // 每次命中的伤害

// ---- 击飞与受击 ----
export const KNOCKBACK_BASE = 9 // 击飞基础值
export const KNOCKBACK_SCALE = 0.22 // 击飞随伤害成长的系数
export const KNOCKBACK_CAP = 30 // 击飞上限
export const KNOCKBACK_UP_RATIO = 0.55 // 击飞中向上分量的比例
export const HITSTUN_BASE = 12 // 受击僵直基础帧数
export const HITSTUN_SCALE = 0.5 // 僵直随击飞力度成长的系数
export const HITSTOP_FRAMES = 6 // 顿帧：命中瞬间全场冻结（打击感总开关）

// ---- 生死与重生 ----
export const START_STOCKS = 3 // 每人命数
export const RESPAWN_X = 640 // 重生点
export const RESPAWN_Y = 160
export const RESPAWN_INVULN = 90 // 重生无敌帧
export const SPAWN_INVULN = 90 // 开局无敌帧
export const BLAST_LEFT = -360 // 出界线：越过即死
export const BLAST_RIGHT = 1640
export const BLAST_TOP = -560
export const BLAST_BOTTOM = 940

// ============================================================
// M1 战斗系统参数
// ============================================================

// ---- 防御（护盾）----
export const SHIELD_MAX = 100 // 护盾值上限
export const SHIELD_REGEN_PER_FRAME = 0.15 // 非防御状态每帧回复
export const SHIELD_COST_BASE = 16 // 挡一刀基础代价
export const SHIELD_COST_PER_TIER = 12 // 攻击每高一个蓄力档位，额外代价
export const SHIELD_BREAK_STUN = 90 // 破防大硬直帧数
export const SHIELD_MIN_TO_START = 15 // 护盾值低于此不能开盾（破防后喘息期）
export const SHIELD_DROP_LAG = 6 // 松盾后的收盾硬直
export const SHIELD_PUSHBACK = 5 // 防御方被推的距离
export const SHIELD_ATTACKER_PUSHBACK = 3 // 攻击方被弹的距离
export const SHIELD_HITSTOP = 5 // 挡刀顿帧（比命中短，区分手感）

// ---- 闪避（无敌帧）----
export const DODGE_FRAMES = 22 // 地面翻滚总时长
export const DODGE_IFRAME_START = 4 // 无敌窗起点（帧）
export const DODGE_IFRAME_END = 16 // 无敌窗终点（不含）
export const DODGE_SPEED = 11 // 翻滚速度
export const AIR_DODGE_FRAMES = 26 // 空中闪避总时长
export const AIR_DODGE_IFRAME_START = 4
export const AIR_DODGE_IFRAME_END = 18
export const AIR_DODGE_SPEED = 7 // 空中闪避水平速度
export const AIR_DODGE_VY_DAMP = 0.3 // 空中闪避瞬间竖直速度衰减
export const DODGE_END_LAG = 6 // 收招硬直
export const DODGE_COOLDOWN = 60 // 冷却（从起手算）

// ---- 蓄力攻击 ----
export const CHARGE_T1 = 20 // 档1需要按住的帧数
export const CHARGE_T2 = 45 // 满蓄需要按住的帧数
export const CHARGE_AUTO_RELEASE = 75 // 蓄满后再按住这么多帧自动放出
export const CHARGE_DMG_MULT = [1, 1.6, 2.4] as const // 各档伤害倍率
export const CHARGE_KB_MULT = [1, 1.5, 2.2] as const // 各档击飞倍率
export const CHARGE_KB_CAP_BONUS = 0.3 // 每档位击飞上限额外放大比例

// ---- 陪练 AI ----
export const AI_THINK_INTERVAL = 9 // 每 N 帧重新决策（越小反应越快）
export const AI_SEED = 20260904 // 固定种子：确定性伪随机，可测试可回放
export const AI_REACH_X = 95 // 出手距离（水平）
export const AI_REACH_Y = 70 // 出手距离（垂直）

// ============================================================
// M2 武器与内容参数
// ============================================================

export const WEAPON_FIRST_SPAWN = 300 // 开局多久刷第一把武器（帧）
export const WEAPON_SPAWN_INTERVAL = 900 // 之后每多久刷一把（15秒）
export const WEAPON_PICKUP_LAG = 12 // 拾取硬直（不能白捡还白打）
export const WEAPON_PICKUP_COOLDOWN = 12 // 刚刷出的武器几帧内不可拾取（防瞬吸动画穿帮）
export const WEAPON_OFFSIGNATURE_MULT = 0.7 // 非专属武器威力折扣
export const WEAPON_SIZE = 34 // 武器拾取判定框宽高
