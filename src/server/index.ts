// Warna Harian — entry server Devvit Web.
// Logika ada di app.ts; file ini hanya memasang deps asli (@devvit/web/server)
// dan menjalankan server lewat createServer (wajib: di dalamnya context
// per-request di-inject sehingga `context.username`/`redis` bekerja).

import { createServer, context, getServerPort, redis, reddit } from '@devvit/web/server';
import { createApp, honoToNode } from './app.js';

const app = createApp({
  getUsername: () => context.username,
  getUserId: () => context.userId,
  redis,
  createPost: () =>
    reddit.submitCustomPost({ title: 'Warna Harian 🎨 — Teka-teki Campur Warna Harian' }),
  getSubredditName: () => context.subredditName,
});

const server = createServer((req, res) => {
  honoToNode(app, req, res).catch((err: unknown) => {
    console.error(`[warna-harian] request error: ${err instanceof Error ? err.stack : err}`);
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    } catch {
      /* koneksi sudah tertutup */
    }
  });
});

server.on('error', (err) => console.error(`[warna-harian] server error: ${err.stack}`));

const port = getServerPort();
server.listen(port, () => console.log(`[warna-harian] listening on http://localhost:${port}`));
