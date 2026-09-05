// ============================================================
// 白盒渲染层：只负责把状态画清楚，不追求好看
// 想换美术（PixiJS 精灵 / 特效）时只动这个目录，核心零改动
// ============================================================
import { Application, Container, Graphics, Text } from 'pixi.js'
import {
  DODGE_IFRAME_END,
  DODGE_IFRAME_START,
  PLAYER_H,
  PLAYER_W,
  SHIELD_MAX,
} from '../core/constants'
import { characterOf, WEAPON_TYPE_NAMES } from '../core/characters'
import { createInitialSim } from '../core/simulation'
import { mapOf } from '../core/stage'
import type { StageMap } from '../core/stage'
import type { Player, SimState } from '../core/types'
import { Juice } from './juice'
import { sfx } from '../audio/sfx'
import { bgmStop } from '../audio/bgm'

const W = 1280
const H = 720

const COLORS = {
  bg: 0x10131a,
  island: 0x3d4451,
  islandTop: 0x8a93a5,
  soft: 0x5c6575,
  p1: 0xff5a5a,
  p2: 0x4fb3ff,
  hitbox: 0xffd740,
  text: 0xe8ecf3,
  dim: 0x79818f,
  shield: 0x53e6c0,
  weaponTypes: [0x53e6c0, 0xff9f40, 0xb18cff, 0x7fd4ff] as const, // 双刃=青 巨锤=橙 长枪=紫 战扇=冰蓝
  chargeTiers: [0xffd740, 0xff9f40, 0xff5252] as const,
}

/** 渲染层接收的"屏幕"描述，由 main.ts 的流程状态机构造 */
export type Screen =
  | { kind: 'title'; notice: string }
  | { kind: 'netMenu' }
  | { kind: 'aiLevel' }
  | { kind: 'hostLobby'; code: string; ready: boolean }
  | { kind: 'joinLobby'; typed: string; status: string }
  | { kind: 'waitGo'; role: 'host' | 'guest' }
  | { kind: 'waitPick' }
  | { kind: 'reconnect'; left: number; code: string }
  | { kind: 'countdown'; left: number }
  | { kind: 'tutorial'; sim: SimState; instruction: string; step: number; total: number }
  | {
      kind: 'charSelect'
      who: string
      cursor: 0 | 1 | 2 | 3
      confirmHint: string
    }
  | { kind: 'mapSelect'; cursor: 0 | 1 | 2 }
  | {
      kind: 'settings'
      rows: { label: string; bound: string }[]
      cursor: number
      listening: string | null
    }
  | {
      kind: 'match'
      sim: SimState
      paused?: boolean
      net?: { waiting: boolean; desync: boolean; online: boolean }
    }

export interface Renderer {
  app: Application
  render(screen: Screen): void
}

