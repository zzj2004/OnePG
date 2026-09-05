// ============================================================
// 触屏按钮层：虚拟十字键 + 动作键
// DOM 实现，按下=按住、松手=松开，与键盘完全等价
// 输入层职责：只记录"哪些动作被按住"，如何并入模拟输入由 main 决定
// ============================================================
import type { ActionName } from './keys'

interface ButtonSpec {
  action: ActionName
  label: string
  area: 'left' | 'right'
  x: string
  y: string
}

const BUTTONS: ButtonSpec[] = [
  { action: 'left', label: '←', area: 'left', x: '14px', y: '78px' },
  { action: 'right', label: '→', area: 'left', x: '108px', y: '78px' },
  { action: 'up', label: '↑', area: 'left', x: '61px', y: '24px' },
  { action: 'down', label: '↓', area: 'left', x: '61px', y: '132px' },
  { action: 'attack', label: '攻', area: 'right', x: '24px', y: '56px' },
  { action: 'shield', label: '防', area: 'right', x: '116px', y: '32px' },
  { action: 'dodge', label: '闪', area: 'right', x: '116px', y: '124px' },
]

export class TouchControls {
  private touchHeld = new Set<ActionName>()
  private root: HTMLDivElement
  private visible = false

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'touch-ui'
    this.root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;display:none;z-index:10;'

    for (const spec of BUTTONS) {
      const b = document.createElement('div')
      b.dataset.action = spec.action
      b.textContent = spec.label
      const side = spec.area === 'left' ? `left:${spec.x}` : `right:${spec.x}`
      b.style.cssText = [
        'position:fixed',
        side,
        `bottom:${spec.y}`,
        'width:72px',
        'height:72px',
        'border-radius:50%',
        'border:2px solid rgba(232,236,243,0.5)',
        'background:rgba(16,19,26,0.55)',
        'color:rgba(232,236,243,0.85)',
        'font:700 20px "Microsoft YaHei",sans-serif',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'pointer-events:auto',
        'touch-action:none',
        'user-select:none',
        '-webkit-user-select:none',
      ].join(';')
      this.bindButton(b, spec.action)
      this.root.appendChild(b)
    }

    parent.appendChild(this.root)
  }

  private bindButton(b: HTMLDivElement, action: ActionName): void {
    const down = (e: Event): void => {
      e.preventDefault()
      this.touchHeld.add(action)
      b.style.background = 'rgba(83,230,192,0.35)'
    }
    const up = (e: Event): void => {
      e.preventDefault()
      this.touchHeld.delete(action)
      b.style.background = 'rgba(16,19,26,0.55)'
    }
    b.addEventListener('pointerdown', down)
    b.addEventListener('pointerup', up)
    b.addEventListener('pointercancel', up)
    b.addEventListener('pointerleave', up)
    b.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** 某动作当前是否被手指按住 */
  isHeld(action: ActionName): boolean {
    return this.touchHeld.has(action)
  }

  /** 当前触屏按住的完整输入（并集由 main 决定） */
  asInput(): {
    left: boolean
    right: boolean
    up: boolean
    down: boolean
    attack: boolean
    shield: boolean
    dodge: boolean
  } {
    return {
      left: this.touchHeld.has('left'),
      right: this.touchHeld.has('right'),
      up: this.touchHeld.has('up'),
      down: this.touchHeld.has('down'),
      attack: this.touchHeld.has('attack'),
      shield: this.touchHeld.has('shield'),
      dodge: this.touchHeld.has('dodge'),
    }
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.root.style.display = v ? 'block' : 'none'
    if (!v) this.touchHeld.clear()
  }

  isVisible(): boolean {
    return this.visible
  }
}

/** 是否是触屏为主的设备 */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}
