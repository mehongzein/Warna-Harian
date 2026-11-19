// Test lokal server Warna Harian — TANPA runtime Devvit.
// Menjalankan app Hono asli (src/server/app.ts) lewat adapter honoToNode yang
// sama dengan produksi, dengan Redis palsu (in-memory) + user palsu.
// Jalankan:  npm install  lalu  npm run test:server   (atau: node ./tests/server.test.ts)
import { createServer } from 'node:http';
import { createApp, honoToNode, type RedisLike } from '../src/server/app.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '  OK  ' : ' GAGAL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

/** Redis palsu: cukup untuk endpoint game ini. */
class FakeRedis implements RedisLike {
  private kv = new Map<string, string>();
  private hashes = new Map<string, Record<string, string>>();
  private zsets = new Map<string, Map<string, number>>();

  async get(key: string) {
    return this.kv.get(key);
  }
  async set(key: string, value: string) {
    this.kv.set(key, value);
    return 'OK';
  }
  async expire(_key: string, _seconds: number) {}
  async hGetAll(key: string) {
    return { ...(this.hashes.get(key) ?? {}) };
  }
  async hSet(key: string, fields: Record<string, string>) {
    const h = this.hashes.get(key) ?? {};
    Object.assign(h, fields);
    this.hashes.set(key, h);
    return Object.keys(fields).length;
  }
  async zAdd(key: string, ...members: { member: string; score: number }[]) {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    for (const m of members) z.set(m.member, m.score);
    this.zsets.set(key, z);
    return members.length;
  }
  async zScore(key: string, member: string) {
    return this.zsets.get(key)?.get(member);
  }
  async zRank(key: string, member: string) {
    const rows = await this.zRange(key, 0, -1, { by: 'rank' });
    const i = rows.findIndex((r) => r.member === member);
    return i === -1 ? undefined : i;
  }
  async zRange(key: string, start: number, stop: number, _opts?: { by: 'rank' }) {
    const z = this.zsets.get(key);
    if (!z) return [];
    const rows = [...z.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    const end = stop === -1 ? rows.length : stop + 1;
    return rows.slice(start, end);
  }
  async zCard(key: string) {
    return this.zsets.get(key)?.size ?? 0;
  }
}

const redis = new FakeRedis();

// "Hari ini" menurut server (UTC) — diubah-ubah per fase test.
let serverToday = '2026-11-19';
// User yang sedang login (diubah per fase).
let currentUser: { username?: string; userId?: string } = {
  username: 'sego_megono',
  userId: 't2_testuser1',
};

const app = createApp({
  getUsername: () => currentUser.username,
  getUserId: () => currentUser.userId,
  redis,
  todayUTC: () => serverToday,
});

const server = createServer((req, res) => {
  honoToNode(app, req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end('error');
  });
});

await new Promise<void>((resolve) => server.listen(0, resolve));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

async function get(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
async function post(path: string, body: unknown) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

// ---------- 1. /api/init 19 Nov: target & par harus sama dengan nilai terverifikasi ----------
{
  const { status, body } = await get('/api/init?date=2026-11-19');
  check('init 19 Nov status 200', status === 200, `status=${status}`);
  check('init target #68A3AA', body.targetHex === '#68A3AA', `target=${body.targetHex}`);
  check('init par 3', body.par === 3, `par=${body.par}`);
  check('init username', body.username === 'sego_megono');
  check('init streak awal 0', body.streak === 0);
}

// ---------- 2. Skor valid (Biru+Kuning+Biru) diterima, streak 1, rank 1 ----------
{
  const { status, body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [2, 1, 2],
    elapsedMs: 45000,
  });
  check('skor valid diterima', status === 200 && body.accepted === true, JSON.stringify(body));
  check('streak jadi 1', body.streak === 1, `streak=${body.streak}`);
  check('rank 1', body.rank === 1, `rank=${body.rank}`);
}

// ---------- 3. Anti-cheat: tetes di bawah par ditolak ----------
{
  const { status, body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [2, 1], // 2 tetes < par 3
    elapsedMs: 5000,
  });
  check('tetes < par ditolak (400)', status === 400 && body.accepted === false, JSON.stringify(body));
}

