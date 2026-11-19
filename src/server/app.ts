// Warna Harian — server Hono + Redis (Devvit Web).
// Dipisah dari index.ts supaya logika route bisa diuji lokal tanpa runtime Devvit:
// createApp() menerima `deps` (username/userId + Redis) sehingga test bisa
// menyuntikkan Redis palsu. index.ts hanya memasang deps asli + createServer.

import { Hono } from 'hono';
import {
  BASES,
  MAX_DROPS,
  WIN_THRESHOLD,
  dailyPuzzle,
  hexOf,
  matchPct,
  mixOf,
  todayStr,
  yesterdayStr,
} from '../shared/puzzle.js';
import {
  unzsetScore,
  zsetScore,
  type InitResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type ScoreResponse,
  type ScoreSubmit,
} from '../shared/api.js';

/** Subset Redis yang dipakai game ini (redis asli @devvit/web/server memenuhinya). */
export interface RedisLike {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, options?: { expiration?: Date }): Promise<string>;
  expire(key: string, seconds: number): Promise<void>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fields: Record<string, string>): Promise<number>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zRange(
    key: string,
    start: number,
    stop: number,
    options?: { by: 'rank' },
  ): Promise<{ member: string; score: number }[]>;
  zCard(key: string): Promise<number>;
}

export interface ServerDeps {
  /** Username Reddit yang login (undefined kalau belum login). Dipanggil per-request. */
  getUsername: () => string | undefined;
  /** User ID Reddit yang login (undefined kalau belum login). Dipanggil per-request. */
  getUserId: () => string | undefined;
  redis: RedisLike;
  /**
   * Membuat postingan game (custom post) di subreddit tempat aplikasi dipasang.
   * Hanya tersedia di runtime Devvit — index.ts menyuntikkan implementasi asli
   * lewat reddit.submitCustomPost. Opsional supaya test lokal tetap jalan
   * tanpa runtime Devvit.
   */
  createPost?: () => Promise<{ id: string }>;
  /** Nama subreddit tempat aplikasi dipasang (untuk URL navigasi). */
  getSubredditName?: () => string | undefined;
  /**
   * "Hari ini" menurut server (UTC, "YYYY-MM-DD"), untuk validasi tanggal.
   * Default: tanggal UTC saat ini. Bisa di-override di test.
   */
  todayUTC?: () => string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Tanggal yang diterima: hari ini UTC ± 1 hari (toleransi zona waktu pemain). */
function isAcceptableDate(date: string, todayUTC: string): boolean {
  if (!isRealDate(date)) return false;
  const [y, m, d] = todayUTC.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const day = 24 * 60 * 60 * 1000;
  const ts = Date.parse(date + 'T00:00:00Z');
  return Math.abs(ts - t) <= day;
}

function lbKey(date: string): string {
  return `wh:lb:${date}`;
}

function streakKey(userId: string): string {
  return `wh:streak:${userId}`;
}

/** Leaderboard harian dihapus otomatis 3 hari setelah terakhir ditulis. */
const LB_TTL_SECONDS = 3 * 24 * 60 * 60;

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const todayUTC = deps.todayUTC ?? (() => todayStr(new Date()));

  async function readLeaderboard(
    date: string,
    me: string | undefined,
  ): Promise<LeaderboardEntry[]> {
    const rows = await deps.redis.zRange(lbKey(date), 0, 9, { by: 'rank' });
    return rows.map((r, i) => {
      const { drops, timeMs } = unzsetScore(r.score);
      return { rank: i + 1, username: r.member, drops, timeMs, isMe: me === r.member };
    });
  }

  async function readStreak(userId: string | undefined): Promise<number> {
    if (!userId) return 0;
    const h = await deps.redis.hGetAll(streakKey(userId));
    return h.count ? parseInt(h.count, 10) || 0 : 0;
  }

