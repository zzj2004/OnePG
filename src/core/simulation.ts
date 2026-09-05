// ============================================================
// 确定性模拟核心
// 铁律：本文件禁止出现 DOM、Date、Math.random、真实时间。
// 同样的初始状态 + 同样的输入序列，在任何电脑上必须算出完全一样的结果。
// AI 的"随机"来自固定种子的整数 LCG，同样满足确定性。
// ============================================================
import {
  AIR_ACCEL,
  AIR_DODGE_FRAMES,
  AIR_DODGE_IFRAME_END,
  AIR_DODGE_IFRAME_START,
  AIR_DODGE_SPEED,
  AIR_DODGE_VY_DAMP,
  AIR_DRAG,
  AIR_MAX_SPEED,
  AI_REACH_X,
  AI_REACH_Y,
  AI_SEED,
  AI_THINK_INTERVAL,
  ATTACK_ACTIVE,
  ATTACK_RECOVERY,
  ATTACK_STARTUP,
  BLAST_BOTTOM,
  BLAST_LEFT,
  BLAST_RIGHT,
  BLAST_TOP,
  CHARGE_AUTO_RELEASE,
  CHARGE_DMG_MULT,
  CHARGE_KB_CAP_BONUS,
  CHARGE_KB_MULT,
  CHARGE_T1,
  CHARGE_T2,
  COYOTE_FRAMES,
  DOUBLE_JUMP_VEL,
  DROP_THROUGH_FRAMES,
  DODGE_COOLDOWN,
  DODGE_END_LAG,
  DODGE_FRAMES,
  DODGE_IFRAME_END,
  DODGE_IFRAME_START,
  DODGE_SPEED,
  FALL_CAP,
  FAST_FALL_CAP,
  FAST_FALL_MULT,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  GROUND_MAX_SPEED,
  HITSTUN_BASE,
  HITSTUN_SCALE,
  HITSTOP_FRAMES,
  JUMP_BUFFER_FRAMES,
  JUMP_VEL,
  KNOCKBACK_BASE,
  KNOCKBACK_CAP,
  KNOCKBACK_SCALE,
  KNOCKBACK_UP_RATIO,
  MAX_JUMPS,
  PLAYER_H,
  PLAYER_W,
  RESPAWN_INVULN,
  RESPAWN_X,
  RESPAWN_Y,
  SHIELD_ATTACKER_PUSHBACK,
  SHIELD_BREAK_STUN,
  SHIELD_COST_BASE,
  SHIELD_COST_PER_TIER,
  SHIELD_DROP_LAG,
  SHIELD_HITSTOP,
  SHIELD_MAX,
  SHIELD_MIN_TO_START,
  SHIELD_PUSHBACK,
  SHIELD_REGEN_PER_FRAME,
  SPAWN_INVULN,
  START_STOCKS,
  WEAPON_FIRST_SPAWN,
  WEAPON_OFFSIGNATURE_MULT,
  WEAPON_PICKUP_COOLDOWN,
  WEAPON_SPAWN_INTERVAL,
  WEAPON_SIZE,
} from './constants'
import { characterOf } from './characters'
import { mapOf } from './stage'
import type {
  CharacterDef,
  MatchMode,
  MatchSettings,
  MoveDef,
  Player,
  PlayerInput,
  SimState,
  WeaponEntity,
} from './types'
import { emptyInput } from './types'

const DEFAULT_SETTINGS: MatchSettings = {
  mode: 'pvp',
  p1Char: 0,
  p2Char: 0,
  mapId: 0,
}