export async function createRenderer(): Promise<Renderer> {
  const app = new Application()
  // preserveDrawingBuffer：允许从 canvas 导出画面（调试/截图用），开销可忽略
  await app.init({
    width: W,
    height: H,
    background: COLORS.bg,
    antialias: true,
    preserveDrawingBuffer: true,
  })

  // 画面自适应：小屏/手机上等比缩放居中，不裁切
  const fitCanvas = (): void => {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H)
    app.canvas.style.width = Math.floor(W * scale) + 'px'
    app.canvas.style.height = Math.floor(H * scale) + 'px'
  }
  window.addEventListener('resize', fitCanvas)
  fitCanvas()

  // ---- 世界容器：场景（背景/平台/角色/粒子）随镜头缩放平移；UI 文字固定不动 ----
  const world = new Container()
  app.stage.addChild(world)

  const g = new Graphics()
  world.addChild(g)
  const pg = new Graphics() // 粒子层（场景之上、HUD 之下）
  world.addChild(pg)
  const uiG = new Graphics() // 镜头空间的矢量绘制（屏幕外箭头 / KO 闪光），固定不随镜头
  app.stage.addChild(uiG)
  const juice = new Juice()

  // ---- 动态镜头状态 ----
  const cam = { x: W / 2, y: H / 2, s: 1 } // x/y = 镜头中心（世界坐标），s = 缩放
  let koFlash = 0

  // ---- 人物模型表现层状态（飘带物理 / 落地压缩），按玩家槽位各一份 ----
  const fighterFx: FighterFx[] = [
    makeFighterFx(1, [0xf2f4f8]), // 疾风：白色围巾
    makeFighterFx(2, [0xbfe3ff, 0x8fc9ff]), // 青鸾：双色发带（其他角色借用时不会画出）
  ]

  // ---- 静态背景：星空 + 月亮 + 远景浮岛（生成一次，垫在最底层） ----
  // 覆盖范围远超画面：镜头拉远时四周依然是星空而不是黑边
  const bgG = new Graphics()
  bgG.rect(-1100, -1150, 3480, 3020).fill({ color: 0x0d1016 })
  for (let i = 0; i < 340; i++) {
    bgG.circle(
      -1100 + Math.random() * 3480,
      -1150 + Math.random() * 3020,
      Math.random() * 1.8 + 0.4,
    ).fill({ color: 0xdfe6f2, alpha: 0.12 + Math.random() * 0.5 })
  }
  bgG.circle(1090, 110, 46).fill({ color: 0x272e3d })
  bgG.circle(1074, 96, 40).fill({ color: 0x333c4f })
  bgG.poly([150, 430, 260, 418, 320, 444, 210, 452]).fill({ color: 0x1a1f2a })
  bgG.poly([980, 560, 1120, 545, 1180, 580, 1010, 592]).fill({ color: 0x171c26 })
  world.addChildAt(bgG, 0)

  // ---- 标题页演示用：两个角色摆好架势 ----
  const demoSim = createInitialSim('pvp')
  const demoA = demoSim.players[0] // 疾风，面朝右
  const demoB = demoSim.players[1] // 磐石，面朝左
  demoA.x = 470
  demoA.y = 620
  demoB.x = 810
  demoB.y = 620

  // 前一帧状态快照：用于差分提取"命中/KO/拾取/出招"等表现事件
  let prev: {
    damage: [number, number]
    stocks: [number, number]
    shieldHp: [number, number]
    attackActive: [boolean, boolean]
    weapon: [number | null, number | null]
    grounded: [boolean, boolean]
    positions: [[number, number], [number, number]]
    matchOver: 0 | 1 | 2
    weapons: number
  } | null = null
  let prevCountdownLeft: number | null = null

  // 连击计数（表现层）：被打的一方连续吃招的段数
  const comboState = [
    { count: 0, timer: 0 },
    { count: 0, timer: 0 },
  ]
  const font = { fontFamily: '"Microsoft YaHei", sans-serif' } as const

  // ---- 对局用文字 ----
  const mkText = (size: number, fill: number): Text =>
    new Text({ text: '', style: { ...font, fontSize: size, fill } })
  const hud1 = mkText(26, COLORS.text)
  hud1.position.set(24, 16)
  const hud2 = mkText(26, COLORS.text)
  hud2.anchor.set(1, 0)
  hud2.position.set(W - 24, 16)
  const overlay = mkText(48, COLORS.text)
  overlay.style.fontWeight = 'bold'
  overlay.anchor.set(0.5)
  overlay.position.set(W / 2, H / 2 - 60)
  const hint = mkText(15, COLORS.dim)
  hint.style.lineHeight = 24
  hint.anchor.set(0.5, 1)
  hint.position.set(W / 2, H - 10)
  const netBanner = mkText(26, 0xff5252)
  netBanner.style.fontWeight = 'bold'
  netBanner.anchor.set(0.5, 0)
  netBanner.position.set(W / 2, 92)
  const comboTexts = [mkText(34, COLORS.chargeTiers[2]), mkText(34, COLORS.chargeTiers[2])]
  for (const t of comboTexts) {
    t.style.fontWeight = 'bold'
    t.anchor.set(0.5, 0.5)
    t.visible = false
    app.stage.addChild(t)
  }
  // KO 特写大字
  const koText = mkText(60, 0xff5252)
  koText.style.fontWeight = 'bold'
  koText.anchor.set(0.5, 0.5)
  koText.position.set(W / 2, 120)
  koText.visible = false
  app.stage.addChild(koText)
  let koTimer = 0
  // 伤害飘字池：命中跳出数字，上浮渐隐（6 个轮转够用）
  const floatPool: { t: Text; life: number; wx: number; wy: number }[] = []
  for (let i = 0; i < 6; i++) {
    const t = mkText(22, 0xffe08a)
    t.style.fontWeight = 'bold'
    t.anchor.set(0.5, 0.5)
    t.visible = false
    app.stage.addChild(t)
    floatPool.push({ t, life: 0, wx: 0, wy: 0 })
  }
  let floatNext = 0
  const spawnFloat = (x: number, y: number, value: number): void => {
    const f = floatPool[floatNext]
    floatNext = (floatNext + 1) % floatPool.length
    f.t.text = `-${Math.round(value)}`
    f.wx = x
    f.wy = y - PLAYER_H - 14
    f.t.style.fill = value >= 15 ? COLORS.chargeTiers[2] : value >= 10 ? 0xffa94d : 0xffe08a
    f.life = 42
  }
  app.stage.addChild(hud1, hud2, overlay, hint, netBanner)

  // ---- 菜单文字池（每帧按行填充） ----
  const menuLines: Text[] = []
  for (let i = 0; i < 20; i++) {
    const t = mkText(24, COLORS.text)
    t.anchor.set(0.5, 0)
    t.visible = false
    app.stage.addChild(t)
    menuLines.push(t)
  }

  // ---- 界面美学：键帽芯片池 + 文本宽度估算 ----
  const keycapTexts: Text[] = []
  for (let i = 0; i < 10; i++) {
    const t = mkText(20, COLORS.text)
    t.style.fontWeight = 'bold'
    t.anchor.set(0.5, 0.5)
    t.visible = false
    app.stage.addChild(t)
    keycapTexts.push(t)
  }
  let keycapNext = 0
  const drawKeycap = (x: number, y: number, label: string): void => {
    g.roundRect(x, y - 16, 36, 32, 6).fill({ color: 0x1b202b })
    g.roundRect(x, y - 16, 36, 32, 6).stroke({ width: 1.5, color: 0x4a5568 })
    const t = keycapTexts[keycapNext % keycapTexts.length]
    keycapNext++
    t.text = label
    t.position.set(x + 18, y)
    t.visible = true
  }
  const estWidth = (text: string, fontSize: number): number => {
    let w = 0
    for (const ch of text) {
      w += ch.charCodeAt(0) > 0x2e80 ? fontSize : ch === ' ' ? fontSize * 0.3 : fontSize * 0.56
    }
    return w
  }
  /** 清理对局专属的浮动文字（防止残留到菜单界面） */
  const hideLooseTexts = (): void => {
    for (const t of comboTexts) t.visible = false
    for (const f of floatPool) {
      f.t.visible = false
      f.life = 0
    }
    for (const t of keycapTexts) t.visible = false
  }

  function showLines(
    lines: string[],
    opts: { startY?: number; step?: number; bigFirst?: boolean } = {},
  ): void {
    const { startY = 110, step = 46, bigFirst = true } = opts
    hideLooseTexts()
    // 面板：包住整个文本块（半透明圆角 + 描边 + 顶部亮线）
    let maxW = 0
    lines.forEach((line, i) => {
      const size = bigFirst && i === 0 ? 64 : i === 0 ? 30 : 22
      maxW = Math.max(maxW, estWidth(line, size))
    })
    const panelH = Math.min(lines.length * step + 34, H - 24)
    const panelY = Math.max(10, Math.min(startY - 34, H - 20 - panelH))
    const panelW = Math.min(maxW + 110, W - 40)
    g.roundRect(W / 2 - panelW / 2, panelY, panelW, panelH, 12).fill({
      color: 0x10141c,
      alpha: 0.82,
    })
    g.roundRect(W / 2 - panelW / 2, panelY, panelW, panelH, 12).stroke({
      width: 1.5,
      color: 0x2b3242,
    })
    g.roundRect(W / 2 - panelW / 2 + 14, panelY, panelW - 28, 3, 1.5).fill({
      color: 0xffd740,
      alpha: 0.55,
    })
    menuLines.forEach((t, i) => {
      if (i < lines.length) {
        t.text = lines[i]
        t.visible = true
        t.position.set(W / 2, startY + i * step)
        const big = bigFirst && i === 0
        t.style.fontSize = big ? 64 : i === 0 ? 30 : 22
        t.style.fontWeight = big ? 'bold' : 'normal'
        t.style.fill = big || lines[i].startsWith('▶') ? COLORS.text : COLORS.dim
      } else {
        t.visible = false
      }
    })
  }

  function hideMenus(): void {
    for (const t of menuLines) t.visible = false
  }

  const render = (screen: Screen): void => {
    g.clear()
    netBanner.visible = false

    if (screen.kind === 'title') {
      hideMenus()
      hideLooseTexts()
      hud1.text = ''
      hud2.text = ''
      overlay.text = ''
      // ---- 标题面板 ----
      g.roundRect(W / 2 - 420, 62, 840, 486, 16).fill({ color: 0x10141c, alpha: 0.8 })
      g.roundRect(W / 2 - 420, 62, 840, 486, 16).stroke({ width: 1.5, color: 0x2b3242 })
      // Logo + 亮线 + 副标题
      menuLines[0].text = 'OnePG'
      menuLines[0].style.fontSize = 76
      menuLines[0].style.fontWeight = 'bold'
      menuLines[0].style.fill = COLORS.text
      menuLines[0].anchor.set(0.5, 0)
      menuLines[0].position.set(W / 2, 96)
      menuLines[0].visible = true
      g.roundRect(W / 2 - 74, 188, 148, 5, 2.5).fill({ color: 0xffd740, alpha: 0.9 })
      menuLines[1].text = 'One People Game · 平台格斗'
      menuLines[1].style.fontSize = 18
      menuLines[1].style.fill = COLORS.dim
      menuLines[1].anchor.set(0.5, 0)
      menuLines[1].position.set(W / 2, 206)
      menuLines[1].visible = true
      // ---- 选项行：键帽芯片 + 主标签 + 次要说明 ----
      const options: { key: string; label: string; sub: string }[] = [
        { key: '5', label: '新手教学', sub: '12 步上手（第一次玩选这个）' },
        { key: '1', label: '本地双人', sub: '和朋友挤一个键盘' },
        { key: '2', label: '挑战电脑', sub: '简单 / 普通 / 困难' },
        { key: '3', label: '设置', sub: '改键 · 音量 · 全屏' },
        { key: '4', label: '联机对战', sub: '同一 WiFi 房间码' },
      ]
      options.forEach((opt, i) => {
        const y = 262 + i * 54
        drawKeycap(W / 2 - 196, y, opt.key)
        const label = menuLines[2 + i]
        label.text = opt.label
        label.style.fontSize = 26
        label.style.fontWeight = 'bold'
        label.style.fill = COLORS.text
        label.anchor.set(0, 0.5)
        label.position.set(W / 2 - 142, y)
        label.visible = true
        const sub = menuLines[8 + i]
        sub.text = opt.sub
        sub.style.fontSize = 16
        sub.style.fontWeight = 'normal'
        sub.style.fill = COLORS.dim
        sub.anchor.set(0, 0.5)
        sub.position.set(W / 2 + 30, y + 1)
        sub.visible = true
      })
      for (let i = 13; i < menuLines.length; i++) menuLines[i].visible = false
      // 底部分隔线 + 操作速览
      g.roundRect(W / 2 - 340, H - 96, 680, 1.5, 0).fill({ color: 0x2b3242 })
      hint.text =
        'P1：A/D 移动 W 跳 S 下 F 攻击(按住蓄力) G 防御 H 闪避\n' +
        'P2：←/→ 移动 ↑/空格 跳 ↓ 下 小键盘0 攻击 小键盘1 防御 小键盘2 闪避\n' +
        '手柄：摇杆/十字键 移动  A 跳  X 攻击  B 防御  Y 闪避（第1支→P1 第2支→P2）'
      hint.visible = true
      // 双角色立绘预览（疾风 vs 磐石，持本命武器）
      demoA.characterId = 0
      demoA.weapon = 0
      demoB.characterId = 1
      demoB.weapon = 1
      const menuTick = Math.floor(performance.now() / 50)
      drawPlayer(g, demoA, menuTick)
      drawPlayer(g, demoB, menuTick)
      // 立绘脚下的小地台
      g.rect(410, 620, 130, 10).fill({ color: COLORS.island })
      g.rect(410, 620, 130, 3).fill({ color: COLORS.islandTop })
      g.rect(740, 620, 130, 10).fill({ color: COLORS.island })
      g.rect(740, 620, 130, 3).fill({ color: COLORS.islandTop })
      return
    }

    if (screen.kind === 'netMenu') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          '联机对战',
          '',
          '按 1 → 创建房间（你是红方）',
          '按 2 → 加入房间（你是蓝方）',
          '',
          '同一 WiFi 下：握手走公共服务，对战数据局域网直连',
          '两边都需要能上网（浏览器安全限制，无法纯离线撮合）',
        ],
        { startY: 140, step: 56 },
      )
      return
    }

    if (screen.kind === 'aiLevel') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          '选择电脑难度',
          '',
          '按 1 → 简单（反应慢，很少防御，适合第一次玩）',
          '按 2 → 普通（会防会躲，会找机会蓄力）',
          '按 3 → 困难（反应快、连段狠、抓机会能力很强）',
          '',
          'Esc 返回',
        ],
        { startY: 150, step: 56 },
      )
      return
    }

    if (screen.kind === 'hostLobby') {
      hideMenus()
      hint.visible = false
      if (screen.ready) {
        showLines(
          [
            '创建房间',
            '',
            '房间已就绪！把房间码告诉你的对手：',
            screen.code,
            '',
            '等待对手加入…（Esc 取消）',
          ],
          { startY: 140, step: 56 },
        )
      } else {
        showLines(
          ['创建房间', '', '正在向撮合服务注册房间…', '稍等，房间码马上就好'],
          { startY: 200, step: 56 },
        )
      }
      return
    }

    if (screen.kind === 'joinLobby') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          '加入房间',
          '',
          `房间码：${screen.typed.padEnd(4, '_')}`,
          screen.status,
          '',
          'Esc 返回',
        ],
        { startY: 160, step: 56 },
      )
      return
    }

    if (screen.kind === 'waitGo') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          screen.role === 'host' ? '配置已发送' : '已连接！',
          '',
          screen.role === 'host'
            ? '等待对手确认配置…'
            : '等待主机开始对战…',
        ],
        { startY: 240, step: 56 },
      )
      return
    }

    if (screen.kind === 'waitPick') {
      hideMenus()
      hint.visible = false
      showLines(
        ['你已确认角色', '', '等待对手选择角色…', '', '对手选完后你来选地图（Esc 取消）'],
        { startY: 220, step: 56 },
      )
      return
    }

    if (screen.kind === 'reconnect') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          '连接中断！',
          '',
          `正在等待对手回到房间 ${screen.code}…`,
          `自动重连剩余 ${Math.ceil(screen.left / 60)} 秒`,
          '',
          '提示：刷新页面的那一方会自动重新加入',
          'Esc 放弃重连',
        ],
        { startY: 170, step: 52 },
      )
      return
    }

    if (screen.kind === 'countdown') {
      hideMenus()
      hint.visible = false
      if (prevCountdownLeft === null || screen.left !== prevCountdownLeft) {
        if (screen.left > 0 && screen.left % 30 === 0) sfx.count()
        prevCountdownLeft = screen.left
      }
      showLines([String(Math.ceil(screen.left / 30))], { startY: 260, step: 40 })
      // 倒计时脉冲：每个数字从大到小收缩
      menuLines[0].style.fontSize = 124 + (screen.left % 30) * 1.1
      return
    }

    if (screen.kind === 'charSelect') {
      hideMenus()
      hint.visible = false
      const lines: string[] = [`${screen.who} 选角色`, '']
      const tags = [
        '快速连击型 · 移动×1.12 · 抗击飞×0.92',
        '重锤一击型 · 移动×0.88 · 抗击飞×1.18',
        '均衡长青型 · 长枪超长判定 · 三围全部×1.0',
        '空中特化型 · 跳跃×1.22 · 全场最轻',
      ]
      for (const id of [0, 1, 2, 3] as const) {
        const c = characterOf(id)
        const sel = screen.cursor === id
        lines.push(`${sel ? '▶ ' : '   '}【${c.name}】  专属：${c.weaponName}`)
        lines.push((sel ? '' : '   ') + tags[id])
        lines.push((sel ? '' : '   ') + `三段连招：${c.unarmed.length} 段空手 / ${c.weapon.length} 段${c.weaponName} · 命中后连按攻击接招`)
        lines.push('')
      }
      lines.push(screen.confirmHint)
      showLines(lines, { startY: 60, step: 40, bigFirst: true })
      // 立绘预览：光标角色持本命武器站到右下角（面朝右，避免戳进文字）
      const cursor = screen.cursor
      const demo = cursor === 0 ? demoA : demoB
      demo.characterId = cursor
      demo.weapon = cursor // 角色 id 与本命武器类型一一对应
      demo.characterId = cursor
      demo.weapon = characterOf(cursor).weaponType
      demo.x = 1130
      demo.y = 600
      demo.facing = 1
      drawPlayer(g, demo, Math.floor(performance.now() / 50))
      g.rect(1040, 600, 200, 10).fill({ color: COLORS.island })
      g.rect(1040, 600, 200, 3).fill({ color: COLORS.islandTop })
      return
    }

    if (screen.kind === 'mapSelect') {
      hideMenus()
      hint.visible = false
      showLines(
        [
          '选地图',
          '',
          `${screen.cursor === 0 ? '▶ ' : '   '}【孤岛】  主岛+三块软平台，经典对称竞技场`,
          `${screen.cursor === 1 ? '▶ ' : '   '}【双峰】  主岛裂成两根石柱，中间是深渊裂缝`,
          `${screen.cursor === 2 ? '▶ ' : '   '}【窄桥】  一条长桥悬在深渊上，侧边出界更近`,
          '',
          '按 1 / 2 / 3 确认开战',
        ],
        { startY: 150, step: 56, bigFirst: true },
      )
      return
    }

    if (screen.kind === 'settings') {
      hideMenus()
      hint.visible = false
      const lines: string[] = ['改键设置', '']
      screen.rows.forEach((row, i) => {
        const cursor = i === screen.cursor ? '▶ ' : '   '
        const bound = screen.listening && i === screen.cursor ? '按新按键…' : row.bound
        lines.push(`${cursor}${row.label}：${bound}`)
      })
      lines.push('')
      lines.push(
        screen.listening
          ? '按任意键设为新键位（Esc 取消）'
          : 'W/S 上下 · 回车改键或切换 · ←/→ 调音量 · Esc 保存返回',
      )
      showLines(lines, { startY: 46, step: 40, bigFirst: true })
      return
    }

    // ---- 对局 / 新手教学 ----
    if (screen.kind !== 'match' && screen.kind !== 'tutorial') {
      // 非对局界面：镜头复位到原点
      cam.s = 1
      cam.x = W / 2
      cam.y = H / 2
      world.scale.set(1)
      world.position.set(0, 0)
      uiG.clear()
      koFlash = 0
      koText.visible = false
      prevCountdownLeft = null
      hideLooseTexts()
      return
    }
    if (screen.kind === 'match') {
      // 倒计时结束进入对局的第一帧：开战音
      if (prevCountdownLeft !== null) {
        sfx.go()
        prevCountdownLeft = null
      }
    }
    const s = screen.sim
    const isTutorial = screen.kind === 'tutorial'
    const net = screen.kind === 'match' ? screen.net : undefined
    hideMenus()

    // ---- 动态镜头：框住所有存活角色；被击飞的角色按速度外推，镜头提前预判 ----
    {
      const alive = s.players.filter((pl) => !pl.out)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const pl of alive) {
        minX = Math.min(minX, pl.x)
        maxX = Math.max(maxX, pl.x)
        minY = Math.min(minY, pl.y - PLAYER_H / 2)
        maxY = Math.max(maxY, pl.y - PLAYER_H / 2)
        if (Math.abs(pl.vx) > 8) {
          minX = Math.min(minX, pl.x + pl.vx * 10)
          maxX = Math.max(maxX, pl.x + pl.vx * 10)
        }
        if (pl.vy < -10) minY = Math.min(minY, pl.y + pl.vy * 8)
      }
      let targetS = Math.min(W / (maxX - minX + 460), H / (maxY - minY + 380))
      targetS = Math.max(0.58, Math.min(1.05, targetS))
      cam.s += (targetS - cam.s) * 0.07
      cam.x += ((minX + maxX) / 2 - cam.x) * 0.1
      cam.y += ((minY + maxY) / 2 - 10 - cam.y) * 0.1
      // 终局：镜头缓缓推向胜者
      if (s.matchOver !== 0) {
        const winner = s.players[s.matchOver - 1]
        cam.s += (1.12 - cam.s) * 0.05
        cam.x += (winner.x - cam.x) * 0.06
        cam.y += (winner.y - PLAYER_H - cam.y) * 0.06
      }
    }

    // 联机状态横幅
    if (screen.kind === 'match' && screen.paused) {
      netBanner.text = '已暂停 — 按 P 继续 · Esc 回标题'
      netBanner.style.fill = COLORS.text
      netBanner.style.fontSize = 30
      netBanner.visible = true
    } else if (net?.desync) {
      netBanner.text = '⚠ 状态不同步警告：两端模拟结果出现分歧'
      netBanner.style.fill = 0xff5252
      netBanner.style.fontSize = 26
      netBanner.visible = true
    } else if (net?.waiting) {
      netBanner.text = '等待对手网络…'
      netBanner.style.fill = 0xffa94d
      netBanner.style.fontSize = 26
      netBanner.visible = true
    } else if (isTutorial) {
      netBanner.text = `教学 ${screen.step}/${screen.total}：${screen.instruction}`
      netBanner.style.fill = COLORS.text
      netBanner.style.fontSize = 22
      netBanner.visible = true
    }
    const map = mapOf(s.settings.mapId)

    drawMapBackdrop(g, map, s.tick)

    for (const plat of map.platforms) {
      if (plat.soft) {
        // 薄平台：板身 + 亮顶边 + 两端小包边
        g.rect(plat.x, plat.y, plat.w, plat.h).fill({ color: COLORS.soft })
        g.rect(plat.x, plat.y, plat.w, 4).fill({ color: COLORS.islandTop })
        g.rect(plat.x - 3, plat.y, 4, plat.h).fill({ color: COLORS.islandTop })
        g.rect(plat.x + plat.w - 1, plat.y, 4, plat.h).fill({ color: COLORS.islandTop })
      } else {
        // 实体岛：岩体 + 亮顶 + 下收的悬浮岛底
        g.rect(plat.x, plat.y, plat.w, plat.h).fill({ color: COLORS.island })
        g.rect(plat.x, plat.y, plat.w, 6).fill({ color: COLORS.islandTop })
        const tuck = Math.min(70, plat.w * 0.18)
        g.poly([
          plat.x + 8, plat.y + plat.h,
          plat.x + plat.w - 8, plat.y + plat.h,
          plat.x + plat.w - 8 - tuck, plat.y + plat.h + 46,
          plat.x + 8 + tuck, plat.y + plat.h + 46,
        ]).fill({ color: 0x2b303b })
        // 岩体纹理：几道随机短线（表现层可用随机）
        for (let i = 0; i < 5; i++) {
          const sx = plat.x + 30 + Math.random() * (plat.w - 60)
          const sy = plat.y + 16 + Math.random() * (plat.h - 24)
          g.moveTo(sx, sy).lineTo(sx + 14 + Math.random() * 16, sy + 3).stroke({
            width: 2, color: 0x333a47, alpha: 0.8,
          })
        }
      }
    }

    drawMapDecor(g, map, s.tick)

    // 掉落的武器（菱形，颜色区分类型）
    for (const w of s.weapons) {
      const cx = w.x
      const cy = w.y - 12
      const bob = w.grounded ? Math.floor(s.tick / 30) % 2 * 3 : 0
      g.poly([cx, cy - 12 - bob, cx + 10, cy - bob, cx, cy + 12 - bob, cx - 10, cy - bob]).fill(
        { color: COLORS.weaponTypes[w.type], alpha: w.pickupCooldown > 0 ? 0.4 : 1 },
      )
    }

    for (const p of s.players) {
      if (p.out) continue
      if (p.invuln > 0 && Math.floor(s.tick / 4) % 2 === 0) continue
      drawPlayer(g, p, s.tick, fighterFx[p.id])
    }

    hud1.text = hudText('P1', s.players[0])
    hud2.text = hudText(s.settings.mode === 'pve' ? '电脑' : 'P2', s.players[1])
    // 伤害渐变配色：白 → 黄 → 橙 → 红
    const dmgColor = (d: number): number =>
      d >= 120 ? 0xff5252 : d >= 80 ? 0xff9f40 : d >= 40 ? 0xffd740 : COLORS.text
    hud1.style.fill = dmgColor(s.players[0].damage)
    hud2.style.fill = dmgColor(s.players[1].damage)
    // HUD 玩家面板：底板 + 角色色条
    g.roundRect(14, 8, 330, 54, 9).fill({ color: 0x10141c, alpha: 0.75 })
    g.roundRect(14, 8, 330, 54, 9).stroke({ width: 1.2, color: 0x2b3242 })
    g.roundRect(14, 8, 5, 54, 2.5).fill({ color: COLORS.p1, alpha: 0.9 })
    g.roundRect(W - 344, 8, 330, 54, 9).fill({ color: 0x10141c, alpha: 0.75 })
    g.roundRect(W - 344, 8, 330, 54, 9).stroke({ width: 1.2, color: 0x2b3242 })
    g.roundRect(W - 349, 8, 5, 54, 2.5).fill({ color: COLORS.p2, alpha: 0.9 })
    drawShieldBar(g, 24, 50, s.players[0].shieldHp)
    drawShieldBar(g, W - 24 - 90, 50, s.players[1].shieldHp)

    if (s.matchOver === 0) {
      overlay.text = ''
      overlay.visible = false
    } else {
      const winner =
        s.settings.mode === 'pve' && !net?.online
          ? s.matchOver === 2
            ? '电脑 获胜！'
            : '你赢了！'
          : `玩家${s.matchOver} 获胜！`
      overlay.text = net?.online
        ? `${winner}  按 R 再来一局 · Esc 退出`
        : `${winner}  R 再来一局 · C 重选角色 · Esc 回标题`
      overlay.style.fill =
        s.matchOver === 1 ? COLORS.p1 : s.settings.mode === 'pve' ? 0xffa94d : COLORS.p2
      overlay.visible = true
      // 结算面板：压暗场景 + 横幅底板 + 胜者色顶线
      g.roundRect(0, 0, W, H, 0).fill({ color: 0x000000, alpha: 0.34 })
      const pw = Math.max(overlay.width + 90, 560)
      g.roundRect(W / 2 - pw / 2, H / 2 - 60 - 40, pw, 92, 14).fill({
        color: 0x10141c,
        alpha: 0.88,
      })
      g.roundRect(W / 2 - pw / 2, H / 2 - 60 - 40, pw, 92, 14).stroke({
        width: 1.5,
        color: 0x2b3242,
      })
      g.roundRect(W / 2 - pw / 2 + 16, H / 2 - 60 - 40, pw - 32, 4, 2).fill({
        color: overlay.style.fill as number,
        alpha: 0.9,
      })
    }
    hint.visible = false

    // ---- 打击感：差分提取表现事件 + 粒子 + 震动 ----
    const snap = (st: SimState) => ({
      damage: [st.players[0].damage, st.players[1].damage] as [number, number],
      stocks: [st.players[0].stocks, st.players[1].stocks] as [number, number],
      shieldHp: [st.players[0].shieldHp, st.players[1].shieldHp] as [number, number],
      attackActive: [st.players[0].attackActive, st.players[1].attackActive] as [boolean, boolean],
      weapon: [st.players[0].weapon, st.players[1].weapon] as [number | null, number | null],
      grounded: [st.players[0].grounded, st.players[1].grounded] as [boolean, boolean],
      positions: [
        [st.players[0].x, st.players[0].y],
        [st.players[1].x, st.players[1].y],
      ] as [[number, number], [number, number]],
      matchOver: st.matchOver,
      weapons: st.weapons.length,
    })
    const cur = snap(s)
    if (prev) {
      for (let i = 0; i < 2; i++) {
        const [px, py] = cur.positions[i]
        const dmgDelta = cur.damage[i] - prev.damage[i]
        if (dmgDelta > 0.5) {
          const strength = Math.max(0, Math.min(1, dmgDelta / 19))
          juice.spawnHit(px, py - PLAYER_H / 2, strength, 0xffe08a)
          sfx.hit(strength)
          spawnFloat(px, py, dmgDelta)
          // 连击计数：被打方累计
          comboState[i].count++
          comboState[i].timer = 45
        } else if (prev.shieldHp[i] - cur.shieldHp[i] > 0.5) {
          juice.spawnHit(px, py - PLAYER_H / 2, 0.3, 0x53e6c0)
          sfx.shieldBlock()
        }
        // 出界/KO：连击清零 + 全屏闪光 + KO 大字
        if (cur.stocks[i] < prev.stocks[i]) {
          juice.spawnKO(prev.positions[i][0], prev.positions[i][1], i === 0 ? COLORS.p1 : COLORS.p2)
          sfx.ko()
          koFlash = 8
          koTimer = 55
          comboState[i].count = 0
          comboState[i].timer = 0
        }
        if (cur.weapon[i] !== null && prev.weapon[i] === null) {
          juice.spawnPickup(px, py, 0xffe08a)
          sfx.pickup()
        }
        if (cur.attackActive[i] && !prev.attackActive[i]) {
          sfx.swing()
        }
        if (!cur.grounded[i] && prev.grounded[i] && s.players[i].vy < -8) {
          sfx.jump()
        }
      }
      if (prev.matchOver === 0 && s.matchOver !== 0) {
        sfx.victory()
        bgmStop() // 胜利琶音登场，战斗音乐退场
      }
    }
    prev = cur

    // 连击倒计时与显示（≥2 连击才跳字）
    for (let i = 0; i < 2; i++) {
      const cs = comboState[i]
      if (cs.timer > 0) {
        cs.timer--
        if (cs.timer === 0) cs.count = 0
      }
      const t = comboTexts[i]
      if (cs.count >= 2 && cs.timer > 0) {
        const [px, py] = cur.positions[i]
        t.text = `${cs.count} 连击!`
        t.style.fill = COLORS.chargeTiers[Math.min(2, Math.floor(cs.count / 3))]
        t.position.set(
          Math.max(120, Math.min(W - 120, (px - cam.x) * cam.s + W / 2)),
          Math.max(90, Math.min(H - 120, (py - PLAYER_H - 46 - cam.y) * cam.s + H / 2)),
        )
        t.visible = true
      } else {
        t.visible = false
      }
    }

    // 伤害飘字上浮渐隐（随镜头换算到屏幕坐标）
    for (const f of floatPool) {
      if (f.life <= 0) {
        f.t.visible = false
        continue
      }
      f.life--
      f.t.alpha = Math.min(1, f.life / 20)
      f.t.position.set(
        (f.wx - cam.x) * cam.s + W / 2,
        (f.wy - cam.y) * cam.s + H / 2 - (42 - f.life) * 0.9,
      )
      f.t.visible = true
    }

    // ---- KO 特写闪光 + 屏幕外指示箭头（把飞出画面的角色标回来）----
    uiG.clear()
    if (koFlash > 0) {
      koFlash--
      uiG.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: (koFlash / 8) * 0.38 })
    }
    if (koTimer > 0) {
      koTimer--
      koText.style.fontSize = 58 + Math.max(0, koTimer - 40) * 1.4
      koText.visible = koTimer > 0
    }
    if (s.matchOver === 0) {
      for (const pl of s.players) {
        if (pl.out) continue
        const sx = (pl.x - cam.x) * cam.s + W / 2
        const sy = (pl.y - PLAYER_H / 2 - cam.y) * cam.s + H / 2
        if (sx >= 36 && sx <= W - 36 && sy >= 36 && sy <= H - 36) continue
        const pxx = Math.max(36, Math.min(W - 36, sx))
        const pyy = Math.max(36, Math.min(H - 36, sy))
        const ang = Math.atan2(sy - H / 2, sx - W / 2)
        const cs = Math.cos(ang)
        const sn = Math.sin(ang)
        const pcolor = pl.id === 0 ? COLORS.p1 : COLORS.p2
        uiG.poly([
          pxx + cs * 17, pyy + sn * 17,
          pxx - cs * 9 - sn * 13, pyy - sn * 9 + cs * 13,
          pxx - cs * 9 + sn * 13, pyy - sn * 9 - cs * 13,
        ]).fill({ color: pcolor, alpha: 0.92 })
        uiG.circle(pxx - cs * 6, pyy - sn * 6, 10).fill({ color: pcolor, alpha: 0.5 })
      }
    }

    const off = juice.updateAndDraw(pg)
    world.scale.set(cam.s)
    world.position.set(W / 2 - cam.x * cam.s + off.dx, H / 2 - cam.y * cam.s + off.dy)
    app.render()
  }

  return { app, render }
}

