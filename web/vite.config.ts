import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [react(), {
    name: 'serve-final-deployment-in-development',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/imd-deployment.json') return next();
        try {
          res.setHeader('Content-Type', 'application/json');
          res.end(await readFile(new URL('../dist/imd-deployment.json', import.meta.url)));
        } catch { res.statusCode = 503; res.end('Run npm run build first.'); }
      });
    },
  }],
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