export function createInitialSim(
  modeOrSettings: MatchMode | MatchSettings = 'pvp',
  overrides: Partial<MatchSettings> = {},
): SimState {
  const settings: MatchSettings =
    typeof modeOrSettings === 'string'
      ? { ...DEFAULT_SETTINGS, mode: modeOrSettings, ...overrides }
      : { ...DEFAULT_SETTINGS, ...modeOrSettings }
  const map = mapOf(settings.mapId)
  const mk = (id: 0 | 1, characterId: 0 | 1 | 2 | 3): Player => ({
    id,
    x: map.spawns[id],
    y: 560,
    vx: 0,
    vy: 0,
    facing: id === 0 ? 1 : -1,
    grounded: true,
    platformId: 0,
    jumpsUsed: 0,
    coyote: COYOTE_FRAMES,
    jumpBuffer: 0,
    dropTimer: 0,
    damage: 0,
    stocks: settings.tutorial || settings.training ? 99 : START_STOCKS,
    out: false,
    invuln: SPAWN_INVULN,
    hitstun: 0,
    attackTimer: 0,
    attackActive: false,
    attackHasHit: false,
    attackTier: 0,
    attackTotal: ATTACK_STARTUP + ATTACK_ACTIVE + ATTACK_RECOVERY,
    charging: false,
    chargeFrames: 0,
    shieldHp: SHIELD_MAX,
    shielding: false,
    actLag: 0,
    dodgeTimer: 0,
    dodgeAir: false,
    dodgeCooldown: 0,
    characterId,
    weapon: null,
    pickupLag: 0,
    comboStep: 0,
    comboOpen: 0,
    chainQueued: false,
  })
  return {
    tick: 0,
    hitstop: 0,
    matchOver: 0,
    settings,
    players: [mk(0, settings.p1Char), mk(1, settings.p2Char)],
    prev: [emptyInput(), emptyInput()],
    weapons: [],
    weaponTimer: settings.tutorial || settings.training ? 120 : WEAPON_FIRST_SPAWN, // 教学关 2 秒就刷武器
    weaponSpawnCount: 0,
    nextWeaponId: 1,
    aiAction: 'approach',
    aiUntil: 0,
    aiNextThink: 0,
    aiSeed: AI_SEED >> 0,
  }
}

// ---- 角色与招式数据入口 ----
function charOf(p: Player): CharacterDef {
  return characterOf(p.characterId)
}
/** 当前可用的连段链（空手 / 手中武器） */
function chainOf(p: Player): MoveDef[] {
  const c = charOf(p)
  // 招式跟武器走：双刃就是双刃的数据，谁拿着都一样（威力差异见 offSignature）
  return p.weapon === null ? c.unarmed : characterOf(p.weapon).weapon
}
/** 当前连段段的招式数据 */
function currentMove(p: Player): MoveDef {
  const chain = chainOf(p)
  return chain[Math.min(p.comboStep, chain.length - 1)]
}
/** 是否拿着非本命武器（威力打七折） */
function offSignature(p: Player): boolean {
  return p.weapon !== null && p.weapon !== charOf(p).weaponType
}

/** 推进一帧。inputs = 两名玩家本帧的按键状态；人机模式下 P2 的输入由 AI 生成 */
export function step(
  s: SimState,
  humanInputs: readonly [PlayerInput, PlayerInput?],
): void {
  s.tick++
  if (s.matchOver !== 0) return
  if (s.hitstop > 0) {
    s.hitstop--
    return
  }
  const inputs: [PlayerInput, PlayerInput] = [
    humanInputs[0],
    s.settings.mode === 'pve' ? aiInput(s) : humanInputs[1]!,
  ]
  stepWeapons(s)
  stepPlayer(s, 0, inputs[0])
  stepPlayer(s, 1, inputs[1])
  resolveHits(s)
  checkBlastzones(s)
  s.prev = [{ ...inputs[0] }, { ...inputs[1] }]
}

/** 是否处于"可自由行动"状态 */
function canAct(p: Player): boolean {
  return (
    p.hitstun === 0 &&
    p.attackTimer === 0 &&
    !p.charging &&
    p.dodgeTimer === 0 &&
    p.actLag === 0 &&
    p.pickupLag === 0 &&
    !p.shielding
  )
}

/** 闪避无敌帧判定 */
export function dodgeInvulnerable(p: Player): boolean {
  if (p.dodgeTimer <= 0) return false
  const total = p.dodgeAir ? AIR_DODGE_FRAMES : DODGE_FRAMES
  const elapsed = total - p.dodgeTimer
  const start = p.dodgeAir ? AIR_DODGE_IFRAME_START : DODGE_IFRAME_START
  const end = p.dodgeAir ? AIR_DODGE_IFRAME_END : DODGE_IFRAME_END
  return elapsed >= start && elapsed < end
}