function hudText(name: string, p: Player): string {
  // 教学关假人命数 99：显示 ∞ 而不是画 99 个圆点撑爆 HUD
  const lives = p.stocks > 5 ? '∞' : '●'.repeat(Math.max(p.stocks, 0)).padEnd(3, '○')
  const c = characterOf(p.characterId)
  const weapon = p.weapon === null ? '空手' : WEAPON_TYPE_NAMES[p.weapon]
  const off = p.weapon !== null && p.weapon !== c.weaponType
  return `${name}(${c.name})  命 ${lives}  ${Math.floor(p.damage)}%  ${weapon}${off ? '(非专属)' : ''}`
}

function drawShieldBar(g: Graphics, x: number, y: number, hp: number): void {
  const ratio = Math.max(0, Math.min(1, hp / SHIELD_MAX))
  g.rect(x, y, 90, 7).fill({ color: 0x232833 })
  if (ratio > 0) {
    g.rect(x, y, 90 * ratio, 7).fill({
      color: ratio > 0.35 ? COLORS.shield : 0xff5252,
    })
  }
}

// ============================================================
// 几何战士：程序驱动的火柴人PLUS
// 全部用线段+圆组合出姿态：跑动摆腿、腾空收腿、三段挥臂、
// 蓄力举武器、持盾下蹲、受击后仰、闪避整周翻滚
// ============================================================

