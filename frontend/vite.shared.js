import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export function createRwendoViteConfig(mode = 'public') {
  const isAdmin = mode === 'admin';
  const entryDir = isAdmin ? 'admin' : 'public-portal';
  const port = isAdmin ? 5173 : 5174;

  return {
    plugins: [react()],
    root: resolve(process.cwd(), entryDir),
    publicDir: resolve(process.cwd(), 'public'),
    resolve: {
      alias: {
        '@shared': resolve(process.cwd(), 'shared'),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      outDir: resolve(process.cwd(), `dist/${entryDir}`),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(process.cwd(), entryDir, 'index.html'),
      },
    },
    server: {
      host: '127.0.0.1',
      port,
    },
  };
}