// ---- 武器：刷新 / 下落 / 拾取 ----
function stepWeapons(s: SimState): void {
  const map = mapOf(s.settings.mapId)

  // 场上没有无主武器时才计时刷新；刷新点按次数轮换（确定性）
  if (s.weapons.length === 0) {
    if (s.weaponTimer > 0) {
      s.weaponTimer--
    } else {
      const point = map.weaponSpawns[s.weaponSpawnCount % map.weaponSpawns.length]
      const type = (s.weaponSpawnCount % 4) as 0 | 1 | 2 | 3
      s.weapons.push({
        id: s.nextWeaponId++,
        type,
        x: point.x,
        y: point.y,
        vy: 0,
        grounded: true,
        pickupCooldown: WEAPON_PICKUP_COOLDOWN,
      })
      s.weaponSpawnCount++
      s.weaponTimer = WEAPON_SPAWN_INTERVAL
    }
  }

  // 武器下落（与平台单向碰撞规则一致）
  for (const w of s.weapons) {
    if (w.pickupCooldown > 0) w.pickupCooldown--
    if (w.grounded) continue
    w.vy += GRAVITY * 0.6
    const prevY = w.y
    w.y += w.vy
    if (w.vy >= 0) {
      for (const plat of map.platforms) {
        if (
          prevY <= plat.y &&
          w.y >= plat.y &&
          w.x > plat.x &&
          w.x < plat.x + plat.w
        ) {
          w.y = plat.y
          w.vy = 0
          w.grounded = true
          break
        }
      }
    }
  }
}

function tryPickup(s: SimState, p: Player): void {
  if (p.pickupLag > 0) p.pickupLag--
  if (
    p.weapon !== null ||
    p.hitstun > 0 ||
    p.attackTimer > 0 ||
    p.charging ||
    p.shielding ||
    p.dodgeTimer > 0
  ) {
    return
  }
  for (let k = 0; k < s.weapons.length; k++) {
    const w = s.weapons[k]
    if (w.pickupCooldown > 0) continue
    const inX = Math.abs(w.x - p.x) < PLAYER_W / 2 + WEAPON_SIZE / 2
    const inY = w.y > p.y - PLAYER_H - 20 && w.y < p.y + 20
    if (inX && inY) {
      p.weapon = w.type
      p.pickupLag = 12 // 拾取硬直
      s.weapons.splice(k, 1)
      return
    }
  }
}

