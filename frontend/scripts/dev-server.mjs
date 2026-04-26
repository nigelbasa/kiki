import { createServer } from 'vite';
import { createRwendoViteConfig } from '../vite.shared.js';

const mode = process.argv[2] || 'public';
const force = process.argv.includes('--force');

const config = createRwendoViteConfig(mode);
config.mode = mode;
if (force) {
  config.optimizeDeps = { ...(config.optimizeDeps || {}), force: true };
}

const server = await createServer(config);
await server.listen();

server.printUrls();
console.log(`Rwendo ${mode} dev server ready`);
