export interface Platform {
  id: number
  x: number // 左边缘
  y: number // 顶面高度（脚所站的位置）
  w: number
  h: number // 仅用于绘制厚度
  /** true = 软平台：可下穿、可从下方跳上穿 */
  soft: boolean
}

export interface WeaponSpawnPoint {
  x: number
  y: number // 地面高度（武器落点）
}

export interface StageMap {
  id: number
  name: string
  platforms: Platform[]
  spawns: [number, number] // P1 / P2 出生点（x）
  weaponSpawns: WeaponSpawnPoint[]
  /** 自定义出界线（缺省用全局常量）：窄桥等地图鼓励击飞对决 */
  blast?: { left: number; right: number; top: number; bottom: number }
}

// ---- 地图0「孤岛」：M0 基线地图，主岛 + 三块软平台，左右对称 ----
const ISLAND: StageMap = {
  id: 0,
  name: '孤岛',
  platforms: [
    { id: 0, x: 340, y: 560, w: 600, h: 90, soft: false }, // 主岛
    { id: 1, x: 420, y: 430, w: 200, h: 14, soft: true }, // 左软平台
    { id: 2, x: 660, y: 430, w: 200, h: 14, soft: true }, // 右软平台
    { id: 3, x: 540, y: 320, w: 200, h: 14, soft: true }, // 高台
  ],
  spawns: [490, 790],
  weaponSpawns: [
    { x: 640, y: 560 }, // 主岛中央
    { x: 640, y: 320 }, // 高台
  ],
}

// ---- 地图1「双峰」：主岛裂成两根石柱，中间深渊裂缝，考验跨缝博弈 ----
const TWIN_PEAKS: StageMap = {
  id: 1,
  name: '双峰',
  platforms: [
    { id: 0, x: 240, y: 560, w: 280, h: 90, soft: false }, // 左柱
    { id: 1, x: 760, y: 560, w: 280, h: 90, soft: false }, // 右柱
    { id: 2, x: 540, y: 450, w: 200, h: 14, soft: true }, // 中央浮台
    { id: 3, x: 320, y: 390, w: 160, h: 14, soft: true }, // 左高台
    { id: 4, x: 800, y: 390, w: 160, h: 14, soft: true }, // 右高台
  ],
  spawns: [350, 930],
  weaponSpawns: [
    { x: 640, y: 450 }, // 中央浮台
    { x: 380, y: 560 }, // 左柱
    { x: 900, y: 560 }, // 右柱
  ],
}

// ---- 地图2「窄桥」：一条长桥悬在深渊上，侧边出界线更近，鼓励击飞对决 ----
const BRIDGE: StageMap = {
  id: 2,
  name: '窄桥',
  platforms: [
    { id: 0, x: 390, y: 560, w: 500, h: 60, soft: false }, // 长桥
    { id: 1, x: 300, y: 400, w: 170, h: 14, soft: true }, // 左高台
    { id: 2, x: 810, y: 400, w: 170, h: 14, soft: true }, // 右高台
    { id: 3, x: 555, y: 330, w: 170, h: 14, soft: true }, // 中央浮台
  ],
  spawns: [460, 820],
  weaponSpawns: [
    { x: 640, y: 330 }, // 中央浮台
    { x: 500, y: 560 }, // 桥左
    { x: 780, y: 560 }, // 桥右
  ],
  blast: { left: -240, right: 1520, top: -620, bottom: 900 }, // 侧边更近：把人打出去更容易
}

export const MAPS: [StageMap, StageMap, StageMap] = [ISLAND, TWIN_PEAKS, BRIDGE]

export function mapOf(id: 0 | 1 | 2): StageMap {
  return MAPS[id]
}