function stepPlayer(s: SimState, i: 0 | 1, inp: PlayerInput): void {
  const p = s.players[i]
  const prev = s.prev[i]
  const pressed = (k: keyof PlayerInput): boolean => inp[k] && !prev[k]
  const c = charOf(p)

  if (p.invuln > 0) p.invuln--
  if (p.dropTimer > 0) p.dropTimer--
  if (p.hitstun > 0) p.hitstun--
  if (p.actLag > 0) p.actLag--
  if (p.dodgeCooldown > 0) p.dodgeCooldown--
  // 连招窗口倒计时：窗口走完连段归零
  if (p.comboOpen > 0) {
    p.comboOpen--
    if (p.comboOpen === 0) p.comboStep = 0
  }

  // ---- 蓄力推进（优先级最高：按住攻击键不放 = 蓄力中） ----
  if (p.charging) {
    p.chargeFrames++
    // 蓄力中可转身（用户拍板的差异点）：转向跟随输入，但不移动
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
    if (dir !== 0) p.facing = dir as 1 | -1
    // 惯性滑出平台边缘 = 空中，蓄力作废（空中攻击不蓄力——设计铁律）
    if (!p.grounded) {
      p.charging = false
      p.comboStep = 0
    } else if (!inp.attack || p.chargeFrames >= CHARGE_AUTO_RELEASE) {
      // 松手（或蓄满自动）放出攻击
      p.charging = false
      startAttack(
        p,
        p.chargeFrames >= CHARGE_T2 ? 2 : p.chargeFrames >= CHARGE_T1 ? 1 : 0,
      )
    }
  }

  // ---- 闪避 ----
  if (p.dodgeTimer > 0) {
    p.dodgeTimer--
    if (p.dodgeTimer === 0) p.actLag = DODGE_END_LAG
  } else if (pressed('dodge') && canAct(p) && p.dodgeCooldown === 0) {
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
    p.dodgeAir = !p.grounded
    p.dodgeTimer = p.dodgeAir ? AIR_DODGE_FRAMES : DODGE_FRAMES
    p.dodgeCooldown = DODGE_COOLDOWN
    if (p.dodgeAir) {
      p.vx = dir * AIR_DODGE_SPEED
      p.vy *= AIR_DODGE_VY_DAMP
    } else {
      p.vx = dir !== 0 ? dir * DODGE_SPEED : 0 // 无输入 = 原地闪
    }
  }

  // ---- 防御（护盾）----
  const wantShield =
    inp.shield &&
    p.grounded &&
    p.hitstun === 0 &&
    p.attackTimer === 0 &&
    !p.charging &&
    p.dodgeTimer === 0
  if (p.shielding) {
    if (!inp.shield || !p.grounded) {
      p.shielding = false
      p.actLag = SHIELD_DROP_LAG
    }
  } else if (wantShield && p.shieldHp >= SHIELD_MIN_TO_START) {
    p.shielding = true
  }
  if (!p.shielding && p.shieldHp < SHIELD_MAX) {
    p.shieldHp = Math.min(SHIELD_MAX, p.shieldHp + SHIELD_REGEN_PER_FRAME)
  }

  // ---- 出招 ----
  // 攻击中命中后按攻击 = 预输入"接下一段"（招式结束时自动衔接）
  if (pressed('attack') && p.attackTimer > 0 && p.attackHasHit) {
    p.chainQueued = true
  }
  if (pressed('attack') && canAct(p)) {
    if (p.grounded) {
      const chain = chainOf(p)
      if (p.comboOpen > 0 && p.comboStep < chain.length - 1) {
        // 连招窗口内：直接接下一段（跳过蓄力）
        p.comboStep++
        p.comboOpen = 0
        startAttack(p, 0)
      } else {
        // 地面：进入蓄力等待，松手才真正出招（蓄力重置连段）
        p.comboStep = 0
        p.chainQueued = false
        p.charging = true
        p.chargeFrames = 0
      }
    } else {
      // 空中：立即出招，不蓄力、不连段
      p.comboStep = 0
      startAttack(p, 0)
    }
  }
  if (p.attackTimer > 0) {
    const ms = currentMove(p)
    const phase = p.attackTotal - p.attackTimer
    p.attackActive = phase >= ms.startup && phase < ms.startup + ms.active
    p.attackTimer--
    if (p.attackTimer === 0) {
      p.attackActive = false
      // 招式结束：检查预输入，自动衔接下一段
      if (p.chainQueued) {
        p.chainQueued = false
        const chain = chainOf(p)
        if (p.comboOpen > 0 && p.grounded && p.comboStep < chain.length - 1) {
          p.comboStep++
          p.comboOpen = 0
          startAttack(p, 0)
        }
      }
    }
  }

  // ---- 跳跃 / 下穿软平台 ----
  if (pressed('up')) p.jumpBuffer = JUMP_BUFFER_FRAMES
  if (p.jumpBuffer > 0) p.jumpBuffer--

  if (p.jumpBuffer > 0 && canAct(p)) {
    const map = mapOf(s.settings.mapId)
    const onSoft =
      p.grounded &&
      p.platformId !== null &&
      map.platforms[p.platformId] !== undefined &&
      map.platforms[p.platformId].soft
    if (onSoft && inp.down) {
      // 下穿软平台：不算跳跃，不消耗空中跳
      p.grounded = false
      p.platformId = null
      p.dropTimer = DROP_THROUGH_FRAMES
      p.y += 4
      p.jumpsUsed = 0
      p.jumpBuffer = 0
    } else if (p.grounded || p.coyote > 0) {
      p.vy = -JUMP_VEL * c.jumpMult
      p.grounded = false
      p.platformId = null
      p.coyote = 0
      p.jumpsUsed = 1
      p.jumpBuffer = 0
    } else if (p.jumpsUsed < MAX_JUMPS) {
      p.vy = -DOUBLE_JUMP_VEL * c.jumpMult
      p.jumpsUsed = MAX_JUMPS
      p.jumpBuffer = 0
    }
  }

  // ---- 水平移动：转向即时生效（跟手）；攻击恢复帧允许走位（微调距离用） ----
  const controllable = p.hitstun === 0
  const inRecovery =
    p.attackTimer > 0 &&
    p.attackTotal - p.attackTimer >=
      currentMove(p).startup + currentMove(p).active
  const canSteer = controllable && (canAct(p) || inRecovery)
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0)
  if (canSteer && dir !== 0) {
    p.facing = dir as 1 | -1
    const accel = (p.grounded ? GROUND_ACCEL : AIR_ACCEL) * c.speedMult
    const max = (p.grounded ? GROUND_MAX_SPEED : AIR_MAX_SPEED) * c.speedMult
    // 击飞产生的超额速度不被操作瞬间钳回，只在同向未超速时加速
    if (!(Math.sign(p.vx) === dir && Math.abs(p.vx) > max)) {
      p.vx += dir * accel
      if (Math.abs(p.vx) > max) p.vx = dir * max
    }
  } else if (controllable) {
    // 无方向输入 / 不可操作：地面摩擦 / 空气阻力（受击僵直中不衰减，保留击飞动能）
    if (p.grounded) {
      const friction =
        p.shielding || p.charging ? GROUND_FRICTION * 2 : GROUND_FRICTION
      if (Math.abs(p.vx) <= friction) p.vx = 0
      else p.vx -= Math.sign(p.vx) * friction
    } else if (p.vx !== 0) {
      const d = Math.min(Math.abs(p.vx), AIR_DRAG)
      p.vx -= Math.sign(p.vx) * d
    }
  }

  // ---- 重力与位移 ----
  if (!p.grounded) {
    const fast = p.vy > 0 && inp.down && controllable && p.dodgeTimer === 0
    const g = fast ? GRAVITY * FAST_FALL_MULT : GRAVITY
    const cap = fast ? FAST_FALL_CAP : FALL_CAP
    p.vy += g
    if (p.vy > cap) p.vy = cap
  }

  const prevY = p.y
  p.x += p.vx
  p.y += p.vy

  // ---- 平台碰撞：全部单向，仅在下落时从上方落上去 ----
  const map = mapOf(s.settings.mapId)
  const wasGrounded = p.grounded
  p.grounded = false
  let landedOn: number | null = null
  if (p.vy >= 0) {
    for (const plat of map.platforms) {
      if (plat.soft && p.dropTimer > 0) continue
      if (
        prevY <= plat.y &&
        p.y >= plat.y &&
        p.x + PLAYER_W / 2 > plat.x &&
        p.x - PLAYER_W / 2 < plat.x + plat.w
      ) {
        p.y = plat.y
        p.vy = 0
        p.grounded = true
        landedOn = plat.id
        break
      }
    }
  }
  if (p.grounded) {
    p.jumpsUsed = 0
    p.coyote = COYOTE_FRAMES
    p.platformId = landedOn
  } else {
    if (wasGrounded) p.coyote = COYOTE_FRAMES
    else if (p.coyote > 0) p.coyote--
    p.platformId = null
  }

  // ---- 落地状态校验（帧末兜底）：空中不得持盾/蓄力 ----
  // （挡刀推挤/滑步等惯性滑出边缘的瞬间，状态在这里强制归位）
  if (!p.grounded) {
    if (p.shielding) {
      p.shielding = false
      p.actLag = SHIELD_DROP_LAG
    }
    if (p.charging) {
      p.charging = false
      p.comboStep = 0
    }
  }

  // ---- 武器拾取 ----
  tryPickup(s, p)
}