/** 圆头粗线段（四肢/躯干） */
function limb(
  g: Graphics,
  x1: number, y1: number, x2: number, y2: number,
  w: number, color: number, alpha: number,
): void {
  g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: w, color, alpha, cap: 'round' })
}

/** 点 (x,y) 绕 (cx,cy) 旋转 a 弧度 */
function rotP(x: number, y: number, cx: number, cy: number, a: number): [number, number] {
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]
}

interface Pose {
  foot1: [number, number]
  foot2: [number, number]
  hip: [number, number]
  neck: [number, number]
  head: [number, number]
  headR: number
  hand1: [number, number] // 前手（持武器）
  hand2: [number, number] // 后手
  weaponAngle: number // 前手武器朝向（0=正前方，π/2=向下）
}

/** 由玩家状态算当前姿态（所有关节坐标）。extraCrouch：落地压缩等外部下蹲量 */
function poseOf(p: Player, tick: number, extraCrouch = 0): Pose {
  const f = p.facing
  const c = characterOf(p.characterId)
  const bulk = c.id === 1 ? 1.18 : 0.9
  const speed01 = Math.max(0, Math.min(1, Math.abs(p.vx) / 8))
  const phase = p.x * 0.12 // 跑步循环按走过的距离驱动
  const crouch = (p.shielding ? 7 : p.charging ? 4 : 0) + extraCrouch
  const bob = p.grounded ? Math.sin(phase * 2) * 1.4 * speed01 + Math.sin(tick * 0.11) * 0.7 : 0
  const stun = p.hitstun > 0

  const hip: [number, number] = [p.x, p.y - 26 + crouch + bob]
  const lean = f * (2 + speed01 * 5) + (stun ? -f * 9 : 0)
  const neck: [number, number] = [p.x + lean, p.y - 50 + crouch + bob]
  const head: [number, number] = [neck[0] + f * 3, neck[1] - 9]
  const headR = 8.5 * Math.sqrt(bulk)

  // ---- 腿 ----
  let foot1: [number, number]
  let foot2: [number, number]
  if (p.shielding) {
    foot1 = [p.x - 11, p.y]
    foot2 = [p.x + 11, p.y]
  } else if (stun) {
    foot1 = [p.x - f * 7, p.y - 5]
    foot2 = [p.x + f * 11, p.y - 1]
  } else if (!p.grounded) {
    if (p.vy < 0) {
      foot1 = [p.x + f * 5, p.y - 15] // 上升收腿
      foot2 = [p.x - f * 6, p.y - 9]
    } else {
      foot1 = [p.x + f * 9, p.y - 3] // 下落前后腿
      foot2 = [p.x - f * 7, p.y - 17]
    }
  } else if (speed01 > 0.08) {
    foot1 = [p.x + Math.sin(phase) * 14 * speed01, p.y - Math.max(0, Math.cos(phase)) * 5 * speed01]
    foot2 = [p.x - Math.sin(phase) * 14 * speed01, p.y - Math.max(0, -Math.cos(phase)) * 5 * speed01]
  } else {
    foot1 = [p.x - 7 * bulk, p.y]
    foot2 = [p.x + 7 * bulk, p.y]
  }

  // ---- 前臂角度（0=正前，π/2=垂下，负=举后上） ----
  let arm1 = 1.25
  if (stun) arm1 = -2.6
  else if (p.shielding) arm1 = 0.85
  else if (p.charging) {
    const tier = p.chargeFrames >= 45 ? 2 : p.chargeFrames >= 20 ? 1 : 0
    arm1 = -1.9 + (tier === 2 ? Math.sin(tick * 0.9) * 0.09 : 0)
  } else if (p.attackTimer > 0) {
    const chain = p.weapon === null ? c.unarmed : characterOf(p.weapon).weapon
    const ms = chain[Math.min(p.comboStep, chain.length - 1)]
    const elapsed = p.attackTotal - p.attackTimer
    if (elapsed < ms.startup) arm1 = -2.4 // 前摇：向后引
    else if (elapsed < ms.startup + ms.active) arm1 = 0.08 // 判定：横扫到正前
    else {
      const t = (elapsed - ms.startup - ms.active) / ms.recovery
      arm1 = 0.1 + t * 1.15 // 后摇：收回
    }
  } else if (!p.grounded) {
    arm1 = p.vy < 0 ? 0.9 : 1.6
  } else if (speed01 > 0.08) {
    arm1 = 1.25 - Math.sin(phase) * 0.5 * speed01
  }
  const arm2 = stun ? -2.1 : p.shielding ? 1.0 : 1.85 + (speed01 > 0.08 ? Math.sin(phase) * 0.5 * speed01 : 0)

  const sh: [number, number] = [neck[0] - f * 1, neck[1] + 3]
  const hand1: [number, number] = [sh[0] + f * Math.cos(arm1) * 16, sh[1] + Math.sin(arm1) * 16]
  const hand2: [number, number] = [sh[0] + f * Math.cos(arm2) * 14, sh[1] + Math.sin(arm2) * 14]

  const pose: Pose = { foot1, foot2, hip, neck, head, headR, hand1, hand2, weaponAngle: arm1 }

  // ---- 闪避翻滚：整周旋转 ----
  if (p.dodgeTimer > 0) {
    const total = p.dodgeAir ? 26 : 22
    const rollA = (1 - p.dodgeTimer / total) * Math.PI * 2 * f
    const cx = p.x
    const cy = p.y - 30
    const r = (pt: [number, number]): [number, number] => rotP(pt[0], pt[1], cx, cy, rollA)
    pose.foot1 = r(foot1)
    pose.foot2 = r(foot2)
    pose.hip = r(hip)
    pose.neck = r(neck)
    pose.head = r(head)
    pose.hand1 = r(hand1)
    pose.hand2 = r(hand2)
    pose.weaponAngle = arm1 + rollA
  }
  return pose
}

