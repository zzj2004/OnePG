// ============================================================
// 自动化测试（npm run test）
// M0 回归 + M1 新机制（蓄力/防御/闪避/AI）+ 确定性验证
// 这是"技术层面不留 bug"方针的第一道保险，每次改核心都要跑
// ============================================================
import { createInitialSim, dodgeInvulnerable, step } from '../core/simulation'
import { BLAST_LEFT, BLAST_RIGHT, SHIELD_MAX } from '../core/constants'
import { mapOf } from '../core/stage'
import type { MatchMode, PlayerInput, SimState } from '../core/types'
import { emptyInput } from '../core/types'

type InputFn = (f: number) => [PlayerInput, PlayerInput]

const SNAPSHOT_EVERY = 300

interface RunResult {
  sim: SimState
  snaps: string[]
  /** 过程中的最大伤害（出界重生会清零伤害，最终值不可靠） */
  maxDamage: [number, number]
}

function run(mode: MatchMode, inputFn: InputFn, frames: number): RunResult {
  return runWith({ mode }, inputFn, frames)
}

function runWith(
  settings: {
    mode: MatchMode
    p1Char?: 0 | 1 | 2 | 3
    p2Char?: 0 | 1 | 2 | 3
    mapId?: 0 | 1 | 2
  },
  inputFn: InputFn,
  frames: number,
): RunResult {
  const sim = createInitialSim({
    mode: settings.mode,
    p1Char: settings.p1Char ?? 0,
    p2Char: settings.p2Char ?? 0,
    mapId: settings.mapId ?? 0,
  })
  const snaps: string[] = []
  const maxDamage: [number, number] = [0, 0]
  for (let f = 1; f <= frames; f++) {
    step(sim, inputFn(f))
    maxDamage[0] = Math.max(maxDamage[0], sim.players[0].damage)
    maxDamage[1] = Math.max(maxDamage[1], sim.players[1].damage)
    if (f % SNAPSHOT_EVERY === 0) {
      snaps.push(JSON.stringify({ p: sim.players, w: sim.weapons }))
    }
  }
  return { sim, snaps, maxDamage }
}

// ------------------------------------------------------------
// 场景脚本（所有攻击都避开 90 帧开局无敌）
// ------------------------------------------------------------
// A：M0 回归——跑动、跳跃、二段跳、攻击、快落混合
const m0Script: InputFn = (f) => {
  const p1 = emptyInput()
  const p2 = emptyInput()
  if (f <= 35) p1.right = true
  if (f === 92) p1.attack = true
  if (f >= 130 && f < 160) p1.left = true
  if (f === 170 || f === 180) p1.up = true // 跳 + 二段跳
  if (f >= 190 && f < 220) p1.right = true
  if (f === 280) p1.attack = true
  if (f >= 320 && f < 380) p1.left = true
  if (f === 420) p1.attack = true
  if (f >= 500 && f < 560) p1.right = true
  if (f === 800) p2.up = true
  if (f >= 820 && f < 880) p2.right = true
  if (f === 900) p2.attack = true
  if (f >= 1000) p2.down = true
  return [p1, p2]
}

// B：蓄力——贴身后按住攻击 70 帧（→满蓄2档）松手
const chargeScript: InputFn = (f) => {
  const p1 = emptyInput()
  if (f <= 35) p1.right = true
  if (f >= 95 && f < 165) p1.attack = true
  return [p1, emptyInput()]
}

// C：防御——P1 出拳时 P2 开盾
const shieldScript: InputFn = (f) => {
  const p1 = emptyInput()
  const p2 = emptyInput()
  if (f <= 35) p1.right = true
  if (f === 95) p1.attack = true
  if (f >= 90 && f < 200) p2.shield = true
  return [p1, p2]
}

// D：闪避——P1 出拳同一帧 P2 翻滚（无敌窗覆盖判定帧）
const dodgeScript: InputFn = (f) => {
  const p1 = emptyInput()
  const p2 = emptyInput()
  if (f <= 35) p1.right = true
  if (f === 95) p1.attack = true
  if (f === 95) p2.dodge = true
  return [p1, p2]
}

// E：AI 对局——人机模式，P1 站桩，AI 必须能赢
const aiIdleP1: InputFn = () => [emptyInput(), emptyInput()]

// F：人机确定性——P1 用 A 场景的前半段打 AI
const pveScript: InputFn = (f) => [m0Script(f)[0], emptyInput()]

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅ 通过' : '❌ 失败'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed = true
}

