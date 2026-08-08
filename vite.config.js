import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, but the dev server serves
// from /. Keying off `command` rather than an env var means every build — local,
// PR CI, and deploy — produces the same asset paths, so what CI checked is what
// ships.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/neon-runner/' : '/',
  define: {
    __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'),
  },
  server: { port: 5173, strictPort: true },
}));
