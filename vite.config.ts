import { defineConfig } from 'vite'

// base './' makes the build work on any GitHub Pages path (user site or /repo/).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
})
