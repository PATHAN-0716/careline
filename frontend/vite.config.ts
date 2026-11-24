import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwind()],
  optimizeDeps: {
    include: ['@pipecat-ai/client-js', '@pipecat-ai/small-webrtc-transport'],
  },
  server: { host: 'localhost', proxy: { '/api': 'http://127.0.0.1:8000' } },
})