function startAttack(p: Player, tier: 0 | 1 | 2): void {
  const ms = currentMove(p)
  p.attackTotal = ms.startup + ms.active + ms.recovery
  p.attackTimer = p.attackTotal
  p.attackHasHit = false
  p.attackTier = tier
  // 出招滑步：向前顶一把（仅地面），给进攻行进感
  if (ms.lunge && p.grounded) {
    p.vx = p.facing * ms.lunge
  }
}

// ---- 命中判定：双方攻击盒各自检查一次 ----
function resolveHits(s: SimState): void {
  for (const a of s.players) {
    if (!a.attackActive || a.attackHasHit) continue
    const t = s.players[a.id === 0 ? 1 : 0]
    if (t.out || t.invuln > 0 || dodgeInvulnerable(t)) continue

    if (!overlap(hitboxOf(a), hurtboxOf(t))) continue

    const ms = currentMove(a)
    const discount = offSignature(a) ? WEAPON_OFFSIGNATURE_MULT : 1

    // 挡刀：目标在地面开着护盾
    if (t.shielding) {
      a.attackHasHit = true
      a.comboOpen = COMBO_WINDOW // 格挡也保留连段势
      const cost = SHIELD_COST_BASE + SHIELD_COST_PER_TIER * a.attackTier
      t.shieldHp -= cost
      t.vx = a.facing * SHIELD_PUSHBACK
      a.vx = -a.facing * SHIELD_ATTACKER_PUSHBACK
      s.hitstop = SHIELD_HITSTOP
      if (t.shieldHp <= 0) {
        // 破防：原地大硬直（清掉推挤速度，否则硬直期间会滑出场地直接送命）
        t.shieldHp = 0
        t.shielding = false
        t.charging = false
        t.vx = 0
        t.vy = 0
        t.hitstun = SHIELD_BREAK_STUN
        t.grounded = false
        t.y -= 2
      }
      continue
    }

    // 命中：伤害 → 击飞（除以目标体重）→ 受击僵直
    a.attackHasHit = true
    a.comboOpen = COMBO_WINDOW // 开启连招窗口：窗口内可接下一段
    // 被命中方连段归零（打断反打）
    t.comboOpen = 0
    t.comboStep = 0
    t.chainQueued = false
    const dmg =
      t.damage + ms.damage * CHARGE_DMG_MULT[a.attackTier] * discount
    t.damage = Math.min(dmg, 999)
    const cap = KNOCKBACK_CAP * (1 + CHARGE_KB_CAP_BONUS * a.attackTier)
    const rawKb =
      Math.min(
        cap,
        (KNOCKBACK_BASE + dmg * KNOCKBACK_SCALE) * CHARGE_KB_MULT[a.attackTier],
      ) *
      ms.kbMult *
      discount
    const upRatio = Math.min(0.95, KNOCKBACK_UP_RATIO * (ms.upMult ?? 1))
    const kb = rawKb / charOf(t).weight
    t.vx = a.facing * kb
    t.vy = -kb * upRatio
    t.hitstun = Math.floor(HITSTUN_BASE + kb * HITSTUN_SCALE)
    t.charging = false
    t.shielding = false
    t.grounded = false
    t.platformId = null
    t.y -= 2
    s.hitstop = HITSTOP_FRAMES
  }
}

