// Warna Harian — logika puzzle murni (dipakai client + server).
// PORT PERSIS dari prototipe v1 yang sudah terverifikasi (warna-harian-prototype.html).
// JANGAN ubah rumus: seed, pencampuran, dan ambang kemenangan harus identik,
// supaya puzzle tanggal yang sama selalu menghasilkan target & par yang sama.

export type Rgb = [number, number, number];

export interface BaseColor {
  name: string;
  hex: string;
  rgb: Rgb;
}

export const BASES: BaseColor[] = [
  { name: 'Merah', hex: '#E53935', rgb: [229, 57, 53] },
  { name: 'Kuning', hex: '#FDD835', rgb: [253, 216, 53] },
  { name: 'Biru', hex: '#1E88E5', rgb: [30, 136, 229] },
  { name: 'Putih', hex: '#FFFFFF', rgb: [255, 255, 255] },
  { name: 'Hitam', hex: '#212121', rgb: [33, 33, 33] },
];

/** Ambang kemenangan: kecocokan >= 96% (jarak Euclidean dibagi 442). */
export const WIN_THRESHOLD = 96;
/** Batas tetes per permainan. */
export const MAX_DROPS = 8;

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "2026-11-19" -> seed int. */
export function dateSeed(d: string): number {
  const p = d.split('-');
  return +p[0] * 372 + +p[1] * 31 + +p[2];
}

/** Campuran = rata-rata semua tetes (dibulatkan per channel). */
export function mixOf(drops: number[]): Rgb | null {
  if (!drops.length) return null;
  const s: [number, number, number] = [0, 0, 0];
  drops.forEach((i) => {
    for (let c = 0; c < 3; c++) s[c] += BASES[i].rgb[c];
  });
  return s.map((v) => Math.round(v / drops.length)) as Rgb;
}

export function dist(a: Rgb, b: Rgb): number {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) * (v - b[i]), 0));
}

/** Kecocokan 0-100%. 442 = jarak maksimum antar dua warna RGB. */
export function matchPct(mix: Rgb, target: Rgb): number {
  return Math.max(0, Math.round(100 * (1 - dist(mix, target) / 442)));
}

export function hexOf(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Cari resep terpendek (<= maxDrops tetes) yang mencapai >= 96%. */
export function bestRecipe(target: Rgb, maxDrops: number): number[] | null {
  let best: number[] | null = null;
  function search(drops: number[]): void {
    if (drops.length > 0) {
      const m = mixOf(drops);
      const p = m ? matchPct(m, target) : 0;
      if (p >= WIN_THRESHOLD && (!best || drops.length < best.length)) best = drops.slice();
    }
    if (drops.length >= maxDrops) return;
    if (best && drops.length + 1 >= best.length) return;
    for (let i = 0; i < BASES.length; i++) {
      drops.push(i);
      search(drops);
      drops.pop();
    }
  }
  search([]);
  return best;
}

export interface DailyPuzzle {
  /** Target sebagai RGB. */
  target: Rgb;
  /** Par = panjang resep terpendek (3-5 tetes). */
  par: number;
  /** Satu resep yang mencapai target (dipakai server untuk validasi & hint tetes pertama). */
  recipe: number[];
}

/** Puzzle harian deterministik dari tanggal "YYYY-MM-DD". */
export function dailyPuzzle(dateStr: string): DailyPuzzle {
  const rnd = mulberry32(dateSeed(dateStr));
  for (let attempt = 0; attempt < 200; attempt++) {
    const len = 3 + Math.floor(rnd() * 3); // 3..5 tetes
    const recipe: number[] = [];
    for (let k = 0; k < len; k++) recipe.push(Math.floor(rnd() * BASES.length));
    const target = mixOf(recipe)!;
    const shortest = bestRecipe(target, len); // harus sepanjang resep aslinya
    if (shortest && shortest.length === len) return { target, par: len, recipe };
  }
  return { target: [128, 128, 128], par: 3, recipe: [0, 1, 2] };
}

/** Tanggal hari ini (waktu lokal perangkat) sebagai "YYYY-MM-DD". */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tanggal kemarin dari sebuah "YYYY-MM-DD" (untuk hitung streak). */
export function yesterdayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** Format Indonesia: "19 November 2026". */
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function formatTanggalId(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}
