import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseOrigin = (env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/$/, '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/resend-webhook': {
          target: supabaseOrigin,
          changeOrigin: true,
          rewrite: () => '/functions/v1/resend-webhook',
        },
      },
    },
  }
})