/** 连招窗口（命中后可接下一段的帧数） */
const COMBO_WINDOW = 24

function hitboxOf(a: Player): { x: number; y: number; w: number; h: number } {
  const ms = currentMove(a)
  const x = a.facing === 1 ? a.x + PLAYER_W / 2 : a.x - PLAYER_W / 2 - ms.hitW
  return { x, y: a.y - PLAYER_H * 0.85, w: ms.hitW, h: ms.hitH }
}

function hurtboxOf(t: Player): { x: number; y: number; w: number; h: number } {
  return { x: t.x - PLAYER_W / 2, y: t.y - PLAYER_H, w: PLAYER_W, h: PLAYER_H }
}

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// ---- 出界（深渊 / 飞出场外）= 死，扣命，重生或终局 ----
function checkBlastzones(s: SimState): void {
  const blast = mapOf(s.settings.mapId).blast ?? {
    left: BLAST_LEFT,
    right: BLAST_RIGHT,
    top: BLAST_TOP,
    bottom: BLAST_BOTTOM,
  }
  for (const p of s.players) {
    if (p.out) continue
    const ko =
      p.x < blast.left ||
      p.x > blast.right ||
      p.y < blast.top ||
      p.y > blast.bottom
    if (!ko) continue
    p.stocks--
    p.weapon = null // 死亡掉落规则：武器随之消失，等下一轮刷新
    p.comboStep = 0
    p.comboOpen = 0
    p.chainQueued = false
    if (p.stocks <= 0) {
      if (s.settings.tutorial || s.settings.training) {
        // 教学：假人打不死，回满命继续当靶子
        p.stocks = 99
        respawn(p)
        continue
      }
      p.out = true
      s.matchOver = p.id === 0 ? 2 : 1
    } else {
      respawn(p)
    }
  }
}

