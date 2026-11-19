// Warna Harian — tipe API yang dipakai client + server (satu sumber kebenaran).

export interface InitResponse {
  /** Tanggal puzzle hari ini (YYYY-MM-DD, dari jam perangkat client). */
  date: string;
  /** Target hari ini sebagai hex, mis. "#68A3AA". */
  targetHex: string;
  /** Par hari ini (3-5 tetes). */
  par: number;
  /** Index warna dasar pada tetes pertama resep (untuk tombol "Coba contoh"). */
  hintFirstDrop: number;
  /** Username Reddit yang login (null kalau belum login). */
  username: string | null;
  /** Streak harian user yang login (0 kalau belum login / belum pernah menang). */
  streak: number;
  /** Skor terbaik user hari ini (null kalau belum menang hari ini). */
  myBest: { drops: number; timeMs: number; rank: number } | null;
  /** Leaderboard hari ini (top 10). */
  leaderboard: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  drops: number;
  /** Waktu dari tetes pertama sampai menang, dalam milidetik. */
  timeMs: number;
  /** true kalau baris ini milik user yang sedang login. */
  isMe: boolean;
}

export interface ScoreSubmit {
  /** Tanggal puzzle yang dimainkan (YYYY-MM-DD). */
  date: string;
  /** Urutan tetes yang dipakai, sebagai index warna dasar (0-4). */
  drops: number[];
  /** Waktu dari tetes pertama sampai menang, dalam milidetik. */
  elapsedMs: number;
}

export interface ScoreResponse {
  accepted: boolean;
  /** Alasan penolakan (kalau accepted = false). */
  reason?: string;
  /** Streak harian user setelah skor ini dicatat. */
  streak: number;
  /** Peringkat user hari ini setelah skor ini dicatat. */
  rank: number;
  /** Leaderboard hari ini (top 10) setelah skor ini dicatat. */
  leaderboard: LeaderboardEntry[];
}

export interface LeaderboardResponse {
  date: string;
  leaderboard: LeaderboardEntry[];
}

/** Skor zset Redis: tetes lebih sedikit menang; seri diputus waktu lebih cepat. */
export function zsetScore(drops: number, timeMs: number): number {
  return drops * 1_000_000 + Math.min(Math.max(timeMs, 0), 999_999);
}

export function unzsetScore(score: number): { drops: number; timeMs: number } {
  return { drops: Math.floor(score / 1_000_000), timeMs: score % 1_000_000 };
}
