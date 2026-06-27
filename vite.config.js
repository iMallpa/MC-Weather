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
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => ['modal', 'modal_area', 'modal_title', 'modal_title_area', 'modal_close_btn'].includes(tag),
        },
      },
    }),
  ],
})
