import { defineConfig } from 'vite';
import { createRwendoViteConfig } from './vite.shared.js';

export default defineConfig(({ mode }) => createRwendoViteConfig(mode));
