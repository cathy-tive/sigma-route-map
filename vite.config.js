import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Sigma embeds the plugin in an iframe; base:'./' keeps asset URLs relative so
// it works from any host/path (incl. a GitHub Pages subpath).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3001,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
})