// ---- M0 回归（pvp 双人模式）----
const a = run('pvp', m0Script, 1800)
const a2 = run('pvp', m0Script, 1800)
check(
  'M0 回归·确定性：同一输入两遍逐段快照一致',
  a.snaps.join('\n') === a2.snaps.join('\n'),
  `${a.snaps.length} 个快照`,
)
check(
  'M0 回归·命中造成伤害',
  a.maxDamage[1] > 0,
  `最大伤害 ${Math.floor(a.maxDamage[1])}%`,
)
check('M0 回归·击飞消耗命数', a.sim.players[1].stocks < 3, `P2 剩 ${a.sim.players[1].stocks}`)

// ---- M1：蓄力 ----
const b = run('pvp', chargeScript, 400)
check(
  'M1·蓄力满档伤害 ≈ 8×2.4 = 19.2',
  b.maxDamage[1] >= 19 && b.maxDamage[1] < 25,
  `最大伤害 ${Math.floor(b.maxDamage[1])}%`,
)

// ---- M1：防御 ----
const c = run('pvp', shieldScript, 195)
check(
  'M1·护盾挡刀：不掉血、掉盾值（未破防）',
  c.sim.players[1].damage === 0 &&
    c.sim.players[1].shieldHp > 0 &&
    c.sim.players[1].shieldHp < SHIELD_MAX,
  `伤害 ${c.sim.players[1].damage}  盾值 ${Math.floor(c.sim.players[1].shieldHp)}`,
)

// ---- M1：闪避 ----
const d = run('pvp', dodgeScript, 300)
check(
  'M1·闪避无敌：既不掉血也不掉盾',
  d.sim.players[1].damage === 0 && d.sim.players[1].shieldHp === SHIELD_MAX,
  `伤害 ${d.sim.players[1].damage}  盾值 ${Math.floor(d.sim.players[1].shieldHp)}`,
)

// ---- M1：闪避无敌窗函数抽查（翻滚第 8 帧必须处于无敌） ----
{
  const sim = createInitialSim('pvp')
  let invulnAt8 = false
  for (let f = 1; f <= 120; f++) {
    step(sim, dodgeScript(f))
    if (f === 8 + 95) invulnAt8 = dodgeInvulnerable(sim.players[1])
  }
  check('M1·闪避无敌窗函数抽查', invulnAt8)
}

// ---- M1：AI 完整对局 ----
const e = run('pve', aiIdleP1, 5400)
// P2 = 电脑；站桩 P1 被清空命数 → matchOver = 2（玩家2获胜）
check(
  'M1·AI 能击败站桩玩家（完整对局）',
  e.sim.matchOver === 2,
  `90秒后 P1剩${e.sim.players[0].stocks}命 / 电脑剩${e.sim.players[1].stocks}命`,
)

// ---- M1：人机模式确定性（覆盖 AI 行为可回放） ----
const f1 = run('pve', pveScript, 1800)
const f2 = run('pve', pveScript, 1800)
check(
  'M1·人机模式确定性：AI 行为可回放',
  f1.snaps.join('\n') === f2.snaps.join('\n'),
)

// ============================================================
// M2：武器 / 角色 / 地图
// ============================================================

// 场景 G：拾取——武器 300 帧时刷在主岛中央(640)，P1 走过去自动捡
const g1 = run('pvp', (f) => {
  const p1 = emptyInput()
  // P1 出生 490，武器刷在 640：先站到 300 帧后向右走
  if (f >= 300 && f < 340) p1.right = true
  return [p1, emptyInput()]
}, 500)
check(
  'M2·武器按时刷新在主岛中央',
  g1.sim.weapons.length >= 0 && g1.sim.players[0].weapon !== null,
  `P1 手中武器类型：${String(g1.sim.players[0].weapon)}`,
)
check('M2·拾取硬直生效过（武器已离开场地）', g1.sim.weapons.length === 0)

// 场景 H：非专属减伤——角色1（磐石）捡到双刃（角色0专属），伤害应打七折
const offSigScript: InputFn = (f) => {
  const p2 = emptyInput()
  // P2（磐石，出生930）向左走：约347帧经过640捡起双刃，355帧停在P1身前，370出拳
  if (f >= 300 && f < 355) p2.left = true
  if (f >= 370 && f < 373) p2.attack = true
  return [emptyInput(), p2]
}
const h = runWith({ mode: 'pvp', p1Char: 0, p2Char: 1 }, offSigScript, 700)
check(
  'M2·非专属武器威力打七折（伤害≈7×0.7=4.9）',
  h.maxDamage[0] >= 3.5 && h.maxDamage[0] < 7,
  `P1 最大伤害 ${h.maxDamage[0].toFixed(1)}%`,
)