  // ---------- GET /api/init ----------
  app.get('/api/init', async (c) => {
    const raw = c.req.query('date');
    const date = raw && isRealDate(raw) ? raw : todayUTC();
    if (!isAcceptableDate(date, todayUTC())) {
      return c.json({ error: 'Tanggal tidak valid' }, 400);
    }
    const puzzle = dailyPuzzle(date);
    const username = deps.getUsername();
    const userId = deps.getUserId();
    const leaderboard = await readLeaderboard(date, username);
    const streak = await readStreak(userId);
    let myBest: InitResponse['myBest'] = null;
    if (username) {
      const score = await deps.redis.zScore(lbKey(date), username);
      if (score !== undefined && score !== null) {
        const rank = await deps.redis.zRank(lbKey(date), username);
        const { drops, timeMs } = unzsetScore(score);
        myBest = { drops, timeMs, rank: (rank ?? 0) + 1 };
      }
    }
    const res: InitResponse = {
      date,
      targetHex: hexOf(puzzle.target),
      par: puzzle.par,
      hintFirstDrop: puzzle.recipe[0],
      username: username ?? null,
      streak,
      myBest,
      leaderboard,
    };
    return c.json(res);
  });

  // ---------- GET /api/leaderboard ----------
  app.get('/api/leaderboard', async (c) => {
    const raw = c.req.query('date');
    const date = raw && isRealDate(raw) ? raw : todayUTC();
    if (!isAcceptableDate(date, todayUTC())) {
      return c.json({ error: 'Tanggal tidak valid' }, 400);
    }
    const leaderboard = await readLeaderboard(date, deps.getUsername());
    const res: LeaderboardResponse = { date, leaderboard };
    return c.json(res);
  });

  // ---------- POST /api/score (validasi server-side / anti-cheat) ----------
  app.post('/api/score', async (c) => {
    const username = deps.getUsername();
    const userId = deps.getUserId();
    if (!username || !userId) {
      return c.json({ accepted: false, reason: 'Login dulu ke Reddit untuk menyimpan skor.' }, 401);
    }
    let body: ScoreSubmit;
    try {
      body = (await c.req.json()) as ScoreSubmit;
    } catch {
      return c.json({ accepted: false, reason: 'Body bukan JSON.' }, 400);
    }
    const { date, drops, elapsedMs } = body ?? ({} as ScoreSubmit);

    // 1. Tanggal valid & masih dalam jendela yang diterima.
    if (typeof date !== 'string' || !isAcceptableDate(date, todayUTC())) {
      return c.json({ accepted: false, reason: 'Tanggal tidak valid.' }, 400);
    }
    // 2. Tetes: array index warna dasar, 1..8 tetes.
    if (
      !Array.isArray(drops) ||
      drops.length < 1 ||
      drops.length > MAX_DROPS ||
      drops.some((d) => !Number.isInteger(d) || d < 0 || d >= BASES.length)
    ) {
      return c.json({ accepted: false, reason: 'Tetes tidak valid.' }, 400);
    }
    // 3. Waktu: minimal 500 ms (di bawah itu hampir pasti bukan manusia), maks 24 jam.
    if (!Number.isInteger(elapsedMs) || elapsedMs < 500 || elapsedMs > 24 * 60 * 60 * 1000) {
      return c.json({ accepted: false, reason: 'Waktu tidak valid.' }, 400);
    }

    // 4. Hitung ulang dari server — client tidak dipercaya soal target/par/match.
    const puzzle = dailyPuzzle(date);
    if (drops.length < puzzle.par) {
      return c.json(
        {
          accepted: false,
          reason: `Tetes (${drops.length}) di bawah par hari ini (${puzzle.par}).`,
        },
        400,
      );
    }
    const mix = mixOf(drops);
    const match = mix ? matchPct(mix, puzzle.target) : 0;
    if (match < WIN_THRESHOLD) {
      return c.json(
        { accepted: false, reason: `Kecocokan ${match}% di bawah 96%.` },
        400,
      );
    }

    // 5. Simpan: hanya skor terbaik user hari itu yang disimpan.
    const key = lbKey(date);
    const score = zsetScore(drops.length, elapsedMs);
    const existing = await deps.redis.zScore(key, username);
    if (existing === undefined || existing === null || score < existing) {
      await deps.redis.zAdd(key, { member: username, score });
    }
    await deps.redis.expire(key, LB_TTL_SECONDS);

    // 6. Streak: +1 kalau kemarin juga menang, reset kalau putus, tetap kalau sudah main hari ini.
    const sKey = streakKey(userId);
    const prev = await deps.redis.hGetAll(sKey);
    const prevCount = prev.count ? parseInt(prev.count, 10) || 0 : 0;
    let streak: number;
    if (prev.lastDate === date) {
      streak = prevCount; // sudah dihitung hari ini
    } else if (prev.lastDate === yesterdayStr(date)) {
      streak = prevCount + 1;
    } else {
      streak = 1;
    }
    await deps.redis.hSet(sKey, { lastDate: date, count: String(streak) });

    const rank = (await deps.redis.zRank(key, username)) ?? 0;
    const leaderboard = await readLeaderboard(date, username);
    const res: ScoreResponse = { accepted: true, streak, rank: rank + 1, leaderboard };
    return c.json(res);
  });

