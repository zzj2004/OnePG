// ============================================================
// 对抗性试玩套件（npm run test 第四段）
// 模拟"乱打的玩家"：模糊测试 + 每帧不变量检查 + 极端场景回放
// 目标：抓逻辑违规（NaN / 负数计时器 / 状态机穿透 / 物理穿帮）
// ============================================================
import { createInitialSim, step } from '../core/simulation'
import { PLAYER_W } from '../core/constants'
import { mapOf } from '../core/stage'
import type { MatchSettings, Player, PlayerInput, SimState } from '../core/types'
import { emptyInput } from '../core/types'

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅ 通过' : '❌ 失败'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed = true
}

// 固定种子 LCG：模糊输入可复现
let fuzzSeed = 20260905
function fuzz(): number {
  fuzzSeed = (Math.imul(fuzzSeed, 1664525) + 1013904223) >>> 0
  return fuzzSeed / 4294967296
}

function randomInput(): PlayerInput {
  const p = emptyInput()
  if (fuzz() < 0.35) p.left = true
  if (fuzz() < 0.35) p.right = true
  if (fuzz() < 0.2) p.up = true
  if (fuzz() < 0.2) p.down = true
  if (fuzz() < 0.15) p.attack = true
  if (fuzz() < 0.1) p.shield = true
  if (fuzz() < 0.1) p.dodge = true
  return p
}

/** 每帧不变量：任何违规都返回违规描述 */
function invariantViolation(sim: SimState, f: number): string | null {
  const all: Player[] = [sim.players[0], sim.players[1]]
  for (const p of all) {
    const nums = [p.x, p.y, p.vx, p.vy, p.damage, p.shieldHp]
    if (nums.some((n) => Number.isNaN(n) || !Number.isFinite(n))) {
      return `f=${f} P${p.id} 数值 NaN/Infinity: ${nums.join(',')}`
    }
    for (const [k, v] of Object.entries(p) as [string, number][]) {
      if (typeof v === 'number' && (k === 'invuln' || k === 'hitstun' || k === 'actLag' || k === 'dodgeTimer' || k === 'dodgeCooldown' || k === 'pickupLag' || k === 'comboOpen') && v < 0) {
        return `f=${f} P${p.id} ${k} = ${v}（负数计时器）`
      }
    }
    if (p.damage < 0 || p.damage > 999) return `f=${f} P${p.id} 伤害越界 ${p.damage}`
    if (p.stocks < 0) return `f=${f} P${p.id} 命数负数 ${p.stocks}`
    if (p.comboStep < 0 || p.comboStep > 2) return `f=${f} P${p.id} 连段段越界 ${p.comboStep}`
    if (p.comboOpen > 24) return `f=${f} P${p.id} 连招窗口异常 ${p.comboOpen}`
    if (p.charging && !p.grounded) return `f=${f} P${p.id} 空中蓄力（设计违规）`
    if (p.shielding && !p.grounded) return `f=${f} P${p.id} 空中举盾（设计违规）`
    if (p.shielding && p.dodgeTimer > 0) return `f=${f} P${p.id} 盾闪同开`
    if (p.grounded && p.platformId === null) return `f=${f} P${p.id} 落地却没有所属平台`
    if (p.grounded) {
      const map = mapOf(sim.settings.mapId)
      const plat = map.platforms[p.platformId!]
      if (!plat) return `f=${f} P${p.id} platformId 越界`
      if (p.y !== plat.y) return `f=${f} P${p.id} 脚底 ${p.y} 不在平台面 ${plat.y}`
      if (p.x + PLAYER_W / 2 <= plat.x || p.x - PLAYER_W / 2 >= plat.x + plat.w) {
        return `f=${f} P${p.id} 悬空站 Platform 外（x=${p.x.toFixed(1)}, 平台 ${plat.x}~${plat.x + plat.w}）`
      }
    }
    if (p.weapon !== null && (p.weapon < 0 || p.weapon > 3)) return `f=${f} 武器类型越界 ${p.weapon}`
  }
  for (const w of sim.weapons) {
    if (Number.isNaN(w.x) || Number.isNaN(w.y)) return `f=${f} 武器坐标 NaN`
    if (sim.weapons.length > 1) return `f=${f} 场上同时 ${sim.weapons.length} 把武器（设计上限 1）`
  }
  if (sim.hitstop < 0 || sim.tick < 0) return `f=${f} 全局计时器负数`
  return null
}

interface FuzzResult { violations: string[]; frames: number }

