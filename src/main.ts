// ============================================================
// 主流程：标题 → 单机(本地/人机) / 改键 / 联机(创建/加入房间) → 选人 → 选图 → 对局
// 联机 = 锁帧同步会话 + 房间号撮合；单机路径与 M2 完全一致
// ============================================================
import { TICK_RATE } from './core/constants'
import { createInitialSim, step } from './core/simulation'
import type { MatchMode, MatchSettings, PlayerInput, SimState } from './core/types'
import { emptyInput } from './core/types'
import {
  ACTIONS,
  ACTION_NAMES,
  SLOT_NAMES,
  gameKeys,
  getKeymaps,
  keyDisplayName,
  readInput,
  setBinding,
  type PlayerSlot,
} from './input/keys'
import { TouchControls, isTouchDevice } from './input/touch'
import { padToInput, pollGamepads, type PadSnapshot } from './input/gamepad'
import { PeerTransport, type NetTransport } from './net/transport'
import { NetSession } from './net/lockstep'
import {
  decodeInput,
  decodeMessage,
  encodeInput,
  encodeMessage,
  isValidRoomCode,
  makeRoomCode,
  NET_VERSION,
} from './net/protocol'
import { createRenderer, type Screen } from './render/renderer'
import { unlockAudio, setVolume, getVolume, toggleMute, isMuted } from './audio/sfx'
import { bgmStart, bgmStop } from './audio/bgm'

const MS_PER_TICK = 1000 / TICK_RATE
const COUNTDOWN_FRAMES = 90

type Flow =
  | { screen: 'title' }
  | { screen: 'netMenu' }
  | { screen: 'aiLevel' }
  | { screen: 'hostLobby'; code: string; ready: boolean }
  | { screen: 'joinLobby'; typed: string; status: string; connecting: boolean }
  | { screen: 'waitPick' }
  | { screen: 'reconnect'; left: number }
  | { screen: 'waitGo'; role: 'host' | 'guest'; settings: MatchSettings }
  | { screen: 'countdown'; left: number; settings: MatchSettings }
  | { screen: 'tutorial'; step: number; prevDamage: number }
  | { screen: 'charSelect'; slot: PlayerSlot; mode: MatchMode; online: boolean; cursor: 0 | 1 | 2 | 3 }
  | {
      screen: 'mapSelect'
      cursor: 0 | 1 | 2
      settings: Pick<MatchSettings, 'mode' | 'p1Char' | 'p2Char' | 'aiLevel'>
      online: boolean
    }
  | {
      screen: 'settings'
      cursor: number
      listening: { slot: PlayerSlot; action: (typeof ACTIONS)[number] } | null
    }
  | { screen: 'match' }

/** 新手教学步骤：教学关里假人不还手、打不死 */
const TUTORIAL_STEPS: {
  instruction: string
  done: (sim: SimState, hitDelta: number) => boolean
}[] = [
  { instruction: '按 D 向右跑，靠近假人（别怕，它不还手）', done: (s) => Math.abs(s.players[0].x - s.players[1].x) < 110 },
  { instruction: '按 W 跳起来', done: (s) => !s.players[0].grounded },
  { instruction: '在空中再按一次 W，完成二段跳', done: (s) => s.players[0].jumpsUsed === 2 },
  { instruction: '按 F 出拳，打中假人', done: (s) => s.players[1].damage > 0 },
  { instruction: '按住 F 约 1 秒蓄力，松手轰出重击', done: (s, hitDelta) => hitDelta >= 12 },
  { instruction: '再出一拳——命中后 0.4 秒内连按 F，接出三段连招！', done: (s) => s.players[0].comboStep >= 2 },
  { instruction: '地上刷出武器了，走过去自动捡起（本命武器威力 100%）', done: (s) => s.players[0].weapon !== null },
  { instruction: '拿着武器按 F 连打，感受武器的三段连招', done: (s) => s.players[0].weapon !== null && s.players[0].attackHasHit },
  { instruction: '按住 G 举盾，试试防御姿态', done: (s) => s.players[0].shielding },
  { instruction: '按 H 闪避（有无敌帧，躲攻击用的）', done: (s) => s.players[0].dodgeTimer > 0 || s.players[0].dodgeCooldown > 0 },
  { instruction: '跳上薄平台，站好后按 S+W 穿下去', done: (s) => s.players[0].dropTimer > 0 },
  { instruction: '教学完成！按 Esc 返回标题，去按 2 挑战电脑吧', done: () => false },
]

