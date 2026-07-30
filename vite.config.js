import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// Build stamp shown in the corner of the plugin so you can confirm which code a
// Sigma workbook actually loaded. NOT a URL version — the plugin URL never changes.
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'local' } })()
const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
process.env.VITE_BUILD_STAMP = `${now}Z · ${sha}`
if (process.env.HARNESS) process.env.VITE_HARNESS = '1'
import react from '@vitejs/plugin-react'

// Sigma embeds the plugin in an iframe; base:'./' keeps asset URLs relative so
// it works from any host/path (incl. a GitHub Pages subpath).
export default defineConfig({
  base: './',
  plugins: [react()],
  // HARNESS=1 swaps in a mock of the Sigma plugin API so the real data path can be
  // exercised locally (?demo=1 bypasses it and hides data-path bugs).
  resolve: process.env.HARNESS ? { alias: { '@sigmacomputing/plugin': new URL('./src/__harness__/mockPlugin.js', import.meta.url).pathname } } : {},
  server: {
    port: 3001,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
})