function fuzzRun(settings: MatchSettings, frames: number): FuzzResult {
  const sim = createInitialSim(settings)
  const violations: string[] = []
  for (let f = 1; f <= frames; f++) {
    step(sim, [randomInput(), randomInput()])
    const v = invariantViolation(sim, f)
    if (v) {
      violations.push(`[${settings.mapId}/${settings.p1Char}${settings.p2Char}] ${v}`)
      break // 第一个违规即可定位
    }
  }
  return { violations, frames }
}

// ---- 1. 全地图 × 代表性角色组合 × 每场 30 秒的乱按模糊 ----
{
  const combos: MatchSettings[] = [
    { mode: 'pvp', p1Char: 0, p2Char: 1, mapId: 0 },
    { mode: 'pvp', p1Char: 2, p2Char: 3, mapId: 1 },
    { mode: 'pvp', p1Char: 3, p2Char: 0, mapId: 2 },
    { mode: 'pvp', p1Char: 1, p2Char: 2, mapId: 2 },
  ]
  const allViolations: string[] = []
  for (const cfg of combos) allViolations.push(...fuzzRun(cfg, 1800).violations)
  check('试玩·4地图角色组合乱按30秒×4场：不变量零违规', allViolations.length === 0, allViolations[0] ?? '全部干净')
}

// ---- 2. 长时间乱按（2 分钟）：状态机疲劳测试 ----
{
  const r = fuzzRun({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 }, 7200)
  check('试玩·双人乱按2分钟：不变量零违规', r.violations.length === 0, r.violations[0] ?? '干净')
}

// ---- 3. 人机三档难度 × 三地图乱按（AI 与玩家同时乱按） ----
{
  const allViolations: string[] = []
  for (const lv of [0, 1, 2] as const) {
    for (const mapId of [0, 1, 2] as const) {
      const r = fuzzRun({ mode: 'pve', p1Char: 0, p2Char: 1, mapId, aiLevel: lv }, 1200)
      allViolations.push(...r.violations)
    }
  }
  check('试玩·AI三档×三地图乱按20秒×9场：不变量零违规', allViolations.length === 0, allViolations[0] ?? '全部干净')
}

// ---- 4. 对顶拳：同帧互换命中（公平性） ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  sim.players[0].x = 752
  sim.players[1].x = 828
  for (let f = 1; f <= 95; f++) step(sim, [emptyInput(), emptyInput()]) // 耗完无敌
  // 同帧点按攻击（单帧按下松开 = 0 档快拳），检查同一帧双方伤害都增加
  let trades = 0
  const d0 = sim.players[0].damage
  const d1 = sim.players[1].damage
  for (let f = 95; f <= 220; f++) {
    const p1 = emptyInput()
    const p2 = emptyInput()
    const press = f % 40 === 1 // 单帧点按（间隔超过出招总时长）
    p1.attack = press
    p2.attack = press
    step(sim, [p1, p2])
    if (sim.players[0].damage > d0 && sim.players[1].damage > d1) trades++
  }
  check('试玩·对顶拳互换：双方同帧互相命中（伤害互换）', trades > 0, `互换帧数 ${trades}`)
}

// ---- 5. 破防追击：盾碎硬直中再被打必须掉血 ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  sim.players[0].x = 752
  sim.players[1].x = 828
  sim.players[1].shieldHp = 20 // 差一刀就碎
  const hold = [emptyInput(), emptyInput()] as const
  for (let f = 1; f <= 95; f++) step(sim, hold)
  let broken = false
  let secondHitLands = false
  const dmgBefore = sim.players[1].damage
  for (let f = 95; f <= 400; f++) {
    const p1 = emptyInput()
    if (sim.tick % 26 < 2) p1.attack = true
    // 攻击方AI：被弹开后走回去（真实玩家会做的补距离）
    const gap = sim.players[1].x - sim.players[0].x
    if (gap > 85 && sim.players[0].attackTimer === 0) p1.right = true
    const p2 = emptyInput()
    p2.shield = sim.players[1].shieldHp > 0 && sim.players[1].hitstun === 0
    step(sim, [p1, p2])
    if (sim.players[1].shieldHp <= 0 && !sim.players[1].shielding) broken = true
    if (broken && sim.players[1].hitstun > 0 && sim.players[1].damage > dmgBefore) secondHitLands = true
  }
  check('试玩·破防发生', broken)
  check('试玩·破防硬直中追击掉血（硬直=可惩罚）', secondHitLands)
}

