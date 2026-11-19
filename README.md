# Warna Harian — Devvit Web (Reddit Game of the Day Hackathon)

Teka-teki campur warna harian. Setiap hari ada satu warna target (dari seed
tanggal); pemain mencampur 5 warna dasar untuk mencocokkannya dengan tetes
sesedikit mungkin. Menang kalau kecocokan ≥ 96%.

- **Stack:** React 19 + Tailwind CSS 4 (client), Hono + Redis (server),
  `@devvit/web` 0.15.4 — struktur sama seperti Arus Harian.
- **Bahasa UI:** Indonesia. **Deadline hackathon:** 9 Des 2026 09:00 WIB.
- **Versi tes HP (tanpa Reddit):** `../warna-harian-v2.html` — satu file HTML
  mandiri, tanggal dari jam HP, streak & skor terbaik di localStorage.

## Struktur

```
warna-harian-devvit/
├── devvit.json                 # post entrypoint (inline) + server entry
├── package.json
├── vite.config.ts              # build client -> dist/client (ESM)
├── vite.server.config.ts       # build server -> dist/server/index.cjs (CJS)
├── tsconfig.json               # typecheck server + shared + tests
├── tsconfig.client.json        # typecheck client (kondisi "browser")
├── src/
│   ├── shared/
│   │   ├── puzzle.ts           # LOGIKA MURNI — rumus terverifikasi, jangan diubah
│   │   └── api.ts              # tipe API client <-> server + skor zset
│   ├── client/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── index.css           # Tailwind 4 + animasi denyut hint
│   │   └── App.tsx             # UI game + tutorial overlay 3 langkah
│   └── server/
│       ├── app.ts              # Hono app + validasi anti-cheat + adapter Node
│       └── index.ts            # wiring @devvit/web/server (createServer)
├── tests/
│   └── server.test.ts          # test route Hono (Redis palsu) — `npm run test:server`
├── README.md                   # file ini
└── DEVPOST.md                  # draf deskripsi Inggris + checklist submit
```

## Logika puzzle (terverifikasi — jangan diubah rumusnya)

- 5 warna dasar: Merah `#E53935`, Kuning `#FDD835`, Biru `#1E88E5`,
  Putih `#FFFFFF`, Hitam `#212121`.
- Target harian dari seed tanggal (`mulberry32` + `dateSeed`).
  Campuran = rata-rata semua tetes. Kecocokan = `100 * (1 - jarakEuclidean/442)`.
  Menang kalau ≥ 96%. Maks 8 tetes. Par = resep terpendek (3–5 tetes).
- Nilai terverifikasi (`npm run test:server` + `node` langsung di
  `src/shared/puzzle.ts`):
  - 19 Nov 2026 → target `#68A3AA`, par 3, resep Biru+Kuning+Biru
  - 20 Nov 2026 → target `#F6BDBC`, par 3
  - 21 Nov 2026 → target `#AB8870`, par 3

## Cara upload ke Reddit (langkah demi langkah)

> Butuh: Node.js 22+, akun Reddit, dan login Devvit CLI. Semua perintah di
> bawah dijalankan dari folder ini, di laptop/komputer (bukan dari HP).

### 1. Pasang CLI & login (sekali saja)

```bash
npm install -g @devvit/cli
devvit login
# ikuti alur OAuth di browser — hubungkan akun Reddit kamu (mehongzein)
```

### 2. Siapkan proyek

**Opsi A (disarankan):** scaffold template resmi dulu, lalu timpa `src/`-nya
dengan file di sini — CLI akan membuatkan `devvit.json` yang benar untuk
versi CLI yang terpasang. Kalau `devvit.json` hasil scaffold berbeda dengan
yang ada di sini, **pakai yang hasil scaffold**.

```bash
npx create devvit@latest --template=react warna-harian
cd warna-harian
# salin isi folder warna-harian-devvit/src ke sini (timpa src/)
# salin juga vite.config.ts, vite.server.config.ts, tsconfig*.json, package.json
```

**Opsi B:** pakai folder ini langsung sebagai proyek (`devvit.json` sudah ada).

### 3. Install dependensi & verifikasi lokal

```bash
npm install
npm run typecheck     # tsc server + client
npm run test:server   # test route Hono (20 cek: init, skor valid, anti-cheat, streak, leaderboard)
npm run build         # hasil: dist/client + dist/server/index.cjs
```

### 4. Playtest di subreddit tes

```bash
npm run playtest
# atau: npx devvit playtest
# CLI membuat subreddit tes otomatis (mis. r/warna-harian_dev) dan memberi URL
# seperti reddit.com/r/warna-harian_dev/?playtest=warna-harian
```

Buka URL itu di HP (login akun Reddit yang sama) dan mainkan:
- Tutorial 3 langkah muncul di kunjungan pertama; tombol **"✨ Coba contoh"**
  menyorot ketukan pertama yang benar.
