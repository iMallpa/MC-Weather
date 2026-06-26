import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/MC-Weather/' : '/',
  resolve: {
    dedupe: ['vue'],
  },
  optimizeDeps: {
    exclude: ['mcui-oreui'],
  },
  plugins: [vue()],
})
