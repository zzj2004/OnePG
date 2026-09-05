// ============================================================
// 程序生成音效（Web Audio，零音频素材）
// 浏览器要求：AudioContext 必须在用户交互后创建/恢复，首次按键时解锁
// 全部表现层：不参与模拟，不需要确定性
// ============================================================

let ctx: AudioContext | null = null
let master: GainNode | null = null
const VOL_KEY = "onepg-audio"
let volume = 0.7
let muted = false

function loadAudioSettings(): void {
  try {
    const raw = localStorage.getItem(VOL_KEY)
    if (raw) {
      const s = JSON.parse(raw) as { volume?: number; muted?: boolean }
      if (typeof s.volume === "number") volume = s.volume
      if (typeof s.muted === "boolean") muted = s.muted
    }
  } catch {
    // 无 localStorage（测试环境）静默降级
  }
}

function applyVolume(): void {
  if (master) master.gain.value = muted ? 0 : volume
}

/** 首次用户交互时调用，解锁声音 */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext()
      loadAudioSettings()
      master = ctx.createGain()
      applyVolume()
      master.connect(ctx.destination)
    } catch {
      ctx = null // 无声环境（自动化测试等）静默降级
    }
  }
  if (ctx && ctx.state === "suspended") void ctx.resume()
}

function out(): AudioNode | null {
  return master ?? ctx?.destination ?? null
}

/** BGM 等其他音频层的输出节点（接入总音量/静音控制） */
export function audioOut(): AudioNode | null {
  return out()
}

/** Web Audio 是否已解锁可用 */
export function hasAudio(): boolean {
  return ctx !== null
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ volume, muted }))
  } catch {}
  applyVolume()
}

export function getVolume(): number {
  return volume
}

export function toggleMute(): void {
  muted = !muted
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ volume, muted }))
  } catch {}
  applyVolume()
}

export function isMuted(): boolean {
  return muted
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.15,
  slideTo?: number,
  delay = 0,
): void {
  const dest = out()
  if (!ctx || !dest) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur)
  }
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(dest)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise(dur: number, filterHz: number, gain = 0.12, sweepTo?: number): void {
  const dest = out()
  if (!ctx || !dest) return
  const t0 = ctx.currentTime
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.setValueAtTime(filterHz, t0)
  if (sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 40), t0 + dur)
  }
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter).connect(g).connect(dest)
  src.start(t0)
}

export const sfx = {
  /** 出招呼啸 */
  swing(): void {
    noise(0.09, 2400, 0.06, 600)
  },
  /** 命中：strength 0=轻 1=满蓄重击 */
  hit(strength: number): void {
    const s = Math.max(0, Math.min(1, strength))
    noise(0.06 + 0.08 * s, 1200 - 500 * s, 0.1 + 0.12 * s)
    tone(160 - 60 * s, 0.1 + 0.12 * s, "sine", 0.18 + 0.14 * s, 50)
  },
  /** 盾牌格挡：金属叮 */
  shieldBlock(): void {
    tone(880, 0.07, "triangle", 0.12)
    tone(1318, 0.09, "triangle", 0.08, undefined, 0.02)
  },
  /** 破防：碎裂感 */
  shieldBreak(): void {
    noise(0.25, 3000, 0.16, 300)
    tone(220, 0.3, "sawtooth", 0.1, 60)
  },
  /** 闪避呼啸 */
  dodge(): void {
    noise(0.12, 600, 0.08, 2000)
  },
  /** KO 爆响 */
  ko(): void {
    tone(120, 0.5, "sine", 0.3, 28)
    noise(0.4, 800, 0.2, 100)
  },
  /** 拾取武器：双音上扬 */
  pickup(): void {
    tone(523, 0.06, "square", 0.06)
    tone(784, 0.08, "square", 0.06, undefined, 0.06)
  },
  /** 倒计时哔 */
  count(): void {
    tone(440, 0.08, "square", 0.08)
  },
  /** 开战高音 */
  go(): void {
    tone(880, 0.16, "square", 0.1)
  },
  /** 胜利琶音 */
  victory(): void {
    tone(523, 0.1, "triangle", 0.1)
    tone(659, 0.1, "triangle", 0.1, undefined, 0.1)
    tone(784, 0.1, "triangle", 0.1, undefined, 0.2)
    tone(1047, 0.24, "triangle", 0.12, undefined, 0.3)
  },
  /** 跳跃轻音 */
  jump(): void {
    tone(300, 0.07, "sine", 0.05, 500)
  },
}