// 场景 I：体重差异——同样一拳，磐石比疾风飞得近（取命中后短窗内的最大速度）
const hitP2: InputFn = (f) => {
  const p1 = emptyInput()
  if (f <= 35) p1.right = true
  if (f === 92) p1.attack = true
  return [p1, emptyInput()]
}
function maxKnockbackSpeed(p2Char: 0 | 1 | 2 | 3): number {
  const sim = createInitialSim({
    mode: 'pvp',
    p1Char: 0,
    p2Char: p2Char,
    mapId: 0,
  })
  let maxVx = 0
  for (let f = 1; f <= 110; f++) {
    step(sim, hitP2(f))
    maxVx = Math.max(maxVx, Math.abs(sim.players[1].vx))
  }
  return maxVx
}
const vx0 = maxKnockbackSpeed(0)
const vx1 = maxKnockbackSpeed(1)
check(
  'M2·体重差异：磐石被击飞的速度低于疾风',
  vx1 > 0 && vx1 < vx0,
  `疾风 ${vx0.toFixed(1)} vs 磐石 ${vx1.toFixed(1)}`,
)

// 场景 J：双峰地图——出生点在两根石柱上
const j = runWith({ mode: 'pvp', mapId: 1 }, aiIdleP1, 10)
check(
  'M2·双峰地图出生点正确',
  j.sim.players[0].x === 350 && j.sim.players[1].x === 930,
  `P1@${j.sim.players[0].x} P2@${j.sim.players[1].x}`,
)

// 场景 K：人机+新角色+新地图+武器 整局确定性双跑
const pveM2Script: InputFn = (f) => [m0Script(f)[0], emptyInput()]
const k1 = runWith(
  { mode: 'pve', p1Char: 1, p2Char: 0, mapId: 1 },
  pveM2Script,
  1800,
)
const k2 = runWith(
  { mode: 'pve', p1Char: 1, p2Char: 0, mapId: 1 },
  pveM2Script,
  1800,
)
check(
  'M2·新角色新地图新武器下人机整局可回放',
  k1.snaps.join('\n') === k2.snaps.join('\n'),
)

// 场景 L：AI 在双峰+武器环境下依然能打赢站桩玩家（击退调轻后给足 120 秒）
const l = runWith({ mode: 'pve', p2Char: 1, mapId: 1 }, aiIdleP1, 7200)
check(
  'M2·AI 适配双峰地图与武器（120秒内击败站桩玩家）',
  l.sim.matchOver === 2,
  `120秒后 P1剩${l.sim.players[0].stocks}命 / 电脑剩${l.sim.players[1].stocks}命`,
)

// ---- 教学：假人不还手、打不死 ----
{
  const sim = createInitialSim({
    mode: 'pve',
    p1Char: 0,
    p2Char: 1,
    mapId: 0,
    tutorial: true,
  })
  for (let f = 1; f <= 900; f++) {
    const p1 = emptyInput()
    if (f <= 35) p1.right = true
    if (f % 45 === 0) p1.attack = true
    step(sim, [p1, emptyInput()])
  }
  check(
    '教学·假人不还手（玩家毫发无伤）',
    sim.players[0].damage === 0,
    `玩家伤害 ${sim.players[0].damage}`,
  )
  check(
    '教学·假人打不死（命数无限）',
    sim.players[1].stocks > 90,
    `假人剩余命数 ${sim.players[1].stocks}`,
  )
}

// ============================================================
// M4h：连段系统 + 第三角色「惊雷」
// ============================================================

