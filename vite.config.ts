import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseOrigin = (env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/$/, '')
  return {
    plugins: [react()],
    server: {
      // Align with Supabase Auth "Site URL" when set to http://localhost:3000 (common default).
      // If you use 5173 in the Supabase dashboard instead, you can remove this line.
      port: 3000,
      strictPort: false,
      proxy: {
        '/api/resend-webhook': {
          target: supabaseOrigin,
          changeOrigin: true,
          rewrite: () => '/functions/v1/resend-webhook',
        },
        '/bff/functions': {
          target: supabaseOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bff\/functions/, '/functions/v1'),
        },
      },
    },
  }
})
