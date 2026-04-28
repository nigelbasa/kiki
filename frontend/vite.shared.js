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
      // Bind on the literal hostname `localhost` so the dev server banner
      // prints `http://localhost:<port>/`. The API base in
      // shared/api/client.js targets `http://localhost:8000`, and browser
      // cookies are scoped per host — opening the dev server on
      // `http://127.0.0.1:<port>/` causes the session cookie to be set on
      // `localhost` but the page to be served from `127.0.0.1`, which some
      // browsers treat as cross-host and silently drop the cookie on
      // subsequent fetches, producing 401s on every guarded route.
      host: 'localhost',
      port,
    },
  };
}