/** 手中的武器（type 0=双刃 1=巨锤 2=长枪 3=战扇），angle 同 pose 约定 */
function drawHeldWeapon(
  g: Graphics,
  hand: [number, number],
  f: 1 | -1,
  angle: number,
  type: 0 | 1 | 2 | 3,
  alpha: number,
): void {
  const dir = [f * Math.cos(angle), Math.sin(angle)] as [number, number]
  const tip: [number, number] = [hand[0] + dir[0] * 34, hand[1] + dir[1] * 34]
  if (type === 0) {
    // 双刃：细长剑身 + 十字护手
    limb(g, hand[0], hand[1], tip[0], tip[1], 4, COLORS.weaponTypes[0], alpha)
    const gx = hand[0] + dir[0] * 6
    const gy = hand[1] + dir[1] * 6
    limb(g, gx - dir[1] * 7, gy + dir[0] * 7, gx + dir[1] * 7, gy - dir[0] * 7, 3, 0xc9d2e0, alpha)
    g.circle(tip[0], tip[1], 2.4).fill({ color: 0xe8f6ff, alpha })
  } else if (type === 2) {
    // 长枪：超长枪杆 + 菱形枪尖 + 红缨
    const tip2: [number, number] = [hand[0] + dir[0] * 48, hand[1] + dir[1] * 48]
    limb(g, hand[0] - dir[0] * 8, hand[1] - dir[1] * 8, tip2[0] - dir[0] * 8, tip2[1] - dir[1] * 8, 3.5, 0x7a5cc7, alpha)
    const perp: [number, number] = [-dir[1], dir[0]]
    g.poly([
      tip2[0] + dir[0] * 10, tip2[1] + dir[1] * 10,
      tip2[0] + perp[0] * 4, tip2[1] + perp[1] * 4,
      tip2[0] - dir[0] * 4, tip2[1] - dir[1] * 4,
      tip2[0] - perp[0] * 4, tip2[1] - perp[1] * 4,
    ]).fill({ color: 0xe6dcff, alpha })
    const tx = tip2[0] - dir[0] * 9
    const ty = tip2[1] - dir[1] * 9
    g.circle(tx, ty, 3.5).fill({ color: 0xff5a76, alpha: alpha * 0.9 })
  } else if (type === 3) {
    // 战扇：展开的折扇（楔形扇面 + 扇骨）
    const spread = 0.9
    const a1 = angle - spread / 2
    const a2 = angle + spread / 2
    const r = 40
    const cx = hand[0] + f * Math.cos(angle) * 6
    const cy = hand[1] + Math.sin(angle) * 6
    const e1: [number, number] = [cx + f * Math.cos(a1) * r, cy + Math.sin(a1) * r]
    const e2: [number, number] = [cx + f * Math.cos(angle) * (r + 5), cy + Math.sin(angle) * (r + 5)]
    const e3: [number, number] = [cx + f * Math.cos(a2) * r, cy + Math.sin(a2) * r]
    g.poly([cx, cy, e1[0], e1[1], e2[0], e2[1], e3[0], e3[1]]).fill({
      color: COLORS.weaponTypes[3],
      alpha: alpha * 0.85,
    })
    limb(g, cx, cy, e2[0], e2[1], 2.5, 0xc9d2e0, alpha)
  } else if (type === 1) {
    // 巨锤：粗短柄 + 大锤头
    const end: [number, number] = [hand[0] + dir[0] * 22, hand[1] + dir[1] * 22]
    limb(g, hand[0], hand[1], end[0], end[1], 5, 0x8a6b45, alpha)
    const perp: [number, number] = [-dir[1], dir[0]]
    const hw = 12
    const hh = 9
    const corners: [number, number][] = [
      [end[0] + dir[0] * hh + perp[0] * hw, end[1] + dir[1] * hh + perp[1] * hw],
      [end[0] + dir[0] * hh - perp[0] * hw, end[1] + dir[1] * hh - perp[1] * hw],
      [end[0] - dir[0] * hh - perp[0] * hw, end[1] - dir[1] * hh - perp[1] * hw],
      [end[0] - dir[0] * hh + perp[0] * hw, end[1] - dir[1] * hh + perp[1] * hw],
    ]
    g.poly(corners.flat()).fill({ color: COLORS.weaponTypes[1], alpha })
    g.circle(end[0], end[1], 3).fill({ color: 0x2b2015, alpha })
  }
}

