// ============================================================
// 手柄映射单测（npm run test 第三段）
// ============================================================
import { padToInput, type PadSnapshot } from '../input/gamepad'

let failed = false
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅ 通过' : '❌ 失败'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed = true
}

const mkPad = (ax = 0, ay = 0, pressed: number[] = []): PadSnapshot => ({
  axes: [ax, ay],
  buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })),
})

// 全空输入
const idle = padToInput(mkPad())
check(
  '手柄·无输入时全键松开',
  !idle.left && !idle.right && !idle.up && !idle.down && !idle.attack && !idle.shield && !idle.dodge,
)

// 摇杆方向
check('手柄·摇杆左', padToInput(mkPad(-0.8, 0)).left)
check('手柄·摇杆右', padToInput(mkPad(0.8, 0)).right)
check('手柄·摇杆下', padToInput(mkPad(0, 0.8)).down)
// 死区：轻微偏移不算输入
const dz = padToInput(mkPad(0.2, -0.2))
check('手柄·死区内偏移不产生输入', !dz.left && !dz.right && !dz.up)

// 十字键
check('手柄·十字键左(14)', padToInput(mkPad(0, 0, [14])).left)
check('手柄·十字键右(15)', padToInput(mkPad(0, 0, [15])).right)
check('手柄·十字键上(12)', padToInput(mkPad(0, 0, [12])).up)
check('手柄·十字键下(13)', padToInput(mkPad(0, 0, [13])).down)

// 动作键（Xbox 标准布局索引）
check('手柄·A(0)=跳', padToInput(mkPad(0, 0, [0])).up)
check('手柄·X(2)=攻击', padToInput(mkPad(0, 0, [2])).attack)
check('手柄·B(1)=防御', padToInput(mkPad(0, 0, [1])).shield)
check('手柄·Y(3)=闪避', padToInput(mkPad(0, 0, [3])).dodge)

// 组合：摇杆右 + X 攻击（跑攻）
const combo = padToInput(mkPad(0.9, 0, [2]))
check('手柄·组合：右+攻击', combo.right && combo.attack && !combo.left)

if (failed) {
  throw new Error('手柄测试未通过：上面的 ❌ 项必须先修好')
}
console.log('\n手柄测试全部通过 ✔')
