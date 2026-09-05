import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// U盘便携版构建：把全部代码与资源打进一个 HTML 文件
// 产出 dist-usb/OnePG.html，拷进优盘，双击用浏览器打开即玩，免安装免联网
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-usb',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
  },
})