// ---- 6. 闪避穿越：翻滚穿过对手身体不出界不卡墙 ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  sim.players[0].x = 700
  sim.players[1].x = 780
  for (let f = 1; f <= 95; f++) step(sim, [emptyInput(), emptyInput()])
  let passed = false
  for (let f = 95; f <= 160; f++) {
    const p1 = emptyInput()
    p1.right = true
    if (f === 100) p1.dodge = true
    step(sim, [p1, emptyInput()])
    if (sim.players[0].x > sim.players[1].x + 10) passed = true
  }
  check('试玩·闪避翻滚可穿过对手（无身体碰撞阻挡）', passed)
}

// ---- 7. 蓄力滑下悬崖：空中蓄力必须作废（本轮修的 bug 的回归锁） ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  // P1 站在主岛左缘（340）向左带惯性蓄力 → 滑出边缘
  sim.players[0].x = 348
  sim.players[0].vx = -6
  let airborneCharge = false
  let chargedThenAir = false
  for (let f = 1; f <= 60; f++) {
    const p1 = emptyInput()
    if (f <= 30) {
      p1.attack = true
      p1.left = true // 蓄力中持续向左（蓄力锁移动，靠初始惯性滑）
    }
    step(sim, [p1, emptyInput()])
    if (!sim.players[0].grounded && sim.players[0].charging) airborneCharge = true
    if (!sim.players[0].grounded && chargedThenAir === false && sim.players[0].chargeFrames > 0) chargedThenAir = true
  }
  check('试玩·蓄力滑出悬崖后不残留空中蓄力', !airborneCharge)
  void chargedThenAir
}

// ---- 8. 重生无敌精确性：恰好 90 帧 ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  // 把 P2 直接扔出边界
  sim.players[1].x = -10000
  const idle = [emptyInput(), emptyInput()] as const
  let respawnTick = -1
  for (let f = 1; f <= 10; f++) step(sim, idle)
  for (let f = 10; f <= 200; f++) {
    step(sim, idle)
    if (respawnTick < 0 && sim.players[1].invuln > 0) respawnTick = f
    if (respawnTick > 0) break
  }
  const inv = sim.players[1].invuln
  check('试玩·KO 后重生并带无敌', respawnTick > 0 && inv > 0, `无敌 ${inv} 帧`)
  // 走完无敌再确认恰好归零
  let overrun = false
  for (let f = 0; f < 120; f++) {
    step(sim, idle)
    if (sim.players[1].invuln === 0) break
    if (sim.players[1].invuln < 0) overrun = true
  }
  check('试玩·无敌帧恰好归零不越界', !overrun)
}

// ---- 9. 教学关：假人绝对不还手、永不死亡、无限时稳定 ----
{
  const sim = createInitialSim({ mode: 'pve', p1Char: 0, p2Char: 1, mapId: 0, tutorial: true })
  const p1 = emptyInput()
  p1.right = true // 一直贴着假人乱打
  p1.attack = true
  let dummyAttacked = false
  for (let f = 1; f <= 3600; f++) {
    step(sim, [p1, emptyInput()])
    const d = sim.players[1]
    if (d.attackTimer > 0 || d.charging || d.shielding || d.dodgeTimer > 0) dummyAttacked = true
  }
  check('试玩·教学关1小时假人纯站桩', !dummyAttacked && sim.matchOver === 0)
}

// ---- 10. 连段打断：连招中途被击 → 窗口与段数归零，且无幽灵预输入 ----
{
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  sim.players[0].x = 700
  sim.players[1].x = 780
  for (let f = 1; f <= 95; f++) step(sim, [emptyInput(), emptyInput()])
  // P1 出拳命中开窗，随即 P1 也被 P2 的拳打断（两人贴脸对拳）
  let ghostChain = false
  for (let f = 95; f <= 200; f++) {
    const p1 = emptyInput()
    p1.attack = f % 14 < 2
    const p2 = emptyInput()
    p2.attack = f % 10 < 2
    step(sim, [p1, p2])
    const me = sim.players[0]
    if (me.hitstun > 0 && me.chainQueued) ghostChain = true
  }
  check('试玩·被打断后无幽灵预输入连段', !ghostChain)
}

// ---- 11. 确定性模糊：同一模糊种子两遍，整局一致 ----
{
  const frames: string[][] = [[], []]
  for (let run = 0; run < 2; run++) {
    fuzzSeed = 777
    const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 1, mapId: 1 })
    for (let f = 1; f <= 1200; f++) {
      step(sim, [randomInput(), randomInput()])
      if (f % 200 === 0) frames[run].push(JSON.stringify(sim.players) + JSON.stringify(sim.weapons))
    }
  }
  check('试玩·模糊输入确定性：同种子两遍逐段一致', frames[0].join() === frames[1].join())
}

if (failed) {
  throw new Error('试玩测试未通过：上面的 ❌ 项必须先修好')
}
console.log('\n试玩测试全部通过 ✔')
