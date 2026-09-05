// ============================================================
// 打击感表现层：粒子 + 屏幕震动
// 纯表现，不参与模拟，不需要确定性（可用随机数）
// ============================================================
import { Graphics } from 'pixi.js'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: number
  size: number
  gravity: number
}

const MAX_PARTICLES = 300

export class Juice {
  private particles: Particle[] = []
  /** 当前震动强度（像素），随时间衰减 */
  shake = 0

  /** 命中：strength 0~1，决定火花量与震动幅度 */
  spawnHit(x: number, y: number, strength: number, color: number): void {
    const s = Math.max(0, Math.min(1, strength))
    const count = 6 + Math.floor(s * 14)
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 2 + Math.random() * (3 + s * 7)
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 12 + Math.random() * 10,
        maxLife: 22,
        color,
        size: 2 + Math.random() * 3,
        gravity: 0.25,
      })
    }
    this.shake = Math.max(this.shake, 2 + s * 10)
  }

  /** KO：爆裂（减量提速——以前满屏血点糊脸） */
  spawnKO(x: number, y: number, color: number): void {
    const cx = Math.max(60, Math.min(1220, x))
    const cy = Math.max(60, Math.min(660, y))
    for (let i = 0; i < 18 && this.particles.length < MAX_PARTICLES; i++) {
      const angle = (i / 18) * Math.PI * 2
      const speed = 6 + Math.random() * 4
      const white = i % 3 === 0
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 13 + Math.random() * 9,
        maxLife: 22,
        color: white ? 0xffffff : color,
        size: 2.5 + Math.random() * 2.5,
        gravity: 0.24,
      })
    }
    this.shake = Math.max(this.shake, 12)
  }

  /** 拾取闪光：向上的小星星 */
  spawnPickup(x: number, y: number, color: number): void {
    for (let i = 0; i < 8 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + (Math.random() * 40 - 20),
        y: y - Math.random() * 20,
        vx: (Math.random() * 2 - 1) * 1.5,
        vy: -2 - Math.random() * 2,
        life: 16 + Math.random() * 8,
        maxLife: 24,
        color,
        size: 2 + Math.random() * 2,
        gravity: 0.05,
      })
    }
  }

  /** 每帧更新并画到画布上，返回当前震动偏移 */
  updateAndDraw(g: Graphics): { dx: number; dy: number } {
    // 震动衰减
    this.shake *= 0.86
    if (this.shake < 0.3) this.shake = 0
    const dx = this.shake ? (Math.random() * 2 - 1) * this.shake : 0
    const dy = this.shake ? (Math.random() * 2 - 1) * this.shake : 0

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx
      p.y += p.vy
      p.vy += p.gravity
      p.vx *= 0.98
      p.life--
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      g.rect(p.x, p.y, p.size, p.size).fill({
        color: p.color,
        alpha: Math.max(0, p.life / p.maxLife),
      })
    }
    return { dx, dy }
  }
}