function respawn(p: Player): void {
  p.x = RESPAWN_X
  p.y = RESPAWN_Y
  p.vx = 0
  p.vy = 0
  p.damage = 0
  p.hitstun = 0
  p.attackTimer = 0
  p.attackActive = false
  p.charging = false
  p.shielding = false
  p.dodgeTimer = 0
  p.dropTimer = 0
  p.jumpsUsed = 0
  p.invuln = RESPAWN_INVULN
  p.comboStep = 0
  p.comboOpen = 0
  p.chainQueued = false
}

// ============================================================
// 陪练 AI：在核心内部产出与键盘等价的 PlayerInput。
// "随机"用固定种子 LCG（整数运算，跨平台确定）。
// ============================================================
function aiRand(s: SimState): number {
  // LCG：seed = seed * 1664525 + 1013904223 (mod 2^32)，返回 [0,1)
  s.aiSeed = (Math.imul(s.aiSeed, 1664525) + 1013904223) >>> 0
  return s.aiSeed / 4294967296
}

function aiInput(s: SimState): PlayerInput {
  const me = s.players[1]
  const foe = s.players[0]
  const inp = emptyInput()
  if (s.matchOver !== 0 || me.out) return inp
  // 新手教学：假人不还手、不乱动，站桩陪练
  if (s.settings.tutorial || s.settings.training) return inp
  // 难度参数表：反应速度 / 防御欲 / 闪避欲 / 蓄力阈值与概率
  const lv = s.settings.aiLevel ?? 1
  const think = lv === 0 ? AI_THINK_INTERVAL + 9 : lv === 2 ? AI_THINK_INTERVAL - 3 : AI_THINK_INTERVAL
  const shieldP = lv === 0 ? 0.15 : lv === 2 ? 0.55 : 0.45
  const dodgeP = lv === 0 ? 0 : lv === 2 ? 0.4 : 0.3
  const chargeDmg = lv === 0 ? 90 : lv === 2 ? 25 : 35
  const chargeP = lv === 0 ? 0.25 : lv === 2 ? 0.6 : 0.5
  const pickupP = lv === 0 ? 0.5 : 0.7
  const atkCadence = lv === 0 ? 20 : 12

  // 到期强制重新思考
  if (s.tick >= s.aiUntil) s.aiNextThink = 0

  // 决策：每 think 帧一次
  if (s.tick >= s.aiNextThink) {
    s.aiNextThink = s.tick + think
    const r = aiRand(s)
    const map = mapOf(s.settings.mapId)
    const solids = map.platforms.filter((pl) => !pl.soft)
    const overSolid = solids.some(
      (pl) => me.x > pl.x - 20 && me.x < pl.x + pl.w + 20,
    )
    const offstage = !me.grounded && (!overSolid || me.y > 600)
    if (offstage) {
      s.aiAction = 'recover'
      s.aiUntil = s.tick + 30
    } else if (!me.weapon && s.weapons.length > 0 && r < pickupP) {
      // 只追"差不多同高度、不算太远"的武器，避免为捡武器跳深渊
      let nearest: WeaponEntity | undefined
      let bestDist = Infinity
      for (const w of s.weapons) {
        const d = Math.abs(w.x - me.x)
        if (d < bestDist) {
          bestDist = d
          nearest = w
        }
      }
      if (
        nearest &&
        bestDist < 320 &&
        Math.abs(nearest.y - me.y) < 40
      ) {
        s.aiAction = 'pickup'
        s.aiUntil = s.tick + 40
      } else {
        s.aiAction = r < 0.1 ? 'idle' : r < 0.2 ? 'retreat' : 'approach'
        s.aiUntil = s.tick + AI_THINK_INTERVAL + Math.floor(r * 8)
      }
    } else {
      const adx = Math.abs(foe.x - me.x)
      const ady = Math.abs(foe.y - me.y)
      const inRange = adx < AI_REACH_X && ady < AI_REACH_Y
      if (inRange) {
        if (foe.attackActive && me.shieldHp > 35 && r < shieldP) s.aiAction = 'shield'
        else if (foe.attackTimer > 0 && r < dodgeP) s.aiAction = 'dodge'
        else if (foe.damage > chargeDmg && r < chargeP) s.aiAction = 'charge'
        else s.aiAction = 'attack'
      } else {
        s.aiAction = r < 0.1 ? 'idle' : r < 0.2 ? 'retreat' : 'approach'
      }
      // 蓄力需要足够长的计划窗口才能蓄到档位
      s.aiUntil =
        s.tick +
        (s.aiAction === 'charge' ? 50 : think + Math.floor(r * 8))
    }
  }

  // 执行当前行为 → 输入
  const foeDirRight = foe.x > me.x
  const toward = foeDirRight ? 'right' : 'left'
  const away = foeDirRight ? 'left' : 'right'
  switch (s.aiAction) {
    case 'recover': {
      // 向最近的实体平台中心移动
      const map = mapOf(s.settings.mapId)
      const solids = map.platforms.filter((pl) => !pl.soft)
      let best = solids[0]
      let bestDist = Infinity
      for (const pl of solids) {
        const d = Math.abs(pl.x + pl.w / 2 - me.x)
        if (d < bestDist) {
          bestDist = d
          best = pl
        }
      }
      const target = best.x + best.w / 2
      inp[target > me.x ? 'right' : 'left'] = true
      // 下坠中且还有跳 → 周期性按跳（制造"按下"边沿）
      if (me.vy > 1 && me.jumpsUsed < MAX_JUMPS && s.tick % 10 < 4) inp.up = true
      break
    }
    case 'pickup': {
      // 向最近的无主武器移动（碰到自动拾取）
      let best = s.weapons[0]
      let bestDist = Infinity
      for (const w of s.weapons) {
        const d = Math.abs(w.x - me.x)
        if (d < bestDist) {
          bestDist = d
          best = w
        }
      }
      if (best) inp[best.x > me.x ? 'right' : 'left'] = true
      break
    }
    case 'approach': {
      inp[toward] = true
      if (me.grounded) {
        // 临缝起跳：前方 44px 悬空 → 跳过去（配合二段跳足以跨过双峰裂缝）
        const m = mapOf(s.settings.mapId)
        const probeX = me.x + (toward === 'right' ? 44 : -44)
        const overGround = m.platforms.some(
          (pl) => probeX > pl.x && probeX < pl.x + pl.w,
        )
        if (!overGround) inp.up = true
      }
      // 对手在头顶时偶尔跳
      if (foe.y < me.y - 90 && me.grounded && s.tick % 24 < 3) inp.up = true
      break
    }
    case 'retreat':
      inp[away] = true
      break
    case 'attack':
      // 节奏连打：命中开窗后自然接上连段，落空也只是普通出拳
      if (Math.abs(foe.x - me.x) < AI_REACH_X) {
        inp.attack = s.tick % atkCadence < 2
      } else {
        inp[toward] = true
      }
      break
    case 'charge':
      // 按住攻击蓄力，同时保持面向对手（蓄力可转身——我们自己的机制要用熟）
      inp.attack = true
      inp[toward] = true
      break
    case 'shield':
      inp.shield = true
      break
    case 'dodge':
      inp.dodge = true
      inp[away] = true
      break
    default:
      break // idle：什么都不按
  }
  return inp
}