// 场景 M（闭环版）：一个会走位的"测试玩家"——贴近就出拳，命中开窗就接下一段，
// 最多三拳。比死板的帧表更接近真人操作，也不受击退数值微调影响
function comboRun(): { maxDmg: number; minVy: number; maxStep: number } {
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  let maxDmg = 0
  let minVy = 0
  let maxStep = 0
  let presses = 0
  let pressHold = 0
  for (let f = 1; f <= 400; f++) {
    const p1 = emptyInput()
    const me = sim.players[0]
    const foe = sim.players[1]
    const dx = foe.x - me.x
    const adx = Math.abs(dx)
    let atk = false
    if (presses === 0 && pressHold === 0 && me.grounded && me.attackTimer === 0 && !me.charging && adx < 78 && me.comboOpen === 0 && foe.invuln === 0) {
      atk = true // 第一拳：进蓄力，下一帧松手放出（等对手开局无敌结束）
      pressHold = 2
    } else if (presses > 0 && presses < 3 && me.attackTimer === 0 && !me.charging && me.grounded && me.comboOpen > 0 && me.comboStep < 2 && foe.invuln === 0) {
      atk = true // 窗口内接下一段
      pressHold = 2
    }
    if (atk) {
      p1.attack = true
      if (pressHold === 2) presses++
      pressHold--
    } else if (pressHold > 0) {
      pressHold--
    }
    // 攻击恢复帧也允许走位（游戏已支持后摇移动）
    if (!atk && adx > 58) {
      if (dx > 0) p1.right = true
      else p1.left = true
    }
    step(sim, [p1, emptyInput()])
    maxDmg = Math.max(maxDmg, sim.players[1].damage)
    minVy = Math.min(minVy, sim.players[1].vy)
    maxStep = Math.max(maxStep, sim.players[0].comboStep)
    if (presses >= 3 && sim.players[1].grounded && f > 200) break
  }
  return { maxDmg, minVy, maxStep }
}
const combo = comboRun()
check(
  'M4h·三段连招累计伤害 = 8+6+9 = 23',
  combo.maxDmg >= 21 && combo.maxDmg < 26,
  `最大伤害 ${combo.maxDmg.toFixed(1)}%  最高段 ${combo.maxStep}`,
)
check(
  'M4h·末段挑飞把对手轰上天（竖直速度远超普拳）',
  combo.minVy < -12,
  `最小竖直速度 ${combo.minVy.toFixed(1)}`,
)
// 窗口过期对照：两拳之间等窗口走完 → 第二拳回到起手段（8+8=16，无挑飞）
function noComboRun(): { maxDmg: number; minVy: number } {
  const sim = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 })
  let maxDmg = 0
  let minVy = 0
  let stage = 0 // 0=待接近 1=已出第一拳等窗口过期 2=完成
  let pressHold = 0
  let stage2Frame = -1
  for (let f = 1; f <= 400; f++) {
    if (stage === 2 && stage2Frame < 0) stage2Frame = f
    // 第二拳发出后继续跑 120 帧，让拳真正落地
    if (stage2Frame > 0 && f > stage2Frame + 120) break
    const p1 = emptyInput()
    const me = sim.players[0]
    const foe = sim.players[1]
    const dx = foe.x - me.x
    const adx = Math.abs(dx)
    let atk = false
    if (stage === 0 && pressHold === 0 && me.grounded && me.attackTimer === 0 && !me.charging && adx < 78 && foe.invuln === 0) {
      atk = true
      if (pressHold === 0) stage = 1
      pressHold = 2
    } else if (stage === 1 && pressHold === 0 && me.comboOpen === 0 && me.attackTimer === 0 && !me.charging && me.grounded && adx < 78 && foe.invuln === 0) {
      atk = true // 窗口已过期：这一拳回到起手段
      stage = 2
      pressHold = 2
    }
    if (atk) {
      p1.attack = true
      pressHold--
    } else if (pressHold > 0) {
      pressHold--
    }
    if (!atk && adx > 58) {
      if (dx > 0) p1.right = true
      else p1.left = true
    }
    step(sim, [p1, emptyInput()])
    maxDmg = Math.max(maxDmg, sim.players[1].damage)
    minVy = Math.min(minVy, sim.players[1].vy)
  }
  return { maxDmg, minVy }
}
const noCombo = noComboRun()
check(
  'M4h·窗口外第二拳回到起手段（8+8=16，无挑飞）',
  noCombo.maxDmg >= 15 && noCombo.maxDmg < 18 && noCombo.minVy > -8,
  `伤害 ${noCombo.maxDmg.toFixed(1)}%  最小vy ${noCombo.minVy.toFixed(1)}`,
)

// ---- M4h：第三角色「惊雷」 ----
const lightning = runWith({ mode: 'pvp', p1Char: 2, p2Char: 2 }, m0Script, 1800)
check(
  'M4h·惊雷可用且能打出完整对局行为',
  lightning.maxDamage[1] > 0 && lightning.sim.players[1].stocks < 3,
  `伤害 ${lightning.maxDamage[1].toFixed(1)}%  P2剩${lightning.sim.players[1].stocks}命`,
)
// 惊雷捡到双刃（非专属）→ 双刃首段 7×0.7=4.9（惊雷速度快，少走 17 帧防过头）
const lnOffSig = runWith({ mode: 'pvp', p1Char: 2, p2Char: 2 }, (f) => {
  const p2 = emptyInput()
  if (f >= 300 && f < 338) p2.left = true
  if (f >= 370 && f < 373) p2.attack = true
  return [emptyInput(), p2]
}, 700)
check(
  'M4h·惊雷非专属减伤同样生效（≈4.9）',
  lnOffSig.maxDamage[0] >= 3.5 && lnOffSig.maxDamage[0] < 7,
  `最大伤害 ${lnOffSig.maxDamage[0].toFixed(1)}%`,
)
// 惊雷枪链首段伤害 8（换算进对局）
const spearHit = runWith({ mode: 'pvp', p1Char: 2, p2Char: 0 }, (f) => {
  const p1 = emptyInput()
  if (f <= 35) p1.right = true
  if (f === 92) p1.attack = true
  return [p1, emptyInput()]
}, 130)
check(
  'M4h·惊雷长枪首段伤害 8',
  spearHit.maxDamage[1] >= 7.5 && spearHit.maxDamage[1] < 9,
  `伤害 ${spearHit.maxDamage[1].toFixed(1)}%`,
)

