import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.ANTHROPIC_API_KEY || ''

  return {
    // 빌드 결과는 상대 경로로 — GitHub Pages(https://<id>.github.io/soliskill/) 하위 경로에서도 열리게
    base: command === "build" ? "./" : "/",
    plugins: [react()],
    server: {
      proxy: {
        // 브라우저는 /api/messages 로 호출 → 여기서 Anthropic API로 프록시하며
        // 서버 측에서만 API 키를 주입한다(키가 클라이언트에 노출되지 않음).
        '/api/messages': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          secure: true,
          rewrite: () => '/v1/messages',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('x-api-key', apiKey)
              proxyReq.setHeader('anthropic-version', '2023-06-01')
              // 브라우저 Origin이 넘어가면 Anthropic이 브라우저 직접 호출로 보고 거절한다 — 서버 간 호출로 보이게 제거
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
      },
    },
  }
})