// ============================================================
// 人物模型 v2：双关节骨骼 + 填充躯干 + 专属部件 + 维利斯飘带
// ============================================================

/** 飘带/发带的维利斯链节点 */
interface ScarfPt {
  x: number
  y: number
  px: number
  py: number
}

/** 每个角色的表现层状态（跨帧维持飘带物理与落地压缩） */
interface FighterFx {
  strands: ScarfPt[][]
  strandColors: number[]
  squash: number
  grounded: boolean
}

function makeFighterFx(strandCount: number, colors: number[]): FighterFx {
  const strands: ScarfPt[][] = []
  for (let i = 0; i < strandCount; i++) {
    strands.push(
      Array.from({ length: 4 }, () => ({ x: 0, y: 0, px: 0, py: 0 })),
    )
  }
  return { strands, strandColors: colors, squash: 0, grounded: true }
}

/** 维利斯链推进：锚点钉在 (ax,ay)，重力 + 风（速度反向）+ 定长约束 */
function updateStrand(strand: ScarfPt[], ax: number, ay: number, windX: number): void {
  // 首次使用：全部节点铺在锚点后方
  if (strand[1].x === 0 && strand[1].y === 0 && strand[1].px === 0) {
    for (let i = 0; i < strand.length; i++) {
      strand[i].x = ax - i * 7
      strand[i].y = ay
      strand[i].px = strand[i].x
      strand[i].py = strand[i].y
    }
  }
  strand[0].x = ax
  strand[0].y = ay
  for (let i = 1; i < strand.length; i++) {
    const pt = strand[i]
    const vx = (pt.x - pt.px) * 0.86
    const vy = (pt.y - pt.py) * 0.86 + 0.3
    pt.px = pt.x
    pt.py = pt.y
    pt.x += vx + windX
    pt.y += vy
    const prevPt = strand[i - 1]
    const dx = pt.x - prevPt.x
    const dy = pt.y - prevPt.y
    const d = Math.hypot(dx, dy) || 1
    pt.x = prevPt.x + (dx / d) * 7
    pt.y = prevPt.y + (dy / d) * 7
  }
}

function drawStrand(g: Graphics, strand: ScarfPt[], w: number, color: number, alpha: number): void {
  for (let i = 1; i < strand.length; i++) {
    limb(g, strand[i - 1].x, strand[i - 1].y, strand[i].x, strand[i].y, w - i * 0.5, color, alpha)
  }
}

/** 两段式骨骼：由起点/终点解出中间关节（膝/肘），bend 控制弯曲方向 */
function twoBone(
  ax: number, ay: number, bx: number, by: number,
  l1: number, l2: number, bend: number,
): { mx: number; my: number; ex: number; ey: number } {
  let dx = bx - ax
  let dy = by - ay
  let d = Math.hypot(dx, dy)
  const maxD = l1 + l2 - 1
  if (d > maxD) {
    dx *= maxD / d
    dy *= maxD / d
    bx = ax + dx
    by = ay + dy
    d = maxD
  }
  if (d < 2) {
    bx = ax
    by = ay + 2
    dx = 0
    dy = 2
    d = 2
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0))
  const ux = dx / d
  const uy = dy / d
  return {
    mx: ax + ux * a - uy * h * bend,
    my: ay + uy * a + ux * h * bend,
    ex: bx,
    ey: by,
  }
}

