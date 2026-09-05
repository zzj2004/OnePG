import { defineConfig } from 'vite'

// 网页版构建：产出 dist-web/，可直接部署到 GitHub Pages
export default defineConfig({
  build: { outDir: 'dist-web', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['dist-usb/**', 'dist-web/**'] },
  },
})