- Menang → skor tersimpan → streak + leaderboard muncul.
- Coba juga: main tanpa login (skor tidak tersimpan, game tetap jalan).

### 5. Upload & update

```bash
npm run deploy        # = npm run build && devvit upload
```

**PENTING:** upload TIDAK otomatis meng-update subreddit yang sudah
terpasang. Setiap selesai upload, buka
**developers.reddit.com/apps/warna-harian** lalu klik tombol biru **"Update"**
di bawah "My Installations". Kalau tidak, subreddit tes tetap menjalankan
versi lama.

### 6. Buat subreddit & postingan harian (demo post)

1. Buat subreddit baru, mis. **r/warna_harian** (atau pakai subreddit yang
   sudah ada).
2. Publish & install aplikasinya ke subreddit itu:
   ```bash
   npx devvit publish --bump minor   # kirim untuk review Reddit
   npx devvit install r/warna_harian # setelah disetujui
   ```
3. Di subreddit, buat post baru dan pilih aplikasi **Warna Harian** sebagai
   tipe post (custom post). Post ini adalah **demo post** untuk Devpost —
   salin link-nya.
4. (Opsional, disarankan) Buat post harian baru setiap pagi supaya tiap hari
   ada post segar untuk dimainkan.

### 7. Submit ke Devpost — lihat `DEVPOST.md`

Checklist: app listing link + demo post link + deskripsi Inggris + 3–5
screenshot + video 30–60 detik. **Jangan submit app untuk publishing**
sampai hackathon selesai (aturan hackathon: upload/playtest saja).

## API server

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/init?date=YYYY-MM-DD` | Puzzle hari itu (target, par, hint tetes pertama) + streak + leaderboard + skor terbaikmu |
| GET | `/api/leaderboard?date=YYYY-MM-DD` | Top 10 hari itu |
| POST | `/api/score` | `{ date, drops, elapsedMs }` — divalidasi server-side |

**Anti-cheat (server-side, di `src/server/app.ts`):**

- Tanggal harus valid dan dalam jendela hari ini (UTC) ± 1 hari.
- `drops` 1–8 tetes, tiap tetes index warna 0–4.
- `drops.length` harus ≥ par hari itu — skor di bawah par **ditolak**.
- Kecocokan dihitung ulang server dari `drops` vs target — di bawah 96% **ditolak**.
- `elapsedMs` minimal 500 ms, maks 24 jam.
- Harus login Reddit (username dari `context`, bukan dari client).
- Hanya skor terbaik user hari itu yang disimpan.

**Redis keys:**

- `wh:lb:<YYYY-MM-DD>` — sorted set leaderboard; skor = `tetes * 1.000.000 + waktu_ms`
  (tetes lebih sedikit menang, seri diputus waktu lebih cepat); TTL 3 hari.
- `wh:streak:<userId>` — hash `{ lastDate, count }`.

## Tutorial (dibuat karena user sempat bingung cara main di prototipe v1)

- Overlay 3 langkah saat pertama kali main:
  1. "Lihat warna target" — contoh kotak warna target hari itu.
  2. "Ketuk warna untuk tambah 1 tetes" — contoh tombol palet.
  3. "Cocokkan sampai ≥ 96%" — contoh meter kecocokan.
- Tombol **"Coba contoh"** menutup tutorial dan **menyorot (denyut hijau)
  tombol warna yang benar untuk ketukan pertama** hari itu.
- Tombol **"❓ Cara main"** membuka lagi tutorial kapan saja.
- Urutan tetes yang sudah dicampur selalu terlihat di bawah kotak warna
  ("Biru → Kuning → …"), supaya pemain tidak lupa campurannya.

## Yang belum bisa diverifikasi di sini (jujur)

- **Upload/playtest di Reddit asli** — butuh login Reddit + `devvit login`,
  tidak bisa dilakukan dari lingkungan ini. Playtest adalah langkah yang
  wajib dicoba sebelum submit.
- **`devvit.json` hasil scaffold CLI** — file di sini mengikuti contoh resmi
  di docs Devvit v0.14 (`post.dir`/`entrypoints` + `server.dir`/`entry`),
  tapi belum dibandingkan dengan hasil `npm create devvit@latest` yang
  sebenarnya. Kalau berbeda, pakai yang hasil scaffold.
- **Adapter Hono → `createServer`** (`honoToNode` di `src/server/app.ts`) —
  sudah diuji lokal lewat HTTP biasa + smoke test bundle produksi
  (`dist/server/index.cjs` boot & melayani `/api/init` + `/api/score` dengan
  stub `@devvit/web/server`), tapi belum diuji di dalam runtime Devvit
  yang sebenarnya. Kalau playtest menunjukkan server tidak merespons,
  periksa log dengan `npx devvit logs r/<subreddit-tes>`.
- **Tampilan di aplikasi Reddit iOS/Android** — prototipe v2 sudah dites
  logikanya, tapi tampilan akhir (ukuran webview inline, scroll) hanya
  bisa dipastikan lewat playtest di HP.