async function boot(): Promise<void> {
  const renderer = await createRenderer()
  document.getElementById('app')!.appendChild(renderer.app.canvas)

  const held = new Set<string>()
  const touch = new TouchControls(document.body)
  if (isTouchDevice()) touch.setVisible(true) // 触屏设备自动显示虚拟按键
  let flow: Flow = { screen: 'title' }
  let paused = false // 单机对局暂停（联机不可暂停）
  let sim: SimState | null = null
  let lastSettings: MatchSettings = { mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 }
  /** 联机状态（非 null = 联机相关流程/对局中） */
  let netTransport: NetTransport | null = null
  let netSession: NetSession | null = null
  let netSlot: PlayerSlot = 'p1'
  /** 联机各自选人：对手已选的角色（主机端记录） */
  let pendingGuestPick: 0 | 1 | null = null
  /** 客户端先选人、后收到配置时的暂存 */
  let pendingCfg: MatchSettings | null = null
  /** 断线重连：房间码 / 本方角色 / 中断对局的配置 */
  let netRoomCode = ''
  let netRole: 'host' | 'guest' | null = null
  let netMatchSettings: MatchSettings | null = null
  let reconnectAttempts = 0
  /** 标题页的临时提示（断线/版本不一致等） */
  let notice = ''

  const toTitle = (msg = ''): void => {
    flow = { screen: 'title' }
    sim = null
    netSession = null
    pendingGuestPick = null
    pendingCfg = null
    netRole = null
    netMatchSettings = null
    bgmStop()
    if (netTransport) {
      try {
        netTransport.send(encodeMessage({ t: 'bye' }))
      } catch {
        // 通道已死就算了
      }
      netTransport.destroy()
      netTransport = null
    }
    notice = msg
  }

  const startMatch = (settings: MatchSettings): void => {
    lastSettings = settings
    sim = createInitialSim(settings)
    bgmStart()
    paused = false
    flow = { screen: 'match' }
  }

  // ---- 断线重连：对局中断线 → 原房间码重试 10 秒，回来自动重开此局 ----
  const RECONNECT_FRAMES = 600 // 10 秒
  function enterReconnect(): void {
    const code = netRoomCode
    const role = netRole
    if (!code || !role || !netMatchSettings) {
      toTitle('与对手的连接已断开')
      return
    }
    try {
      netTransport?.destroy()
    } catch {
      // 旧通道已死就算了
    }
    netTransport = null
    netSession = null
    sim = null
    reconnectAttempts = 0
    flow = { screen: 'reconnect', left: RECONNECT_FRAMES }
    scheduleReconnect(code, role)
  }

  function scheduleReconnect(code: string, role: 'host' | 'guest'): void {
    if (role === 'host') {
      const transport = PeerTransport.host(code, {
        onReady: () => {
          /* 已重新注册，等对手回来 */
        },
        onPeerJoined: () => {
          if (flow.screen !== 'reconnect') return
          netSlot = 'p1'
          const transport2 = netTransport
          if (transport2 && netMatchSettings) {
            transport2.send(encodeMessage({ t: 'cfg', v: NET_VERSION, settings: netMatchSettings }))
          }
          flow = { screen: 'waitGo', role: 'host', settings: netMatchSettings! }
        },
        onError: (msg) => {
          // 房间码刚释放可能在撮合服务上短暂不可用：重试几次
          if (flow.screen === 'reconnect' && reconnectAttempts < 6) {
            reconnectAttempts++
            try {
              netTransport?.destroy()
            } catch {
              // 已死就算了
            }
            netTransport = null
            setTimeout(() => {
              if (flow.screen === 'reconnect') scheduleReconnect(code, role)
            }, 1200)
          } else if (flow.screen === 'reconnect') {
            toTitle('重连出错：' + msg)
          }
        },
      })
      netTransport = transport
      transport.onMessage((data) => handleNetMessage(data))
      transport.onClose(() => {
        if (flow.screen === 'match' || flow.screen === 'countdown' || flow.screen === 'waitGo') {
          enterReconnect()
        }
      })
    } else {
      const attempt = (): void => {
        if (flow.screen !== 'reconnect') return
        const transport = PeerTransport.join(code, {
          onReady: () => {
            if (flow.screen !== 'reconnect') return
            netSlot = 'p2'
            // 等主机重发配置（cfg → 本端自动 cfgAck → go）
            flow = {
              screen: 'waitGo',
              role: 'guest',
              settings: netMatchSettings ?? { mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 },
            }
          },
          onError: () => {
            // 房间还没重新注册好：安静地再试，直到倒计时结束
            try {
              netTransport?.destroy()
            } catch {
              // 已死就算了
            }
            netTransport = null
            if (flow.screen === 'reconnect') {
              setTimeout(attempt, 1500)
            }
          },
        })
        netTransport = transport
        transport.onMessage((data) => handleNetMessage(data))
        transport.onClose(() => {
          if (flow.screen === 'match' || flow.screen === 'countdown' || flow.screen === 'waitGo') {
            enterReconnect()
          }
        })
      }
      attempt()
    }
  }

  // ---- 联机消息处理（菜单级握手；帧内 in/chk 由 NetSession 自己注册处理） ----
  function handleNetMessage(data: string): void {
    const msg = decodeMessage(data)
    if (!msg) return
    if (msg.t === 'cfg') {
      if (msg.v !== NET_VERSION) {
        toTitle('对方版本不一致，无法联机')
        return
      }
      if (flow.screen === 'waitGo' && flow.role === 'guest') {
        netTransport?.send(encodeMessage({ t: 'cfgAck', v: NET_VERSION }))
        netSession = new NetSession(netTransport!)
        flow = { screen: 'countdown', left: COUNTDOWN_FRAMES, settings: msg.settings }
      } else if (flow.screen === 'charSelect' && flow.slot === 'p2' && flow.online) {
        // 对手配置到了但自己还没选完人：暂存，选完立刻确认
        pendingCfg = msg.settings
      }
    } else if (msg.t === 'pick') {
      // 对手（客户端）报自己选的角色
      pendingGuestPick = (msg.c === 1 ? 1 : 0) as 0 | 1
      lastSettings = { ...lastSettings, p2Char: pendingGuestPick }
      if (flow.screen === 'waitPick') {
        flow = {
          screen: 'mapSelect',
          cursor: 0,
          settings: {
            mode: 'pvp',
            p1Char: lastSettings.p1Char,
            p2Char: pendingGuestPick,
          },
          online: true,
        }
      }
    } else if (msg.t === 'cfgAck') {
      if (flow.screen === 'waitGo' && flow.role === 'host') {
        netTransport?.send(encodeMessage({ t: 'go' }))
        netSession = new NetSession(netTransport!)
        flow = { screen: 'countdown', left: COUNTDOWN_FRAMES, settings: flow.settings }
      }
    } else if (msg.t === 'go') {
      if (flow.screen === 'waitGo' && flow.role === 'guest') {
        netSession = new NetSession(netTransport!)
        flow = { screen: 'countdown', left: COUNTDOWN_FRAMES, settings: flow.settings }
      }
    } else if (msg.t === 'bye') {
      if (flow.screen === 'match' || flow.screen === 'countdown') {
        toTitle('对手已离开房间')
      }
    } else if (msg.t === 'rematch') {
      // 对方要求重开：把两端会话和模拟都对齐回第 0 帧
      if (flow.screen === 'match' && netSession && sim) {
        netSession.reset()
        sim = createInitialSim(sim.settings)
      }
    } else if (msg.t === 'toselect') {
      // 对方要求回选人界面
      if (flow.screen === 'match' && netSession) {
        netSession = null
        sim = null
        bgmStop()
        if (netSlot === 'p1') {
          flow = { screen: 'charSelect', slot: 'p1', mode: 'pvp', online: true, cursor: 0 }
        } else {
          flow = { screen: 'waitGo', role: 'guest', settings: { mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 } }
        }
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    unlockAudio() // 浏览器要求：首次交互后才能出声
    if (gameKeys().has(e.code)) e.preventDefault()

    // ---- 改键 + 音量设置 ----
    if (flow.screen === 'settings') {
      const row = SETTINGS_ROWS[flow.cursor]
      if (flow.listening) {
        if (e.code !== 'Escape') {
          if (row.type === 'bind') {
            setBinding(row.slot, row.action, e.code)
          }
        }
        flow = { ...flow, listening: null }
        return
      }
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        flow = { ...flow, cursor: (flow.cursor + SETTINGS_ROWS.length - 1) % SETTINGS_ROWS.length }
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        flow = { ...flow, cursor: (flow.cursor + 1) % SETTINGS_ROWS.length }
      } else if (row.type === 'volume') {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') setVolume(getVolume() - 0.1)
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') setVolume(getVolume() + 0.1)
        else if (e.code === 'Escape') toTitle()
      } else if (row.type === 'mute') {
        if (e.code === 'Enter' || e.code === 'KeyF') toggleMute()
        else if (e.code === 'Escape') toTitle()
      } else if (row.type === 'fullscreen') {
        if (e.code === 'Enter' || e.code === 'KeyF') toggleFullscreen()
        else if (e.code === 'Escape') toTitle()
      } else {
        if (e.code === 'Enter') {
          flow = { ...flow, listening: { slot: row.slot, action: row.action } }
        } else if (e.code === 'Escape') {
          toTitle()
        }
      }
      return
    }

    // ---- 加入房间：输入房间码 ----
    if (flow.screen === 'joinLobby') {
      if (e.code === 'Escape') {
        toTitle()
        return
      }
      if (flow.connecting) return
      // 房间码没变时按回车 = 重试连接
      if (e.code === 'Enter' && isValidRoomCode(flow.typed)) {
        attemptJoin(flow.typed)
        return
      }
      let ch = ''
      if (e.code.startsWith('Key')) ch = e.code.slice(3)
      else if (e.code.startsWith('Digit')) ch = e.code.slice(5)
      else if (e.code.startsWith('Numpad')) ch = e.code.slice(6)
      const typed =
        e.code === 'Backspace'
          ? flow.typed.slice(0, -1)
          : (flow.typed + (ch ? ch.toUpperCase() : '')).slice(0, 4)
      flow = { ...flow, typed, status: '输入 4 位房间码' }
      if (isValidRoomCode(typed)) attemptJoin(typed)
      return
    }

    // ---- 房主大厅：等待对手 ----
    if (flow.screen === 'hostLobby') {
      if (e.code === 'Escape') toTitle()
      return
    }

    /** 发起加入房间连接（输错/房间未就绪时可重试） */
    function attemptJoin(code: string): void {
      flow = { screen: 'joinLobby', typed: code, status: `连接房间 ${code} 中…`, connecting: true }
      netSlot = 'p2'
      const transport = PeerTransport.join(code, {
        onReady: () => {
          notice = ''
          netRoomCode = code
          netRole = 'guest'
          // 联机各自选人：客户端选自己的角色
          flow = { screen: 'charSelect', slot: 'p2', mode: 'pvp', online: true, cursor: 0 }
        },
        onError: (msg) => {
          if (msg === 'room-not-found') {
            flow = { screen: 'joinLobby', typed: code, status: '房间不存在：检查房码后按回车重试（Esc 返回）', connecting: false }
          } else {
            toTitle('联机出错：' + msg)
          }
        },
      })
      netTransport = transport
      transport.onMessage((data) => handleNetMessage(data))
      transport.onClose(() => {
        if (flow.screen === 'match' || flow.screen === 'countdown' || flow.screen === 'waitGo') {
          enterReconnect()
        } else {
          toTitle('与对手的连接已断开')
        }
      })
    }

    if (flow.screen === 'netMenu') {
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        const code = makeRoomCode()
        const transport = PeerTransport.host(code, {
          onReady: () => {
            // 注册完成：现在报房间码才有人连得上
            if (flow.screen === 'hostLobby') flow = { ...flow, ready: true }
          },
          onPeerJoined: () => {
            netSlot = 'p1'
            netRoomCode = code
            netRole = 'host'
            notice = ''
            pendingGuestPick = null
            pendingCfg = null
            flow = { screen: 'charSelect', slot: 'p1', mode: 'pvp', online: true, cursor: 0 }
          },
          onError: (msg) => toTitle('联机出错：' + msg),
        })
        netTransport = transport
        transport.onMessage((data) => handleNetMessage(data))
        transport.onClose(() => {
          if (flow.screen === 'match' || flow.screen === 'countdown' || flow.screen === 'waitGo') {
            enterReconnect()
          } else {
            toTitle('与对手的连接已断开')
          }
        })
        flow = { screen: 'hostLobby', code, ready: false }
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        flow = { screen: 'joinLobby', typed: '', status: '输入 4 位房间码', connecting: false }
      } else if (e.code === 'Escape') {
        toTitle()
      }
      return
    }

    // ---- 标题 ----
    if (flow.screen === 'title') {
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        flow = { screen: 'charSelect', slot: 'p1', mode: 'pvp', online: false, cursor: 0 }
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        notice = ''
        flow = { screen: 'aiLevel' }
      } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
        flow = { screen: 'settings', cursor: 0, listening: null }
      } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
        notice = ''
        flow = { screen: 'netMenu' }
      } else if (e.code === 'Digit5' || e.code === 'Numpad5') {
        // 新手教学
        sim = createInitialSim({ mode: 'pve', p1Char: 0, p2Char: 1, mapId: 0, tutorial: true })
        bgmStart()
        flow = { screen: 'tutorial', step: 0, prevDamage: 0 }
      }
      return
    }

    // ---- 人机难度选择 ----
    if (flow.screen === 'aiLevel') {
      const lv = (e.code === 'Digit3' || e.code === 'Numpad3' ? 2 : e.code === 'Digit2' || e.code === 'Numpad2' ? 1 : e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : -1) as -1 | 0 | 1 | 2
      if (lv >= 0) {
        lastSettings = { ...lastSettings, mode: 'pve', aiLevel: lv as 0 | 1 | 2 }
        flow = { screen: 'charSelect', slot: 'p1', mode: 'pve', online: false, cursor: 0 }
      } else if (e.code === 'Escape') {
        toTitle()
      }
      return
    }

    // ---- 选人 ----
    if (flow.screen === 'charSelect') {
      // 单机 pve 或联机下都是"各自选各自的"：P1 用左侧键，P2 用右侧键
      const p1Controls = flow.slot === 'p1' || flow.mode === 'pve'
      const left = p1Controls ? 'KeyA' : 'ArrowLeft'
      const right = p1Controls ? 'KeyD' : 'ArrowRight'
      const confirm = p1Controls ? 'KeyF' : flow.mode === 'pvp' ? 'Numpad0' : 'Slash'
      const confirm2 = p1Controls ? undefined : 'Slash'
      if (e.code === left) flow = { ...flow, cursor: ((flow.cursor + 3) % 4) as 0 | 1 | 2 | 3 }
      else if (e.code === right) flow = { ...flow, cursor: ((flow.cursor + 1) % 4) as 0 | 1 | 2 | 3 }
      else if (e.code === confirm || e.code === confirm2) {
        if (flow.slot === 'p1') {
          if (flow.online) {
            // 联机房主选完自己的：等对手报角色（可能已经报过了）
            if (pendingGuestPick !== null) {
              flow = {
                screen: 'mapSelect',
                cursor: 0,
                settings: {
                  mode: flow.mode,
                  p1Char: flow.cursor,
                  p2Char: pendingGuestPick,
                },
                online: true,
              }
            } else {
              flow = { screen: 'waitPick' }
            }
          } else {
            flow = { ...flow, slot: 'p2' }
          }
        } else if (flow.online) {
          // 联机对手确认自己的角色：报给主机
          netTransport?.send(encodeMessage({ t: 'pick', c: flow.cursor }))
          if (pendingCfg) {
            // 配置已提前到达：立刻确认并进入倒计时
            netTransport?.send(encodeMessage({ t: 'cfgAck', v: NET_VERSION }))
            netSession = new NetSession(netTransport!)
            const st = pendingCfg
            pendingCfg = null
            flow = { screen: 'countdown', left: COUNTDOWN_FRAMES, settings: st }
          } else {
            flow = { screen: 'waitGo', role: 'guest', settings: { mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 } }
          }
        } else {
          flow = {
            screen: 'mapSelect',
            cursor: 0,
            settings: {
              mode: flow.mode,
              p1Char: lastSettings.p1Char,
              p2Char: flow.cursor,
              aiLevel: lastSettings.aiLevel,
            },
            online: false,
          }
        }
      }
      if (flow.screen === 'charSelect' && flow.slot === 'p1') {
        lastSettings = { ...lastSettings, mode: flow.mode, p1Char: flow.cursor }
      }
      if (flow.screen === 'charSelect' && flow.slot === 'p2') {
        lastSettings = { ...lastSettings, p2Char: flow.cursor }
      }
      return
    }

    // ---- 选图 ----
    if (flow.screen === 'mapSelect') {
      const pickMap = ((): 0 | 1 | 2 | -1 => {
        if (e.code === 'Digit1' || e.code === 'Numpad1') return 0
        if (e.code === 'Digit2' || e.code === 'Numpad2') return 1
        if (e.code === 'Digit3' || e.code === 'Numpad3') return 2
        return -1
      })()
      if (pickMap >= 0) {
        const settings: MatchSettings = { ...flow.settings, mapId: pickMap as 0 | 1 | 2 }
        if (flow.online && netTransport) {
          netTransport.send(encodeMessage({ t: 'cfg', v: NET_VERSION, settings }))
          flow = { screen: 'waitGo', role: 'host', settings }
        } else {
          startMatch(settings)
        }
      }
      return
    }

    // ---- 等待开战 / 倒计时 / 等对手选人 / 重连等待 ----
    if (
      flow.screen === 'waitGo' || flow.screen === 'countdown' ||
      flow.screen === 'waitPick' || flow.screen === 'reconnect'
    ) {
      if (e.code === 'Escape') toTitle(flow.screen === 'reconnect' ? '已放弃重连' : '')
      return
    }

    // ---- 对局 ----
    if (flow.screen === 'match') {
      if (netSession) {
        // 联机对局：不能暂停（双方必须同步）
        if (e.code === 'Escape') toTitle('已退出联机对局')
        else if (sim && sim.matchOver !== 0 && e.code === 'KeyR') {
          // 任一方按 R → 两端同步重开
          netTransport?.send(encodeMessage({ t: 'rematch' }))
          netSession.reset()
          sim = createInitialSim(sim.settings)
        } else if (sim && sim.matchOver !== 0 && e.code === 'KeyC') {
          // 任一方按 C → 两端回到选人界面
          netTransport?.send(encodeMessage({ t: 'toselect' }))
          netSession = null
          sim = null
          if (netSlot === 'p1') {
            flow = { screen: 'charSelect', slot: 'p1', mode: 'pvp', online: true, cursor: 0 }
          } else {
            flow = { screen: 'waitGo', role: 'guest', settings: { mode: 'pvp', p1Char: 0, p2Char: 0, mapId: 0 } }
          }
        }
      } else {
        if (e.code === 'KeyP' && !e.repeat) {
          paused = !paused // 单机暂停/继续（防键盘重复事件）
        } else if (e.code === 'KeyR') startMatch(lastSettings)
        else if (e.code === 'KeyC') {
          sim = null
          paused = false
          bgmStop()
          flow = { screen: 'charSelect', slot: 'p1', mode: lastSettings.mode, online: false, cursor: 0 }
        } else if (e.code === 'Escape') {
          paused = false
          toTitle()
        }
      }
      held.add(e.code)
      return
    }

    held.add(e.code)
  })

  window.addEventListener('keyup', (e) => held.delete(e.code))
  window.addEventListener('blur', () => held.clear())

  // ---- 模拟推进 ----
  let acc = 0
  /** 多来源输入合并（键 ∪ 手柄 ∪ 触屏：任一来源按住即生效） */
  function mergeInputs(parts: PlayerInput[]): PlayerInput {
    const out = emptyInput()
    for (const p of parts) {
      if (p.left) out.left = true
      if (p.right) out.right = true
      if (p.up) out.up = true
      if (p.down) out.down = true
      if (p.attack) out.attack = true
      if (p.shield) out.shield = true
      if (p.dodge) out.dodge = true
    }
    return out
  }
  /** 全屏切换（浏览器要求在用户按键手势内调用） */
  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  /** 读"某槽位的人类输入"：键盘 + 手柄 + （属于自己的）触屏 */
  function humanInput(slot: PlayerSlot): PlayerInput {
    const parts: PlayerInput[] = [readInput(held, getKeymaps()[slot])]
    // 手柄：第 1 支 → P1，第 2 支 → P2；联机时第 1 支永远归本方
    const pads = pollGamepads()
    const padIndex = netSession ? 0 : slot === 'p1' ? 0 : 1
    const pad: PadSnapshot | null = pads[padIndex] ?? null
    if (pad) parts.push(padToInput(pad))
    // 触屏：单人模式的 P1 或联机本方槽位
    const touchTarget: PlayerSlot = netSession ? netSlot : 'p1'
    if (touch.isVisible() && slot === touchTarget) parts.push(touch.asInput())
    return mergeInputs(parts)
  }
  const advanceOneTick = (): void => {
    // 倒计时：纯 UI 计数，不推进模拟
    if (flow.screen === 'countdown') {
      flow.left--
      if (flow.left <= 0) {
        if (netSession) netMatchSettings = flow.settings // 中断重连时按此配置重开
        startMatch(flow.settings)
      }
      return
    }
    // 断线重连等待：数到 0 放弃
    if (flow.screen === 'reconnect') {
      flow.left--
      if (flow.left <= 0) toTitle('重连超时：对手没有回来')
      return
    }
    // 新手教学：单机推进 + 检查当前步骤是否完成
    if (flow.screen === 'tutorial' && sim) {
      const inputs = [humanInput('p1'), emptyInput()] as const
      step(sim, inputs)
      const stepDef = TUTORIAL_STEPS[flow.step]
      if (stepDef) {
        const damage = sim.players[1].damage
        const hitDelta = damage - flow.prevDamage
        flow.prevDamage = damage
        if (stepDef.done(sim, hitDelta)) flow.step++
      }
      return
    }
    if (flow.screen !== 'match' || !sim) return
    if (paused) return // 暂停：模拟冻结

    if (netSession) {
      // 联机：锁帧推进——收齐双方输入才走一帧
      netSession.pushLocal(encodeInput(humanInput(netSlot)))
      const pair = netSession.tryAdvance()
      if (pair === null) {
        // 等待超过 3 秒仍收不到对方输入 → 视为断线，尝试重连而不是冻死
        if (netSession.waitingFrames > 180) enterReconnect()
        return
      }
      const d0 = decodeInput(pair[0])
      const d1 = decodeInput(pair[1])
      const inputs =
        netSlot === 'p1' ? [d0, d1] as const : [d1, d0] as const
      step(sim, inputs)
      netSession.afterStep(sim)
      return
    }

    // 单机：P2 也可用第 2 支手柄
    const inputs = [humanInput('p1'), humanInput('p2')] as const
    step(sim, inputs)
  }

  renderer.app.ticker.add((ticker) => {
    acc += Math.min(ticker.deltaMS, 250)
    while (acc >= MS_PER_TICK) {
      advanceOneTick()
      acc -= MS_PER_TICK
    }
    renderer.render(currentScreen())
  })

  function currentScreen(): Screen {
    switch (flow.screen) {
      case 'title':
        return { kind: 'title', notice }
      case 'netMenu':
        return { kind: 'netMenu' }
      case 'aiLevel':
        return { kind: 'aiLevel' }
      case 'hostLobby':
        return { kind: 'hostLobby', code: flow.code, ready: flow.ready }
      case 'joinLobby':
        return { kind: 'joinLobby', typed: flow.typed, status: flow.status }
      case 'waitGo':
        return { kind: 'waitGo', role: flow.role }
      case 'waitPick':
        return { kind: 'waitPick' }
      case 'reconnect':
        return { kind: 'reconnect', left: flow.left, code: netRoomCode }
      case 'countdown':
        return { kind: 'countdown', left: flow.left }
      case 'tutorial':
        return {
          kind: 'tutorial',
          sim: sim!,
          instruction: TUTORIAL_STEPS[Math.min(flow.step, TUTORIAL_STEPS.length - 1)].instruction,
          step: Math.min(flow.step + 1, TUTORIAL_STEPS.length),
          total: TUTORIAL_STEPS.length,
        }
      case 'charSelect': {
        const who =
          flow.slot === 'p1'
            ? 'P1（红）'
            : flow.mode === 'pve'
              ? '电脑（蓝）'
              : 'P2（蓝）'
        const confirmHint =
          flow.slot === 'p1' || flow.mode === 'pve'
            ? 'A / D 切换 · F 确认'
            : '← / → 切换 · 小键盘0 或 / 确认'
        return { kind: 'charSelect', who, cursor: flow.cursor, confirmHint }
      }
      case 'mapSelect':
        return { kind: 'mapSelect', cursor: flow.cursor }
      case 'settings': {
        const maps = getKeymaps()
        return {
          kind: 'settings',
          cursor: flow.cursor,
          listening: flow.listening ? keyDisplayName('Enter') : null,
          rows: SETTINGS_ROWS.map((row) => {
            if (row.type === 'bind') {
              return {
                label: `${SLOT_NAMES[row.slot]} ${ACTION_NAMES[row.action]}`,
                bound: maps[row.slot][row.action].map(keyDisplayName).join(' 或 '),
              }
            }
            if (row.type === 'volume') {
              const v = Math.round(getVolume() * 10)
              return {
                label: '音量',
                bound: '▮'.repeat(v) + '▯'.repeat(10 - v) + '  ←/→ 调节',
              }
            }
            if (row.type === 'fullscreen') {
              return {
                label: '全屏',
                bound: document.fullscreenElement ? '已开启（回车切换）' : '未开启（回车切换）',
              }
            }
            return { label: '静音', bound: isMuted() ? '已静音' : '关闭' }
          }),
        }
      }
      case 'match':
        if (!sim) return { kind: 'title', notice: '' }
        return {
          kind: 'match',
          sim,
          paused: paused && !netSession,
          net: netSession
            ? {
                waiting: netSession.waitingFrames > 5,
                desync: netSession.desync,
                online: true,
              }
            : undefined,
        }
    }
  }

  const SETTINGS_ROWS: (
    | { type: 'bind'; slot: PlayerSlot; action: (typeof ACTIONS)[number] }
    | { type: 'volume' }
    | { type: 'mute' }
    | { type: 'fullscreen' }
  )[] = [
    ...(['p1', 'p2'] as const).flatMap((slot) =>
      ACTIONS.map((action) => ({ type: 'bind' as const, slot, action })),
    ),
    { type: 'volume' },
    { type: 'mute' },
    { type: 'fullscreen' },
  ]

  // 调试钩子
  ;(window as unknown as Record<string, unknown>).__onepg = {
    getTick: () => sim?.tick ?? -1,
    getPlayers: () =>
      sim
        ? [structuredClone(sim.players[0]), structuredClone(sim.players[1])]
        : null,
    getMatchOver: () => sim?.matchOver ?? 0,
    getMode: () => sim?.settings.mode ?? 'menu',
    getFlow: () => flow.screen,
    getSettings: () => sim?.settings ?? null,
    getWeapons: () => (sim ? structuredClone(sim.weapons) : []),
    getRoomCode: () => netRoomCode || (flow.screen === 'hostLobby' ? flow.code : ''),
    getNet: () => ({
      slot: netSlot,
      waiting: netSession?.waitingFrames ?? -1,
      desync: netSession?.desync ?? false,
      netTick: netSession?.tick ?? -1,
    }),
    // 模拟断线（测试重连用）：不发 bye 直接砸掉通道并进入重连流程
    dropConnection: () => {
      try {
        netTransport?.destroy()
      } catch {
        // 已死就算了
      }
      if (flow.screen === 'match' || flow.screen === 'countdown' || flow.screen === 'waitGo') {
        enterReconnect()
      }
    },
    startMatch: (partial: Partial<MatchSettings>) => {
      startMatch({
        mode: partial.mode ?? 'pvp',
        p1Char: partial.p1Char ?? 0,
        p2Char: partial.p2Char ?? 0,
        mapId: partial.mapId ?? 0,
      })
    },
    stepFrames: (n: number) => {
      for (let i = 0; i < n; i++) advanceOneTick()
      renderer.render(currentScreen())
    },
    key: (code: string, down: boolean) => {
      window.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', { code }),
      )
    },
    releaseAll: () => {
      for (const code of gameKeys()) held.delete(code)
    },
    touchShow: (v: boolean) => touch.setVisible(v),
    touchHeld: (a: string) => touch.isHeld(a as never),
  }
}

void boot()
