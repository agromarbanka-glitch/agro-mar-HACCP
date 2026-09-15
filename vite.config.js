import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Vercel: szybszy build — osobne chunki dla ciężkich bibliotek. */
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs'
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react'
        }
      }
    }
  }
})
