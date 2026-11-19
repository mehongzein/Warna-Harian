import { defineConfig } from 'vite';

// Build server Hono -> dist/server/index.cjs (CJS — wajib untuk runtime Devvit).
//
// PENTING: build sebagai SSR (bukan lib). Lib mode menyelesaikan kondisi
// "browser" dari package exports, sehingga '@devvit/web/server' malah
// ter-resolve ke file panic (serverImportInClientCodePanic.js) yang tidak
// mengekspor createServer/context/redis. SSR mode memakai kondisi Node
// ("default"), jadi ter-resolve ke ./server/index.js yang asli.
//
// Semua dependensi ikut ter-bundle (termasuk @devvit/*) supaya output bisa
// jalan tanpa node_modules — hanya Node built-in yang external. Ini mengikuti
// plugin resmi @devvit/start/vite (resolve.noExternal: true, "Bundle all
// dependencies so the output can run without node_modules"). Jangan
// external-kan @devvit/*: runtime Devvit TIDAK menyediakannya sebagai
// external, sehingga server gagal start ("Cannot find module
// '@devvit/web/server'") saat pertama kali dipanggil (mis. trigger
// onAppInstall saat install).
export default defineConfig({
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: 'src/server/index.ts',
    target: 'node22',
    outDir: 'dist/server',
    emptyOutDir: true,
    minify: false,
    copyPublicDir: false,
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
      },
    },
  },
});
