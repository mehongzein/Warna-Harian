import { defineConfig } from 'vite';

// Build server Hono -> dist/server/index.cjs (CJS — wajib untuk runtime Devvit).
// @devvit/* tetap external (disediakan runtime); hono ikut ter-bundle.
export default defineConfig({
  build: {
    outDir: 'dist/server',
    emptyOutDir: true,
    lib: {
      entry: 'src/server/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: [/^@devvit\//, /^node:/],
    },
  },
});
