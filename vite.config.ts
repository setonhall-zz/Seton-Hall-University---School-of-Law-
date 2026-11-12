import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: the whole island ships as one self-contained index.html.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
