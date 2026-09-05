import { defineConfig } from 'vite'

// 网页版构建：产出 dist-web/，部署到 GitHub Pages（zzj2004.github.io/OnePG/）
// base 必须指向子路径，否则静态资源 404；本地 npm run dev 不受影响
export default defineConfig({
  base: '/OnePG/',
  build: { outDir: 'dist-web', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['dist-usb/**', 'dist-web/**'] },
  },
})