// ---------- 4. Anti-cheat: kecocokan < 96% ditolak ----------
{
  const { status, body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [0, 0, 0], // Merah x3 -> jauh dari target
    elapsedMs: 5000,
  });
  check('match < 96% ditolak (400)', status === 400 && body.accepted === false, JSON.stringify(body));
}

// ---------- 5. Anti-cheat: tanggal di luar jendela ditolak ----------
{
  const { status, body } = await post('/api/score', {
    date: '2026-11-25', // 6 hari dari "hari ini"
    drops: [2, 1, 2],
    elapsedMs: 5000,
  });
  check('tanggal jauh ditolak (400)', status === 400 && body.accepted === false, JSON.stringify(body));
}

// ---------- 6. Skor kedua yang LEBIH BURUK tidak menimpa skor terbaik ----------
// (19 Nov: resep 4+ tetes TERBAIK pun cuma 94% — jadi "lebih buruk" diuji lewat
//  waktu yang lebih lambat dengan resep 3 tetes yang sama.)
{
  const { body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [2, 1, 2],
    elapsedMs: 90000, // lebih lambat dari 45000ms sebelumnya
  });
  check('skor lebih lambat tetap diterima', body.accepted === true, JSON.stringify(body));
  const init = await get('/api/init?date=2026-11-19');
  const myBest = init.body.myBest as { drops: number; timeMs: number; rank: number };
  check(
    'skor terbaik tetap 3 tetes @ 45000ms',
    myBest.drops === 3 && myBest.timeMs === 45000,
    `best=${myBest.drops} tetes, ${myBest.timeMs}ms`,
  );
}

// ---------- 7. User kedua, leaderboard urut tetes lalu waktu ----------
{
  currentUser = { username: 'pemain_kedua', userId: 't2_testuser2' };
  // 19 Nov: resep 4 tetes TERBAIK pun cuma 94% (cek brute-force) — jadi pemain
  // kedua menang dengan resep 3 tetes yang sama tapi WAKTU lebih cepat.
  const { body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [2, 1, 2],
    elapsedMs: 30000,
  });
  check('pemain kedua diterima', body.accepted === true, JSON.stringify(body));
  const lb = await get('/api/leaderboard?date=2026-11-19');
  const rows = lb.body.leaderboard as { username: string; drops: number; timeMs: number }[];
  check(
    'leaderboard urut: tetes sama, waktu lebih cepat dulu',
    rows.length >= 2 &&
      rows[0].username === 'pemain_kedua' &&
      rows[0].drops === 3 &&
      rows[0].timeMs === 30000 &&
      rows[1].username === 'sego_megono',
    JSON.stringify(rows),
  );
}

// ---------- 8. Streak: menang 20 Nov (besok) -> streak 2; lompat sehari -> reset ----------
{
  serverToday = '2026-11-20';
  currentUser = { username: 'sego_megono', userId: 't2_testuser1' };
  const r20 = await post('/api/score', { date: '2026-11-20', drops: [0, 3, 3], elapsedMs: 20000 });
  check('menang 20 Nov diterima', r20.body.accepted === true, JSON.stringify(r20.body));
  check('streak jadi 2', r20.body.streak === 2, `streak=${r20.body.streak}`);

  serverToday = '2026-11-22'; // lompat 21 Nov
  // 22 Nov: target #C0B0C6, par 4, resep Putih+Biru+Merah+Putih = [3,2,0,3].
  const r22 = await post('/api/score', { date: '2026-11-22', drops: [3, 2, 0, 3], elapsedMs: 20000 });
  check('menang 22 Nov diterima', r22.body.accepted === true, JSON.stringify(r22.body));
  check('streak reset jadi 1 setelah putus sehari', r22.body.streak === 1, `streak=${r22.body.streak}`);
}

// ---------- 9. Belum login -> 401 ----------
{
  currentUser = {};
  const { status, body } = await post('/api/score', {
    date: '2026-11-19',
    drops: [2, 1, 2],
    elapsedMs: 5000,
  });
  check('belum login ditolak (401)', status === 401 && body.accepted === false, JSON.stringify(body));
}

server.close();
console.log(failures === 0 ? '\nSEMUA TEST SERVER LOLOS' : `\n${failures} TEST GAGAL`);
process.exit(failures === 0 ? 0 : 1);