/** 攻击残影：武器扫过的鬼影弧（重锤慢速不画） */
function drawWeaponTrail(
  g: Graphics,
  hand: [number, number],
  f: 1 | -1,
  angle: number,
  type: 0 | 1 | 2 | 3,
  alpha: number,
): void {
  if (type === 1) return
  for (let k = 1; k <= 4; k++) {
    const a = angle - f * 0.24 * k
    const hx = hand[0] + f * Math.cos(a) * 6
    const hy = hand[1] + Math.sin(a) * 6
    const len = type === 2 ? 44 : type === 3 ? 36 : 32
    const tx = hx + f * Math.cos(a) * len
    const ty = hy + Math.sin(a) * len
    limb(g, hx, hy, tx, ty, 5 - k, COLORS.weaponTypes[type], alpha * (0.3 - k * 0.06))
  }
}

// ============================================================
// 地图美工：每张地图两层装饰——背景层（垫在平台后）+ 装饰层（平台上、角色下）
// 全部代码生成，随 tick 微动（雾气呼吸/碎石沉浮/藤蔓摇摆）
// 固定种子随机数保证每帧装饰位置一致
// ============================================================
function decoRand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 背景层：垫在平台后面的大剪影 */
function drawMapBackdrop(g: Graphics, map: StageMap, tick: number): void {
  if (map.id === 1) {
    // 双峰：远景群山剪影
    g.poly([60, 560, 220, 380, 300, 460, 420, 330, 560, 560]).fill({ color: 0x141926 })
    g.poly([700, 560, 860, 350, 960, 440, 1080, 390, 1220, 560]).fill({ color: 0x121722 })
  } else if (map.id === 2) {
    // 窄桥：低垂的巨月 + 缓慢漂移的云带
    g.circle(230, 180, 62).fill({ color: 0x3a3450 })
    g.circle(210, 162, 52).fill({ color: 0x46405e })
    for (let i = 0; i < 3; i++) {
      const drift = Math.sin(tick * 0.0016 + i * 2.1) * 36
      g.roundRect(140 + i * 90 + drift, 150 + i * 46, 210 + i * 40, 16, 8).fill({
        color: 0x1a2030,
        alpha: 0.7,
      })
    }
  }
}

/** 装饰层：画在平台之上、角色之下 */
function drawMapDecor(g: Graphics, map: StageMap, tick: number): void {
  const solids = map.platforms.filter((pl) => !pl.soft)

  if (map.id === 0) {
    // 孤岛：草皮边缘 + 垂藤 + 桥下悬浮碎石
    const main = solids[0]
    const rnd = decoRand(101)
    for (let x = main.x + 10; x < main.x + main.w - 10; x += 20) {
      const h = 4 + rnd() * 5
      const sway = Math.sin(tick * 0.05 + x) * 1.5
      g.poly([x, main.y, x + 4 + sway, main.y - h, x + 8, main.y]).fill({
        color: 0x57855c,
        alpha: 0.85,
      })
    }
    for (let i = 0; i < 5; i++) {
      const vx = main.x + 40 + rnd() * (main.w - 80)
      const len = 26 + rnd() * 34
      const segs = 4
      let cx = vx
      let cy = main.y + main.h
      for (let sgi = 0; sgi < segs; sgi++) {
        const sway = Math.sin(tick * 0.04 + i * 1.7 + sgi) * 2.4
        const nx = cx + sway
        const ny = cy + len / segs
        limb(g, cx, cy, nx, ny, 2.5 - sgi * 0.4, 0x3d6b4a, 0.9)
        cx = nx
        cy = ny
      }
      g.circle(cx, cy, 2).fill({ color: 0x57855c, alpha: 0.8 })
    }
    for (let i = 0; i < 4; i++) {
      const bx = 200 + rnd() * 880
      const bob = Math.sin(tick * 0.03 + i * 1.9) * 8
      const by = 700 + i * 30 + bob
      g.poly([bx, by, bx + 14, by - 6, bx + 26, by, bx + 12, by + 9]).fill({ color: 0x2b303b })
      g.poly([bx + 4, by - 1, bx + 14, by - 5, bx + 20, by - 1]).fill({ color: 0x3a4150 })
    }
  } else if (map.id === 1) {
    // 双峰：裂岩 + 峡谷雾气 + 断桥残木
    for (const pillar of solids) {
      const rnd = decoRand(pillar.id * 77 + 13)
      for (let i = 0; i < 3; i++) {
        let cx = pillar.x + 30 + rnd() * (pillar.w - 60)
        let cy = pillar.y + 14 + rnd() * 20
        for (let sgi = 0; sgi < 4; sgi++) {
          const nx = cx + (rnd() - 0.5) * 18
          const ny = cy + 14 + rnd() * 14
          limb(g, cx, cy, nx, ny, 2, 0x262c38, 0.9)
          cx = nx
          cy = ny
        }
      }
      // 断桥残木（朝向峡谷一侧）
      const inner = pillar.x < 640 ? pillar.x + pillar.w : pillar.x
      const dir = pillar.x < 640 ? 1 : -1
      g.rect(inner - (dir < 0 ? 26 : 0), 548, 26, 6).fill({ color: 0x4a3f33 })
      g.rect(inner - (dir < 0 ? 18 : 0), 570, 18, 5).fill({ color: 0x3e352b })
    }
    // 峡谷雾气：呼吸起伏
    for (let i = 0; i < 3; i++) {
      const ry = 8 + i * 3
      g.ellipse(640, 600 + i * 22, 170 + i * 34, ry).fill({
        color: 0x9aa7bd,
        alpha: 0.05 + 0.045 * (0.5 + 0.5 * Math.sin(tick * 0.02 + i * 1.3)),
      })
    }
  } else if (map.id === 2) {
    // 窄桥：木板纹 + 缆绳 + 桥头灯笼
    const bridge = solids[0]
    // 木色罩层 + 板缝
    g.rect(bridge.x, bridge.y, bridge.w, bridge.h).fill({ color: 0x4a3a28, alpha: 0.5 })
    for (let x = bridge.x + 14; x < bridge.x + bridge.w; x += 25) {
      limb(g, x, bridge.y, x, bridge.y + bridge.h, 1.6, 0x2e251c, 0.8)
    }
    // 缆绳：两条下垂的悬链线
    for (const sag of [16, 30]) {
      let px = bridge.x
      let py = bridge.y + 6
      for (let sgi = 1; sgi <= 8; sgi++) {
        const t = sgi / 8
        const nx = bridge.x + bridge.w * t
        const ny = bridge.y + 6 + Math.sin(t * Math.PI) * sag
        limb(g, px, py, nx, ny, 2, 0x6b5a3a, 0.85)
        px = nx
        py = ny
      }
    }
    // 桥头柱 + 灯笼（光晕呼吸）
    for (const lx of [bridge.x + 6, bridge.x + bridge.w - 14]) {
      g.rect(lx, bridge.y - 34, 8, 34).fill({ color: 0x3e352b })
      const glow = 0.5 + 0.2 * Math.sin(tick * 0.06 + lx)
      g.circle(lx + 4, bridge.y - 40, 9).fill({ color: 0xffd740, alpha: 0.12 + glow * 0.1 })
      g.circle(lx + 4, bridge.y - 40, 4).fill({ color: 0xffd740, alpha: 0.55 + glow * 0.3 })
    }
    // 桥下深渊：上升的暖色气流微粒
    const rnd = decoRand(303)
    for (let i = 0; i < 6; i++) {
      const ex = 320 + rnd() * 640
      const rise = (tick * (0.4 + rnd() * 0.4) + rnd() * 340) % 340
      g.circle(ex + Math.sin(tick * 0.03 + i) * 10, 900 - rise, 1.6 + rnd()).fill({
        color: 0xffa94d,
        alpha: 0.35 * (1 - rise / 340),
      })
    }
  }
}