  // ---------- POST /internal/menu/post-create ----------
  // Dipanggil Reddit saat moderator memilih menu "Buat postingan Warna Harian"
  // di subreddit. Membuat satu postingan game (custom post) lalu mengarahkan
  // moderator ke postingan itu. Tanpa menu ini, tidak ada cara membuat
  // postingan game dari Reddit — inilah yang selama ini hilang.
  app.post('/internal/menu/post-create', async (c) => {
    if (!deps.createPost) {
      return c.json({ showToast: 'Pembuatan postingan tidak tersedia.' }, 500);
    }
    try {
      const post = await deps.createPost();
      const sub = deps.getSubredditName?.() ?? '';
      return c.json(
        { navigateTo: `https://reddit.com/r/${sub}/comments/${post.id}` },
        200,
      );
    } catch (err) {
      console.error(
        `[warna-harian] gagal membuat postingan: ${err instanceof Error ? err.stack : err}`,
      );
      return c.json({ showToast: 'Gagal membuat postingan' }, 400);
    }
  });

  // ---------- POST /internal/triggers/on-app-install ----------
  // Dipanggil Reddit saat aplikasi dipasang di sebuah subreddit: otomatis
  // membuat satu postingan game pertama di subreddit itu.
  app.post('/internal/triggers/on-app-install', async (c) => {
    if (!deps.createPost) {
      return c.json({ status: 'error', message: 'Pembuatan postingan tidak tersedia.' }, 500);
    }
    try {
      const post = await deps.createPost();
      const sub = deps.getSubredditName?.() ?? '';
      return c.json(
        { status: 'success', message: `Post created in subreddit ${sub} with id ${post.id}` },
        200,
      );
    } catch (err) {
      console.error(
        `[warna-harian] gagal membuat postingan: ${err instanceof Error ? err.stack : err}`,
      );
      return c.json({ status: 'error', message: 'Failed to create post' }, 400);
    }
  });

  return app;
}

/**
 * Jembatan Hono (fetch handler) -> listener Node http (req, res) yang dipakai
 * `createServer` dari @devvit/web/server. Devvit mengharuskan server dibuat
 * lewat createServer (di dalamnya context per-request di-inject), jadi Hono
 * tidak bisa dipasang langsung — adapter ini yang menerjemahkannya.
 */
export async function honoToNode(
  app: Hono,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else headers.append(name, value);
  }
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    // Uint8Array.from() menghasilkan Uint8Array<ArrayBuffer> yang diterima BodyInit
    // (Buffer mentah ditolak tipe DOM di @types/node terbaru).
    body: body && body.length > 0 ? Uint8Array.from(body) : undefined,
  });
  const response = await app.fetch(request);
  const bodyBuffer = Buffer.from(await response.arrayBuffer());
  const resHeaders: Record<string, string> = {};
  for (const [name, value] of response.headers.entries()) {
    resHeaders[name] = value;
  }
  // Set Content-Length secara eksplisit dari panjang body yang sebenarnya.
  // Tanpa ini, respons bisa terkirim dengan header Content-Length "null"
  // sementara body-nya tidak kosong — runtime Devvit menolaknya dan trigger
  // onAppInstall gagal ("server responded with Content-Length header "null"
  // but greater than zero required for nonempty response").
  resHeaders['content-length'] = String(bodyBuffer.length);
  res.writeHead(response.status, resHeaders);
  res.end(bodyBuffer);
}