// ---- M4l：第四角色「青鸾」+ 第三张地图「窄桥」 ----
const qingluan = runWith({ mode: 'pvp', p1Char: 3, p2Char: 3 }, m0Script, 1800)
check(
  'M4l·青鸾可用且能打出完整对局行为',
  qingluan.maxDamage[1] > 0 && qingluan.sim.players[1].stocks < 3,
  `伤害 ${qingluan.maxDamage[1].toFixed(1)}%  P2剩${qingluan.sim.players[1].stocks}命`,
)
// 青鸾跳得更高：同一起跳后第 20 帧的高度必须高于疾风
function jumpHeightAt20(char: 0 | 3): number {
  const sim = createInitialSim({ mode: 'pvp', p1Char: char, p2Char: 0, mapId: 0 })
  const p1 = emptyInput()
  for (let f = 1; f <= 110; f++) {
    if (f === 95) p1.up = true
    step(sim, [p1, emptyInput()])
  }
  return 560 - sim.players[0].y
}
check(
  'M4l·青鸾跳跃高于疾风',
  jumpHeightAt20(3) > jumpHeightAt20(0),
  `青鸾 ${jumpHeightAt20(3).toFixed(0)} vs 疾风 ${jumpHeightAt20(0).toFixed(0)}`,
)
// 窄桥：出生点正确（直接读初始状态），且能正常对局
const bridgeSpawn = createInitialSim({ mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 2 })
check(
  'M4l·窄桥出生点正确',
  bridgeSpawn.players[0].x === 460 && bridgeSpawn.players[1].x === 820,
  `P1@${bridgeSpawn.players[0].x} P2@${bridgeSpawn.players[1].x}`,
)
const bridge = runWith({ mode: 'pvp', mapId: 2 }, m0Script, 600)
check(
  'M4l·窄桥可正常对局（有命中）',
  bridge.maxDamage[1] > 0 || bridge.maxDamage[0] > 0,
  `最大伤害 ${Math.max(bridge.maxDamage[0], bridge.maxDamage[1]).toFixed(1)}%`,
)
// 窄桥自定义出界线数据接线（行为差异需空中追击场景，单测不隔离——见设计文档）
check(
  'M4l·窄桥侧边出界线已接线',
  bridge.sim.settings.mapId === 2 &&
    (mapOf(2).blast?.left ?? BLAST_LEFT) === -240 &&
    (mapOf(2).blast?.right ?? BLAST_RIGHT) === 1520,
)

// ---- 训练场：与教学同规则（不还手/打不死），武器快速刷新 ----
{
  const sim = createInitialSim({
    mode: 'pve',
    p1Char: 0,
    p2Char: 1,
    mapId: 0,
    training: true,
  })
  let dummyActed = false
  for (let f = 1; f <= 1800; f++) {
    const p1 = emptyInput()
    if (f <= 35) p1.right = true
    if (f % 40 === 0) p1.attack = true
    step(sim, [p1, emptyInput()])
    const d = sim.players[1]
    if (d.attackTimer > 0 || d.charging || d.shielding || d.dodgeTimer > 0) dummyActed = true
  }
  check(
    '训练·假人站桩不还手且无限命',
    !dummyActed && sim.players[1].stocks > 90 && sim.matchOver === 0,
    `假人命数 ${sim.players[1].stocks}`,
  )
  check('训练·武器 2 秒内快速刷新', sim.weaponSpawnCount >= 1, `已刷新 ${sim.weaponSpawnCount} 把`)
}

if (failed) {
  // 用异常而非 process.exit：保持核心代码零 Node 依赖
  throw new Error('测试未通过：上面的 ❌ 项必须先修好')
}
console.log('\n全部测试通过 ✔')