function drawPlayer(g: Graphics, p: Player, tick: number, fx?: FighterFx): void {
  const color = p.id === 0 ? COLORS.p1 : COLORS.p2
  const limbShade = p.id === 0 ? 0xd94646 : 0x3391dd
  const c = characterOf(p.characterId)
  const bulk = c.id === 1 ? 1.2 : c.id === 3 ? 0.82 : c.id === 2 ? 1.0 : 0.9
  const lw = 5 * bulk

  // 闪避无敌帧：半透明（可读性：知道现在打不中）
  const dodging = p.dodgeTimer > 0
  const iframe =
    dodging &&
    (() => {
      const total = p.dodgeAir ? 26 : 22
      const elapsed = total - p.dodgeTimer
      const start = p.dodgeAir ? 4 : DODGE_IFRAME_START
      const end = p.dodgeAir ? 18 : DODGE_IFRAME_END
      return elapsed >= start && elapsed < end
    })()
  const alpha = iframe ? 0.45 : 1
  const bodyColor = p.hitstun > 0 ? 0xffffff : color
  const limbColor = p.hitstun > 0 ? 0xf2f4f8 : limbShade
  const f = p.facing

  // 落地压缩：刚落地 8 帧内下蹲回弹
  let squashCrouch = 0
  if (fx) {
    if (p.grounded && !fx.grounded) fx.squash = 8
    fx.squash = Math.max(0, fx.squash - 1)
    squashCrouch = 5 * (fx.squash / 8)
  }
  const pose = poseOf(p, tick, squashCrouch)

  // 脚下投影（接地才有）
  if (p.grounded) {
    g.ellipse(p.x, p.y + 3, 19, 4.5).fill({ color: 0x000000, alpha: 0.26 * alpha })
  }

  // 高伤害警示：脚下红色脉冲环
  if (p.damage >= 60) {
    const pulse = 14 + Math.sin(tick * 0.3) * 3
    g.circle(p.x, p.y + 3, pulse).stroke({ width: 2.5, color: 0xff5252, alpha: 0.55 })
  }

  // ---- 双关节解算 ----
  const legL = 14 * (0.9 + 0.1 * bulk)
  const leg1 = twoBone(pose.hip[0], pose.hip[1], pose.foot1[0], pose.foot1[1], legL, legL, f)
  const leg2 = twoBone(pose.hip[0], pose.hip[1], pose.foot2[0], pose.foot2[1], legL, legL, f)
  const armL = 9
  const arm1 = twoBone(pose.neck[0], pose.neck[1] + 2, pose.hand1[0], pose.hand1[1], armL, armL, -f)
  const backHand: [number, number] = [pose.hand2[0], pose.hand2[1]]

  // ---- 躯干：宽肩窄腰的填充四边形 ----
  const spineX = pose.neck[0] - pose.hip[0]
  const spineY = pose.neck[1] - pose.hip[1]
  const spineLen = Math.hypot(spineX, spineY) || 1
  const pxp = -spineY / spineLen
  const pyp = spineX / spineLen
  const hipW = 5.5 * bulk
  const shoulderW = 8.5 * bulk
  const torso: number[] = [
    pose.hip[0] - pxp * hipW, pose.hip[1] - pyp * hipW,
    pose.hip[0] + pxp * hipW, pose.hip[1] + pyp * hipW,
    pose.neck[0] + pxp * shoulderW, pose.neck[1] + pyp * shoulderW,
    pose.neck[0] - pxp * shoulderW, pose.neck[1] - pyp * shoulderW,
  ]

  // 绘制顺序：投影 → 后臂 → 后腿 → 前腿 → 躯干 → 胸甲线 → 头 → 头带 → 眼 → 专属部件 → 前臂(肘) → 武器 → 残影
  limb(g, pose.neck[0], pose.neck[1] + 2, backHand[0], backHand[1], lw - 1, limbColor, alpha * 0.7)
  limb(g, pose.hip[0], pose.hip[1], leg2.mx, leg2.my, lw, limbColor, alpha * 0.75)
  limb(g, leg2.mx, leg2.my, leg2.ex, leg2.ey, lw - 0.5, limbColor, alpha * 0.75)
  g.circle(leg2.mx, leg2.my, 2.2 * bulk).fill({ color: limbShade, alpha: alpha * 0.75 })
  limb(g, pose.hip[0], pose.hip[1], leg1.mx, leg1.my, lw, limbColor, alpha)
  limb(g, leg1.mx, leg1.my, leg1.ex, leg1.ey, lw - 0.5, limbColor, alpha)
  g.circle(leg1.mx, leg1.my, 2.2 * bulk).fill({ color: limbShade, alpha })
  // 靴子
  limb(g, leg1.ex, leg1.ey, leg1.ex + f * 5, leg1.ey, 3.6, 0x222833, alpha)
  limb(g, leg2.ex, leg2.ey, leg2.ex + f * 5, leg2.ey, 3.6, 0x222833, alpha * 0.8)
  // 躯干
  g.poly(torso).fill({ color: bodyColor, alpha })
  // 胸甲斜线（层次感）
  limb(
    g,
    pose.neck[0] + pxp * shoulderW * 0.6, pose.neck[1] + pyp * shoulderW * 0.6,
    pose.hip[0] - pxp * hipW * 0.4, pose.hip[1] - pyp * hipW * 0.4,
    2, 0x222833, alpha * 0.5,
  )
  // 肩关节
  g.circle(pose.neck[0], pose.neck[1] + 2, 3 * bulk).fill({ color: limbShade, alpha })
  // 头
  g.circle(pose.head[0], pose.head[1], pose.headR).fill({ color: bodyColor, alpha })
  // 头带：手持武器时显示武器颜色，空手显示白色
  const bandColor = p.weapon === null ? 0xe8ecf3 : COLORS.weaponTypes[p.weapon]
  limb(g, pose.head[0] - f * pose.headR, pose.head[1] - 2, pose.head[0] + f * pose.headR, pose.head[1] - 2, 3.2, bandColor, alpha)
  // 朝向"眼睛"
  g.circle(pose.head[0] + f * pose.headR * 0.5, pose.head[1] - 1, 1.9).fill({ color: COLORS.bg, alpha })

  // ---- 专属部件 ----
  if (p.characterId === 1) {
    // 磐石：两块厚肩甲
    for (const side of [-1, 1]) {
      const sx = pose.neck[0] + pxp * shoulderW * side
      const sy = pose.neck[1] + pyp * shoulderW * side
      g.rect(sx - 5, sy - 4, 10, 6).fill({ color: 0x2b303b, alpha })
    }
  } else if (p.characterId === 2) {
    // 惊雷：盔顶红缨（后掠三角）
    g.poly([
      pose.head[0] - f * 2, pose.head[1] - pose.headR + 1,
      pose.head[0] - f * 16, pose.head[1] - pose.headR - 8,
      pose.head[0] - f * 5, pose.head[1] - pose.headR + 3,
    ]).fill({ color: 0xff5a76, alpha })
  }

  // ---- 飘带/发带（维利斯物理，随移动飘动） ----
  if (fx && fx.strands.length > 0 && (p.characterId === 0 || p.characterId === 3)) {
    const attachX = pose.head[0] - f * pose.headR * 0.8
    const attachY = pose.head[1] - 1
    const windX = -p.vx * 0.14
    fx.strands.forEach((strand, idx) => {
      const ay = attachY + idx * 4
      updateStrand(strand, attachX, ay, windX)
      drawStrand(g, strand, idx === 0 ? 3.4 : 2.6, fx.strandColors[idx] ?? 0xf2f4f8, alpha)
    })
  }

  // 前臂（带肘）+ 关节
  limb(g, pose.neck[0], pose.neck[1] + 2, arm1.mx, arm1.my, lw - 1, limbColor, alpha)
  limb(g, arm1.mx, arm1.my, arm1.ex, arm1.ey, lw - 1.2, limbColor, alpha)
  g.circle(arm1.mx, arm1.my, 2 * bulk).fill({ color: limbShade, alpha })
  // 武器 / 拳头
  if (p.weapon === null) {
    g.circle(pose.hand1[0], pose.hand1[1], 3.4).fill({ color: bodyColor, alpha })
  } else {
    if (p.attackActive) {
      drawWeaponTrail(g, pose.hand1, f, pose.weaponAngle, p.weapon, alpha)
    }
    drawHeldWeapon(g, pose.hand1, f, pose.weaponAngle, p.weapon, alpha)
  }

  // 蓄力光效：外框颜色随档位 + 脉冲（保留可读性极佳的方框，但贴合身形收紧）
  if (p.charging) {
    const tier = p.chargeFrames >= 45 ? 2 : p.chargeFrames >= 20 ? 1 : 0
    const pulse = 3 + (Math.floor(tick / 4) % 3)
    const bx = p.x - PLAYER_W / 2
    const by = p.y - PLAYER_H
    g.rect(bx - pulse, by - pulse, PLAYER_W + pulse * 2, PLAYER_H + pulse * 2).stroke({
      width: 3,
      color: COLORS.chargeTiers[tier],
      alpha: 0.85,
    })
  }

  // 护盾环：脚下圆环，半径与颜色随护盾值
  if (p.shielding) {
    const ratio = Math.max(0.2, p.shieldHp / SHIELD_MAX)
    g.circle(p.x, p.y - PLAYER_H / 2, 34 + 18 * ratio).stroke({
      width: 4,
      color: ratio > 0.35 ? COLORS.shield : 0xff5252,
      alpha: 0.9,
    })
  }

  // 攻击判定盒直接画出来（白盒阶段看判定是找手感的基本功）
  if (p.attackActive) {
    const chain = p.weapon === null ? c.unarmed : characterOf(p.weapon).weapon
    const ms = chain[Math.min(p.comboStep, chain.length - 1)]
    const hx = p.facing === 1 ? p.x + PLAYER_W / 2 : p.x - PLAYER_W / 2 - ms.hitW
    g.rect(hx, p.y - PLAYER_H * 0.85, ms.hitW, ms.hitH).fill({
      color: p.attackTier > 0 ? COLORS.chargeTiers[p.attackTier] : COLORS.hitbox,
      alpha: 0.55,
    })
  }

  if (fx) fx.grounded = p.grounded
}
