import { useEffect, useMemo, useRef, useState } from 'react';
import { showShareSheet, showToast } from '@devvit/web/client';
import {
  BASES,
  MAX_DROPS,
  WIN_THRESHOLD,
  dailyPuzzle,
  formatTanggalId,
  hexOf,
  matchPct,
  mixOf,
  todayStr,
} from '../shared/puzzle.js';
import type {
  InitResponse,
  LeaderboardEntry,
  ScoreResponse,
} from '../shared/api.js';

const TUTORIAL_KEY = 'wh-tutorial-seen-v1';

function formatTime(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} dtk`;
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const TUTORIAL_STEPS = [
  {
    title: '1. Lihat warna target',
    body: 'Setiap hari ada satu warna target. Tugasmu: bikin campuran yang warnanya sama persis dengan target itu.',
    art: 'target' as const,
  },
  {
    title: '2. Ketuk warna untuk tambah 1 tetes',
    body: 'Setiap ketuk = 1 tetes masuk ke campuranmu. Campuran adalah rata-rata semua tetes — misal Biru + Kuning = hijau kebiruan.',
    art: 'palette' as const,
  },
  {
    title: '3. Cocokkan sampai ≥ 96%',
    body: 'Meter di bawah nunjukin kecocokanmu. Menang kalau ≥ 96% — makin sedikit tetes, makin bagus. Par = jumlah tetes minimum hari itu.',
    art: 'meter' as const,
  },
];

export default function App() {
  const [date] = useState(() => todayStr());
  const [init, setInit] = useState<InitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [drops, setDrops] = useState<number[]>([]);
  const [won, setWon] = useState(false);
  const [showWinCard, setShowWinCard] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [hintPulse, setHintPulse] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [scoreState, setScoreState] = useState<'idle' | 'sending' | 'saved' | 'logged-out' | 'failed'>('idle');
  const [copied, setCopied] = useState(false);
  const submittedRef = useRef(false);

  // Puzzle lokal (rumus sama persis dengan server) — dipakai untuk hitung
  // kecocokan instan & sebagai fallback kalau /api/init tidak terjangkau.
  const localPuzzle = useMemo(() => dailyPuzzle(date), [date]);
  const par = init?.par ?? localPuzzle.par;
  const targetHex = init?.targetHex ?? hexOf(localPuzzle.target);
  const targetRgb = useMemo(() => hexToRgb(targetHex), [targetHex]);

  const mix = useMemo(() => mixOf(drops), [drops]);
  const match = mix ? matchPct(mix, targetRgb) : 0;

  // ---------- Muat state awal dari server ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/init?date=${date}`);
        if (!res.ok) throw new Error(`init ${res.status}`);
        const data = (await res.json()) as InitResponse;
        if (cancelled) return;
        setInit(data);
        setStreak(data.streak);
        setLeaderboard(data.leaderboard);
        if (data.myBest) setMyRank(data.myBest.rank);
      } catch {
        if (!cancelled) setOffline(true); // tetap bisa main offline
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // ---------- Tutorial: tampil pertama kali main ----------
  useEffect(() => {
    try {
      if (!localStorage.getItem(TUTORIAL_KEY)) {
        setShowTutorial(true);
      }
    } catch {
      setShowTutorial(true);
    }
  }, []);

  function closeTutorial() {
    setShowTutorial(false);
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      /* abaikan */
    }
  }

  /** "Coba contoh": tutup tutorial, sorot ketukan pertama yang benar. */
  function tryExample() {
    const first = init?.hintFirstDrop ?? localPuzzle.recipe[0];
    closeTutorial();
    setHintPulse(first);
    window.setTimeout(() => setHintPulse((cur) => (cur === first ? null : cur)), 6000);
  }

  // ---------- Aksi main ----------
  function addDrop(i: number) {
    if (won || drops.length >= MAX_DROPS) return;
    if (startTime === null) setStartTime(Date.now());
    if (hintPulse === i) setHintPulse(null);
    setDrops((prev) => [...prev, i]);
  }

  function undoDrop() {
    if (won) return;
    setDrops((prev) => prev.slice(0, -1));
  }

  function resetGame() {
    setDrops([]);
    setWon(false);
    setShowWinCard(false);
    setStartTime(null);
    setElapsedMs(null);
    setScoreState('idle');
    submittedRef.current = false;
  }

  // ---------- Menang: kirim skor ke server ----------
  useEffect(() => {
    if (!won || submittedRef.current) return;
    if (!mix || match < WIN_THRESHOLD) return;
    submittedRef.current = true;
    const ms = startTime !== null ? Date.now() - startTime : 0;
    setElapsedMs(ms);
    if (offline || !init) {
      setScoreState('logged-out');
      return;
    }
    setScoreState('sending');
    (async () => {
      try {
        const res = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, drops, elapsedMs: ms }),
        });
        const data = (await res.json()) as ScoreResponse;
        if (res.status === 401 || !data.accepted) {
          setScoreState('logged-out');
          return;
        }
        setStreak(data.streak);
        setMyRank(data.rank);
        setLeaderboard(data.leaderboard);
        setScoreState('saved');
      } catch {
        setScoreState('failed');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [won, match]);

  // Deteksi menang saat kecocokan mencapai ambang.
  useEffect(() => {
    if (!won && mix && match >= WIN_THRESHOLD) {
      setWon(true);
      setShowWinCard(true);
    }
  }, [match, mix, won]);

  const verdict =
    drops.length <= par
      ? 'Pas par! 🏆'
      : drops.length === par + 1
        ? 'Hampir par — 1 tetes lagi.'
        : 'Menang, tapi di atas par.';

  const scoreText =
    `🎨 Warna Harian — ${formatTanggalId(date)} · ` +
    `✅ Menang dalam ${drops.length} tetes (par ${par}) · ` +
    `⏱ ${elapsedMs !== null ? formatTime(elapsedMs) : '—'} · ` +
    `🔥 Streak: ${streak} hari` +
    (myRank ? ` · 🏆 Peringkat hari ini: #${myRank}` : '');

  async function copyScore() {
    try {
      await navigator.clipboard.writeText(scoreText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = scoreText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    showToast('Skor disalin ✓');
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function shareScore() {
    try {
      await showShareSheet({ title: 'Warna Harian', text: scoreText });
    } catch {
      await copyScore();
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[420px] w-full max-w-[420px] items-center justify-center px-4">
        <p className="text-sm text-neutral-500">Memuat warna hari ini…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 pb-8 pt-4" style={{ background: '#f6f1e7' }}>
      <h1 className="text-center text-[22px] font-bold text-neutral-800">🎨 Warna Harian</h1>
      <p className="mb-1 text-center text-[13px] text-neutral-500">
        Teka-teki campur warna harian · {formatTanggalId(date)}
      </p>
      <p className="mb-3 text-center text-[13px] font-semibold text-neutral-700">
        🔥 Streak: {streak} hari
        {init?.username ? ` · u/${init.username}` : ' · belum login'}
      </p>

      {/* Target vs campuran */}
      <div className="flex gap-3">
        <div className="flex-1 rounded-2xl bg-white p-2.5 text-center shadow-sm">
          <div className="mb-1.5 text-xs text-neutral-500">🎯 Warna target</div>
          <div className="h-[44px] rounded-[10px] border border-black/10" style={{ background: targetHex }} />
          <div className="mt-1.5 font-mono text-[13px]">{targetHex}</div>
        </div>
        <div className="flex-1 rounded-2xl bg-white p-2.5 text-center shadow-sm">
          <div className="mb-1.5 text-xs text-neutral-500">🧪 Campuranmu</div>
          <div
            className="h-[44px] rounded-[10px] border border-black/10"
            style={{ background: mix ? hexOf(mix) : '#ffffff' }}
          />
          <div className="mt-1.5 font-mono text-[13px]">{mix ? hexOf(mix) : '— belum ada tetes —'}</div>
        </div>
      </div>

      {/* Urutan tetes (supaya pemain selalu tahu apa yang sudah dicampur) */}
      <div className="mt-2 min-h-[22px] text-center text-xs text-neutral-600">
        {drops.length === 0
          ? 'Ketuk warna di bawah untuk menambah 1 tetes.'
          : drops.map((d, i) => (
              <span key={i}>
                <span className="font-semibold" style={{ color: BASES[d].hex === '#FFFFFF' ? '#666' : BASES[d].hex }}>
                  {BASES[d].name}
                </span>
                {i < drops.length - 1 ? ' → ' : ''}
              </span>
            ))}
      </div>

      {/* Meter kecocokan */}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e5e0d3]">
        <div className="h-full bg-[#2e9e5b] transition-all" style={{ width: `${match}%` }} />
      </div>
      <div className="mt-1.5 text-[13px] font-semibold text-neutral-700">
        Kecocokan: {match}% · {drops.length} tetes · par {par} · butuh ≥ 96% untuk menang
      </div>

      {/* Palet */}
      <div className="mt-3 grid grid-cols-5 gap-2">
        {BASES.map((b, i) => (
          <button
            key={b.name}
            type="button"
            onClick={() => addDrop(i)}
            disabled={won || drops.length >= MAX_DROPS}
            className={`rounded-xl py-2.5 text-[13px] font-bold shadow-[0_2px_0_rgba(0,0,0,0.18)] active:translate-y-[2px] active:shadow-none disabled:opacity-50 ${
              hintPulse === i ? 'wh-hint-pulse' : ''
            }`}
            style={{
              background: b.hex,
              color: b.name === 'Kuning' || b.name === 'Putih' ? '#333' : '#fff',
            }}
          >
            {b.name}
            <span className="block text-[10px] font-normal opacity-85">+1 tetes</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={undoDrop}
          disabled={won || drops.length === 0}
          className="flex-1 rounded-[10px] border border-neutral-300 bg-white py-2.5 text-sm disabled:opacity-50"
        >
          ↩️ Batalkan tetes
        </button>
        <button
          type="button"
          onClick={resetGame}
          className="flex-1 rounded-[10px] border border-neutral-300 bg-white py-2.5 text-sm"
        >
          🔄 Ulangi
        </button>
        <button
          type="button"
          onClick={() => {
            setTutorialStep(0);
            setShowTutorial(true);
          }}
          className="rounded-[10px] border border-neutral-300 bg-white px-3 py-2.5 text-sm"
          aria-label="Cara main"
        >
          ❓ Cara main
        </button>
      </div>

      {/* Kartu menang — OVERLAY (fixed), bukan di alur dokumen: supaya selalu
          terlihat saat menang dan tidak menambah tinggi halaman (webview Reddit
          tidak bisa di-scroll, jadi konten inline di bawah lipatan tidak
          terjangkau). */}
      {won && showWinCard && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="wh-pop w-full max-w-[420px] rounded-2xl border-2 border-[#2e9e5b] bg-[#e8f7ee] p-3.5 text-center shadow-xl">
            <h2 className="text-[19px] font-bold">🎉 Menang!</h2>
            <p className="mt-1 text-sm">
              Kamu menang dalam {drops.length} tetes (par {par}) — kecocokan {match}%. {verdict}
            </p>
            {scoreState === 'sending' && <p className="mt-1 text-xs text-neutral-500">Menyimpan skor…</p>}
            {scoreState === 'saved' && myRank && (
              <p className="mt-1 text-sm font-semibold">🏆 Peringkat hari ini: #{myRank} · 🔥 Streak: {streak} hari</p>
            )}
            {scoreState === 'logged-out' && (
              <p className="mt-1 text-xs text-neutral-600">
                Login ke Reddit supaya skormu tersimpan di leaderboard &amp; streak.
              </p>
            )}
            {scoreState === 'failed' && (
              <p className="mt-1 text-xs text-neutral-600">Skor gagal tersimpan — coba lagi besok.</p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={copyScore}
                className="flex-1 rounded-[10px] bg-[#2e9e5b] py-2.5 text-sm font-semibold text-white"
              >
                {copied ? '✓ Disalin!' : '📋 Salin skor'}
              </button>
              <button
                type="button"
                onClick={shareScore}
                className="flex-1 rounded-[10px] bg-[#2e9e5b] py-2.5 text-sm font-semibold text-white"
              >
                ↗️ Bagikan skor
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Tempel skormu di komentar biar teman-teman bisa ikut main hari ini!
            </p>
            <button
              type="button"
              onClick={() => setShowWinCard(false)}
              className="mt-2 w-full py-1.5 text-center text-xs text-neutral-500"
            >
              Tutup — lihat leaderboard
            </button>
          </div>
        </div>
      )}

      {/* Leaderboard harian — langsung setelah kartu menang */}
      <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-[15px] font-bold">🏆 Leaderboard hari ini</h2>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Belum ada yang menang hari ini — jadilah yang pertama!
          </p>
        ) : (
          <ol className="space-y-1 text-sm">
            {leaderboard.map((e) => (
              <li
                key={e.username}
                className={`flex justify-between rounded-lg px-2 py-1 ${
                  e.isMe ? 'bg-[#e8f7ee] font-bold' : ''
                }`}
              >
                <span>
                  #{e.rank} u/{e.username}
                  {e.isMe ? ' (kamu)' : ''}
                </span>
                <span>
                  {e.drops} tetes · {formatTime(e.timeMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {offline && (
          <p className="mt-2 text-xs text-neutral-500">
            Leaderboard asli ada di versi Reddit — di sini skor tersimpan di perangkatmu saja.
          </p>
        )}
      </div>

      {/* Cara main — dilipat (details) supaya tidak makan tempat; tutorial overlay
          sudah menjelaskan saat pertama main. */}
      <details className="mt-3 rounded-2xl bg-white p-3 text-sm leading-relaxed shadow-sm">
        <summary className="cursor-pointer font-bold">Cara main</summary>
        <p className="mt-1.5">
          Ketuk warna dasar untuk menambahkan 1 tetes ke campuranmu. Campuran adalah rata-rata
          semua tetes. Putih bikin lebih terang, Hitam bikin lebih gelap. Cocokkan warna target
          dengan tetes sesedikit mungkin — <b>par hari ini: {par} tetes</b>. Maksimal {MAX_DROPS} tetes.
        </p>
      </details>

      {/* Overlay tutorial */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-[420px] rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-center text-lg font-bold">🎨 Cara main Warna Harian</h2>
            <p className="mt-0.5 text-center text-xs text-neutral-500">
              Langkah {tutorialStep + 1} dari 3
            </p>

            <div className="mt-3 rounded-xl bg-[#f6f1e7] p-3 text-center">
              {TUTORIAL_STEPS[tutorialStep].art === 'target' && (
                <div>
                  <div className="mx-auto h-14 w-40 rounded-lg border border-black/10" style={{ background: targetHex }} />
                  <p className="mt-2 text-xs text-neutral-500">Ini warna target hari ini — {targetHex}</p>
                </div>
              )}
              {TUTORIAL_STEPS[tutorialStep].art === 'palette' && (
                <div className="flex justify-center gap-2">
                  {BASES.slice(0, 3).map((b) => (
                    <span
                      key={b.name}
                      className="rounded-lg px-3 py-2 text-xs font-bold text-white"
                      style={{ background: b.hex }}
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              )}
              {TUTORIAL_STEPS[tutorialStep].art === 'meter' && (
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#e5e0d3]">
                    <div className="h-full bg-[#2e9e5b]" style={{ width: '97%' }} />
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">Kecocokan 97% — menang! 🎉</p>
                </div>
              )}
            </div>

            <h3 className="mt-3 text-[15px] font-bold">{TUTORIAL_STEPS[tutorialStep].title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700">
              {TUTORIAL_STEPS[tutorialStep].body}
            </p>

            <div className="mt-4 flex gap-2">
              {tutorialStep > 0 && (
                <button
                  type="button"
                  onClick={() => setTutorialStep((s) => s - 1)}
                  className="rounded-[10px] border border-neutral-300 px-4 py-2.5 text-sm"
                >
                  ← Kembali
                </button>
              )}
              {tutorialStep < 2 ? (
                <button
                  type="button"
                  onClick={() => setTutorialStep((s) => s + 1)}
                  className="flex-1 rounded-[10px] bg-[#2e9e5b] py-2.5 text-sm font-semibold text-white"
                >
                  Lanjut →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={tryExample}
                  className="flex-1 rounded-[10px] bg-[#2e9e5b] py-2.5 text-sm font-semibold text-white"
                >
                  ✨ Coba contoh — sorot ketukan pertama
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={closeTutorial}
              className="mt-2 w-full py-1.5 text-center text-xs text-neutral-500"
            >
              Lewati tutorial
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
