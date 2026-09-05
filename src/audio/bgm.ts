// ============================================================
// 程序生成 BGM：芯片音乐风格的战斗循环
// Am → F → C → E 和弦进行，贝斯 + 琶音旋律 + 鼓点，132 BPM
// 前瞻式调度（lookahead scheduler）：定时器只排未来 0.15s 内的音符
// 全部走 sfx 模块的总输出节点 → 跟随音量/静音设置
// ============================================================
import { audioOut, hasAudio } from './sfx'

const BPM = 132
const STEP = 60 / BPM / 4 // 十六分音符时长（秒）
const LOOKAHEAD = 0.15

interface Step {
  bass?: number
  lead?: number
  hat?: boolean
  snare?: boolean
}

// 音名 → 频率（Hz）
const N = {
  E2: 82.41, F2: 87.31, A2: 110, C3: 130.81,
  C4: 261.63, E4: 329.63, F4: 349.23, G4: 392, Gs4: 415.3, A4: 440, B4: 493.88,
  C5: 523.25, E5: 659.25, G5: 783.99, A5: 880,
}

/** 4 小节 × 16 步 = 64 步循环 */
function buildPattern(): Step[] {
  const bars: { bass: number; arp: number[] }[] = [
    { bass: N.A2, arp: [N.A4, N.C5, N.E5, N.C5] }, // Am
    { bass: N.F2, arp: [N.F4, N.A4, N.C5, N.A4] }, // F
    { bass: N.C3, arp: [N.C4, N.E4, N.G4, N.E4] }, // C
    { bass: N.E2, arp: [N.E5, N.B4, N.Gs4, N.B4] }, // E（回到 Am 的属和弦，制造循环张力）
  ]
  const steps: Step[] = []
  for (const bar of bars) {
    for (let s = 0; s < 16; s++) {
      const step: Step = {}
      // 贝斯：八分音符根音脉冲
      if (s % 2 === 0) step.bass = bar.bass
      // 旋律：十六分琶音
      step.lead = bar.arp[s % 4]
      // 鼓：每 4 步一个 hat，第 4/12 步加 snare
      if (s % 4 === 2) step.hat = true
      if (s === 4 || s === 12) step.snare = true
      steps.push(step)
    }
  }
  return steps
}

const PATTERN = buildPattern()

let timer: ReturnType<typeof setInterval> | null = null
let stepIdx = 0
let nextTime = 0

function toneAt(
  freq: number, dur: number, type: OscillatorType, gain: number, when: number,
): void {
  const dest = audioOut()
  if (!dest) return
  const osc = (dest.context as AudioContext).createOscillator()
  const g = (dest.context as AudioContext).createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(gain, when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  osc.connect(g).connect(dest)
  osc.start(when)
  osc.stop(when + dur + 0.02)
}

function noiseAt(dur: number, filterHz: number, gain: number, when: number): void {
  const dest = audioOut()
  if (!dest) return
  const ac = dest.context as AudioContext
  const len = Math.max(1, Math.floor(ac.sampleRate * dur))
  const buffer = ac.createBuffer(1, len, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = filterHz
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  src.connect(filter).connect(g).connect(dest)
  src.start(when)
}

function scheduleStep(step: Step, when: number): void {
  if (step.bass !== undefined) {
    toneAt(step.bass, STEP * 1.6, 'square', 0.045, when)
  }
  if (step.lead !== undefined) {
    toneAt(step.lead, STEP * 0.9, 'triangle', 0.05, when)
  }
  if (step.hat) noiseAt(0.03, 6000, 0.03, when)
  if (step.snare) noiseAt(0.09, 1800, 0.05, when)
}

function scheduler(): void {
  const dest = audioOut()
  if (!dest) return
  const now = dest.context.currentTime
  while (nextTime < now + LOOKAHEAD) {
    scheduleStep(PATTERN[stepIdx], nextTime)
    stepIdx = (stepIdx + 1) % PATTERN.length
    nextTime += STEP
  }
}

/** 开始战斗 BGM（已在播放则无操作，跨局连续） */
export function bgmStart(): void {
  if (!hasAudio() || timer !== null) return
  stepIdx = 0
  nextTime = 0
  scheduler()
  timer = setInterval(scheduler, 25)
}

export function bgmStop(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

export function bgmPlaying(): boolean {
  return timer !== null
}
