import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { Logo } from "../components/Logo";
import "./landing.css";

const REPO = "https://github.com/nirflo-dev/nirflo";
const LOGIN = "/masuk";
const TITLE = "Nirflo - Riset kuantitatif saham Indonesia";

const NAV = [
  ["coba", "Coba sendiri"],
  ["prinsip", "Prinsip"],
  ["fitur", "Fitur"],
  ["ai", "Asisten AI"],
  ["terbuka", "Terbuka"],
  ["faq", "FAQ"],
] as const;
const SECTION_IDS = ["coba", "prinsip", "fitur", "ai", "mulai", "terbuka", "faq"] as const;
const DOTS = [
  ["coba", "Coba sendiri"],
  ["prinsip", "Prinsip"],
  ["fitur", "Fitur"],
  ["ai", "Asisten AI"],
  ["mulai", "Cara mulai"],
  ["terbuka", "Terbuka"],
  ["faq", "FAQ"],
] as const;

const f1 = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;
const relation = (r: number) => {
  const a = Math.abs(r);
  if (a < 0.2) return "nyaris tidak berkaitan";
  return `${r > 0 ? "searah" : "berlawanan"}, ${a < 0.4 ? "lemah" : a < 0.7 ? "sedang" : "kuat"}`;
};

/* ---------- hooks ---------- */

function useReduced() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const reduced = useReduced();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (reduced) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, threshold]);
  return [ref, seen] as const;
}

function useScrollUi(ids: readonly string[]) {
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const h = document.documentElement;
      const y = h.scrollTop;
      const p = y / Math.max(1, h.scrollHeight - h.clientHeight);
      bar.current?.style.setProperty("--p", String(Math.min(1, Math.max(0, p))));
      root.current?.style.setProperty("--sy", String(Math.min(y, 1600)));
      setScrolled(y > 8);
      setShowTop(y > 700);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    }, { rootMargin: "-45% 0px -50% 0px" });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return { active, scrolled, showTop, bar, root };
}

function useTween(target: number, ms = 380) {
  const reduced = useReduced();
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const cur = start + (target - start) * eased;
      from.current = cur;
      setValue(cur);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return value;
}

type RevealKind = "up" | "left" | "right" | "zoom";

function Reveal({ children, delayMs = 0, kind = "up" }: { children: ReactNode; delayMs?: number; kind?: RevealKind }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.16);
  return (
    <div ref={ref} className={`lp-reveal ${kind}${seen ? " in" : ""}`} style={delay(delayMs)}>
      {children}
    </div>
  );
}

const spot = (e: ReactPointerEvent<HTMLElement>) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".lp-card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  card.style.setProperty("--x", `${e.clientX - r.left}px`);
  card.style.setProperty("--y", `${e.clientY - r.top}px`);
  card.style.setProperty("--rx", `${((0.5 - py) * 5).toFixed(2)}deg`);
  card.style.setProperty("--ry", `${((px - 0.5) * 7).toFixed(2)}deg`);
};

const spotReset = (e: ReactPointerEvent<HTMLElement>) => {
  e.currentTarget.querySelectorAll<HTMLElement>(".lp-card").forEach((c) => {
    c.style.setProperty("--rx", "0deg");
    c.style.setProperty("--ry", "0deg");
  });
};

const magnet = (e: ReactPointerEvent<HTMLElement>) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".lp-btn");
  e.currentTarget.querySelectorAll<HTMLElement>(".lp-btn").forEach((x) => {
    if (x !== b) {
      x.style.setProperty("--tx", "0px");
      x.style.setProperty("--ty", "0px");
    }
  });
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty("--tx", `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(1)}px`);
  b.style.setProperty("--ty", `${(((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(1)}px`);
};

const magnetReset = (e: ReactPointerEvent<HTMLElement>) => {
  e.currentTarget.querySelectorAll<HTMLElement>(".lp-btn").forEach((b) => {
    b.style.setProperty("--tx", "0px");
    b.style.setProperty("--ty", "0px");
  });
};

/* ---------- komponen kecil ---------- */

function GitHubMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

type TabItem<T extends string> = { id: T; label: string; icon?: IconName; hint?: string };

function Tabs<T extends string>({ items, value, onChange, label, vertical = false }: {
  items: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; vertical?: boolean;
}) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = vertical ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    if (!keys.includes(e.key) && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = items.findIndex((t) => t.id === value);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
      : (i + (e.key === keys[0] ? 1 : -1) + items.length) % items.length;
    onChange(items[next].id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"} className={`lp-tabs${vertical ? " v" : ""}`} onKeyDown={move}>
      {items.map((t) => (
        <button
          key={t.id} type="button" role="tab" className="lp-tab"
          aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}
        >
          {t.icon && <span className="lp-tab-ico"><Icon name={t.icon} size={18} /></span>}
          <span className="lp-tab-txt"><b>{t.label}</b>{t.hint && <small>{t.hint}</small>}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- data contoh (seluruhnya ilustrasi) ---------- */

function series(seed: number, n: number, drift: number, vol: number): number[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (rnd() - 0.5) * vol));
  return out;
}
const rebase = (v: number[]) => v.map((x) => (x / v[0]) * 100);
const MACRO_A = series(7, 132, 0.0011, 0.03);
const MACRO_B = series(21, 132, -0.0003, 0.022);
const PRICE = series(3, 132, 0.0009, 0.034);

/* ---------- grafik ---------- */

type Line = { name: string; color: string; values: number[] };

function LineChart({ lines, label }: { lines: Line[]; label: string }) {
  const W = 440, H = 200, pl = 8, pr = 8, pt = 14, pb = 16;
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = lines[0].values.length;
  const all = lines.flatMap((l) => l.values);
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (i: number) => pl + (i / (n - 1)) * (W - pl - pr);
  const y = (v: number) => pt + (1 - (v - lo) / (hi - lo || 1)) * (H - pt - pb);
  const path = (v: number[]) => v.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join("");
  const area = `${path(lines[0].values)}L${x(n - 1).toFixed(1)} ${H - pb}L${x(0).toFixed(1)} ${H - pb}Z`;
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - pl) / (W - pl - pr)) * (n - 1)))));
  };
  const left = hover == null ? 0 : Math.min(84, Math.max(16, (x(hover) / W) * 100));
  return (
    <div className="lp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: lines[0].color, stopOpacity: 0.28 }} />
            <stop offset="1" style={{ stopColor: lines[0].color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} className="lp-grid-line" x1={pl} x2={W - pr} y1={pt + g * (H - pt - pb)} y2={pt + g * (H - pt - pb)} />)}
        <path className="lp-area" d={area} fill={`url(#${gid})`} />
        {lines.map((l) => <path key={l.name} className="lp-line" pathLength={1} d={path(l.values)} style={{ stroke: l.color }} />)}
        {hover != null && (
          <>
            <line className="lp-cross" x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} />
            {lines.map((l) => <circle key={l.name} cx={x(hover)} cy={y(l.values[hover])} r={4.5} className="lp-pt" style={{ fill: l.color }} />)}
          </>
        )}
      </svg>
      {hover != null && (
        <div className="lp-tip" style={{ left: `${left}%` }}>
          {lines.map((l) => <span key={l.name}><i style={{ background: l.color }} />{l.name} <b>{f1(l.values[hover])}</b></span>)}
        </div>
      )}
    </div>
  );
}

const PERIODS = [
  { id: "1b", label: "1 bulan", n: 22 },
  { id: "3b", label: "3 bulan", n: 66 },
  { id: "6b", label: "6 bulan", n: 132 },
] as const;

function MacroChart() {
  const [p, setP] = useState<(typeof PERIODS)[number]["id"]>("6b");
  const n = PERIODS.find((x) => x.id === p)?.n ?? 132;
  const lines = useMemo<Line[]>(() => [
    { name: "Indikator A", color: "var(--accent)", values: rebase(MACRO_A.slice(-n)) },
    { name: "Indikator B", color: "var(--s5)", values: rebase(MACRO_B.slice(-n)) },
  ], [n]);
  return (
    <div className="lp-viz">
      <div className="lp-chips" role="group" aria-label="Rentang waktu">
        {PERIODS.map((x) => (
          <button key={x.id} type="button" className={`lp-chipbtn${p === x.id ? " on" : ""}`} aria-pressed={p === x.id} onClick={() => setP(x.id)}>{x.label}</button>
        ))}
        <span className="lp-axis">Awal rentang = 100</span>
      </div>
      <LineChart key={p} lines={lines} label="Grafik perbandingan dua indikator contoh" />
    </div>
  );
}

function PriceChart() {
  const lines = useMemo<Line[]>(() => [{ name: "Harga contoh", color: "var(--accent)", values: rebase(PRICE) }], []);
  return (
    <div className="lp-viz">
      <div className="lp-chips"><span className="lp-axis">Arahkan kursor ke grafik untuk melihat nilainya</span></div>
      <LineChart lines={lines} label="Grafik harga contoh" />
    </div>
  );
}

const RISK = [
  { n: "Saham A", w: 62, r: 78 },
  { n: "Saham B", w: 28, r: 16 },
  { n: "Saham C", w: 10, r: 6 },
] as const;

function Track({ kind, v }: { kind: "w" | "r"; v: number }) {
  return (
    <span className={`lp-t ${kind}`}>
      <i><b style={{ "--w": `${v}%` } as CSSProperties} /></i>
      <span>{Math.round(v)}%</span>
    </span>
  );
}

function Legend() {
  return (
    <div className="lp-legend" aria-hidden>
      <span><i className="sw w" />Bobot</span>
      <span><i className="sw r" />Kontribusi risiko</span>
    </div>
  );
}

function RiskBars() {
  const [on, setOn] = useState(0);
  const d = RISK[on];
  const gap = d.r - d.w;
  const text = gap >= 5
    ? `${d.n} memegang ${d.w}% bobot, tetapi menyumbang ${d.r}% risiko. Hal ini tidak terlihat jika hanya melihat porsi uang.`
    : gap <= -5
      ? `${d.n} memegang ${d.w}% bobot, tetapi hanya menyumbang ${d.r}% risiko, sehingga perannya cenderung meredam.`
      : `${d.n}: bobot ${d.w}% dan risiko ${d.r}%, kurang lebih sebanding.`;
  return (
    <div className="lp-viz">
      <Legend />
      <ul className="lp-bars">
        {RISK.map((x, i) => (
          <li key={x.n} className={`lp-bar${i === on ? " on" : ""}`} tabIndex={0} onPointerEnter={() => setOn(i)} onFocus={() => setOn(i)}>
            <b>{x.n}</b>
            <span className="lp-tracks"><Track kind="w" v={x.w} /><Track kind="r" v={x.r} /></span>
          </li>
        ))}
      </ul>
      <p className="lp-note" aria-live="polite">{text}</p>
    </div>
  );
}

const CI = [
  { label: "Sejak dibeli", s: -0.12, lo: -0.85, hi: 0.61 },
  { label: "Bobot sekarang", s: 0.42, lo: -0.18, hi: 1.02 },
  { label: "Dibagi sama rata", s: 0.88, lo: 0.21, hi: 1.55 },
] as const;
const CI_MIN = -1.2, CI_MAX = 1.8;
const ciAt = (v: number) => ((v - CI_MIN) / (CI_MAX - CI_MIN)) * 100;

function verdictOf(lo: number, hi: number) {
  if (lo > 0) return { k: "pos", t: "Di atas suku bunga", d: "Seluruh rentang berada di atas nol: imbal hasil melampaui suku bunga bebas risiko setelah memperhitungkan risiko." };
  if (hi < 0) return { k: "neg", t: "Di bawah suku bunga", d: "Seluruh rentang berada di bawah nol: imbal hasil tertinggal dari suku bunga bebas risiko." };
  return { k: "mid", t: "Belum pasti", d: "Rentang melewati nol, jadi belum bisa dibedakan dari suku bunga bebas risiko. Wajar untuk data yang masih pendek." };
}

function CiPlot() {
  const [on, setOn] = useState(1);
  const v = verdictOf(CI[on].lo, CI[on].hi);
  return (
    <div className="lp-viz">
      <div className="lp-ci">
        {CI.map((r, i) => {
          const vd = verdictOf(r.lo, r.hi);
          return (
            <div key={r.label} className={`lp-ci-row${i === on ? " on" : ""}`} tabIndex={0} onPointerEnter={() => setOn(i)} onFocus={() => setOn(i)}>
              <div className="lp-ci-head"><span>{r.label}</span><b>{f2(r.s)}</b></div>
              <div className="lp-ci-track" role="img" aria-label={`${r.label}: Sharpe ${f2(r.s)}, selang ${f2(r.lo)} sampai ${f2(r.hi)}`}>
                <i className="lp-ci-zero" style={{ left: `${ciAt(0)}%` }} />
                <i className={`lp-ci-bar ${vd.k}`} style={{ left: `${ciAt(r.lo)}%`, width: `${ciAt(r.hi) - ciAt(r.lo)}%` }} />
                <i className="lp-ci-dot" style={{ left: `${ciAt(r.s)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="lp-note" aria-live="polite"><span className={`lp-chip ${v.k}`}>{v.t}</span> {v.d}</p>
    </div>
  );
}

const HEAT_T = ["A", "B", "C", "D"] as const;
const HEAT = [
  [1, 0.74, 0.18, -0.05],
  [0.74, 1, 0.31, 0.1],
  [0.18, 0.31, 1, 0.52],
  [-0.05, 0.1, 0.52, 1],
] as const;

function Heatmap() {
  const [cell, setCell] = useState<[number, number]>([0, 1]);
  const r = HEAT[cell[0]][cell[1]];
  return (
    <div className="lp-viz">
      <div className="lp-heat" role="grid" aria-label="Korelasi antar saham contoh">
        <span />
        {HEAT_T.map((t) => <b key={t} className="lp-heat-h">{t}</b>)}
        {HEAT.map((row, i) => (
          <div key={i} className="lp-heat-row" role="row">
            <b className="lp-heat-h">{HEAT_T[i]}</b>
            {row.map((v, j) => (
              <span
                key={j} role="gridcell" tabIndex={i === j ? -1 : 0}
                className={`lp-cell${i === cell[0] && j === cell[1] ? " on" : ""}${i === j ? " self" : ""}`}
                style={{ "--i": i * 4 + j, background: `color-mix(in srgb, var(${v >= 0 ? "--accent" : "--down"}) ${Math.round(Math.min(1, Math.abs(v)) * 70)}%, transparent)` } as CSSProperties}
                onPointerEnter={() => i !== j && setCell([i, j])} onFocus={() => i !== j && setCell([i, j])}
              >
                {f2(v)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="lp-note" aria-live="polite">
        Saham {HEAT_T[cell[0]]} dan {HEAT_T[cell[1]]}: <b>{f2(r)}</b>, {relation(r)}. Pasangan yang tidak kompak membantu menyebar risiko.
      </p>
    </div>
  );
}

const SIGNALS = [
  { n: "Saham P", z: 4.8, k: "Kuat" },
  { n: "Saham Q", z: 3.9, k: "Kuat" },
  { n: "Saham R", z: 2.7, k: "Sedang" },
  { n: "Saham S", z: 2.1, k: "Sedang" },
] as const;

function SignalList() {
  return (
    <div className="lp-viz">
      <div className="lp-chips"><span className="lp-axis">Contoh daftar sinyal, diurutkan menurut skor z</span></div>
      <ul className="lp-sig">
        {SIGNALS.map((s, i) => (
          <li key={s.n} style={{ "--i": i } as CSSProperties}>
            <b>{s.n}</b>
            <span className={`lp-badge ${s.k === "Kuat" ? "strong" : "mid"}`}>{s.k}</span>
            <span className="lp-zbar"><i><b style={{ "--w": `${(s.z / 5) * 100}%` } as CSSProperties} /></i></span>
            <span className="lp-z">z {f1(s.z)}</span>
          </li>
        ))}
      </ul>
      <p className="lp-note">Skor z menunjukkan seberapa jauh sinyal menyimpang dari kondisi biasa. Makin tinggi, makin tidak lazim.</p>
    </div>
  );
}

const AI_Q = "Kenapa risiko portofolio saya terasa besar?";
const AI_A = "Saham A memegang 62% bobot, tetapi menyumbang 78% risiko. Mengurangi porsinya menurunkan risiko lebih besar daripada porsi uangnya.";

function useTyped(text: string, run: boolean, ms = 16) {
  const reduced = useReduced();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) {
      setN(text.length);
      return;
    }
    setN(0);
    if (!run) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(t);
    }, ms);
    return () => clearInterval(t);
  }, [text, run, ms, reduced]);
  return text.slice(0, n);
}

function AiMock() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const typed = useTyped(AI_A, seen);
  const done = typed.length >= AI_A.length;
  return (
    <div className="lp-viz lp-ai" ref={ref}>
      <div className="lp-ai-log">
        <p className="lp-ai-msg user">{AI_Q}</p>
        <div className="lp-ai-msg bot">
          <span className="lp-ai-used">Memakai data: Portofolio</span>
          <p aria-hidden>{typed}{!done && <i className="lp-caret" />}</p>
          <p className="lp-sr">{AI_A}</p>
        </div>
      </div>
      <div className="lp-ai-compose" aria-hidden><span>Tulis pertanyaan…</span><b>Kirim</b></div>
    </div>
  );
}

type Ctx = "portofolio" | "makro" | "emiten";
const AI_Q2 = "Apakah portofolio saya terlalu bergantung pada satu saham?";
const CTX: readonly { id: Ctx; short: string; label: string; sent: string }[] = [
  { id: "portofolio", short: "Portofolio", label: "Portofolio “default”", sent: "Saham A: bobot 62%, kontribusi risiko 78%\nSaham B: bobot 28%, kontribusi risiko 16%\nSaham C: bobot 10%, kontribusi risiko 6%" },
  { id: "makro", short: "Makro", label: "Makro: IHSG dan USD/IDR", sent: "IHSG: turun 2,1% dalam 1 bulan\nUSD/IDR: naik 0,8% dalam 1 bulan" },
  { id: "emiten", short: "Emiten", label: "Emiten: Saham A", sent: "Penutupan terakhir: 1.250\nPerubahan 1 tahun: naik 18,4%" },
];

function aiAnswer(on: readonly Ctx[]): string {
  if (!on.includes("portofolio")) {
    return "Tanpa data portofolio, saya hanya bisa menjawab secara umum: saham dengan porsi besar biasanya menyumbang risiko lebih besar dari porsi uangnya. Lampirkan portofolio untuk jawaban yang spesifik.";
  }
  const more = [
    on.includes("emiten") ? "Kenaikan harga Saham A sebesar 18,4% dalam setahun ikut membuat porsinya makin besar." : "",
    on.includes("makro") ? "Pasar sedang melemah (IHSG turun 2,1% dalam sebulan), sehingga saham berbobot besar paling terasa dampaknya." : "",
  ].filter(Boolean);
  return ["Ya. Saham A memegang 62% bobot dan menyumbang 78% risiko, jadi pergerakannya sangat menentukan.", ...more].join(" ");
}

function AiShowcase() {
  const [on, setOn] = useState<Ctx[]>(["portofolio"]);
  const [peek, setPeek] = useState(false);
  const attached = CTX.filter((c) => on.includes(c.id));
  const answer = aiAnswer(on);
  const toggle = (id: Ctx) => setOn((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="lp-lens">
      <div className="lp-aishow-bar">
        <span className="lp-live" aria-hidden />
        <b>Asisten AI</b>
        <span className="lp-tag">Ilustrasi</span>
      </div>
      <div className="lp-ai-log" aria-live="polite">
        <p className="lp-ai-msg user">{AI_Q2}</p>
        <div className="lp-ai-msg bot" key={answer}>
          {attached.length > 0 && <span className="lp-ai-used">Memakai data: {attached.map((c) => c.short).join(", ")}</span>}
          <p>{answer}</p>
        </div>
      </div>
      <div className="lp-ctx">
        <span>Lampirkan</span>
        {CTX.map((c) => (
          <button key={c.id} type="button" className={`lp-chipbtn${on.includes(c.id) ? " on" : ""}`} aria-pressed={on.includes(c.id)} onClick={() => toggle(c.id)}>
            {c.label}
          </button>
        ))}
        <button type="button" className="lp-link" aria-expanded={peek} onClick={() => setPeek((v) => !v)}>
          {peek ? "Tutup" : "Lihat data yang dikirim"}
        </button>
      </div>
      {peek && (
        <pre className="lp-peek">
          {attached.length > 0
            ? attached.map((c) => `${c.short}\n${c.sent}`).join("\n\n")
            : "Tidak ada data yang dikirim. AI hanya menerima pertanyaan Anda."}
        </pre>
      )}
      <p className="lp-fine">Contoh ilustrasi dengan angka rekaan. Jawaban AI bisa keliru dan bukan nasihat investasi.</p>
    </div>
  );
}

const AI_POINTS: readonly { icon: IconName; title: string; body: string }[] = [
  { icon: "sparkle", title: "Model pilihan Anda", body: "Sambungkan akun OpenRouter, lalu pilih model yang Anda mau, termasuk pilihan gratis." },
  { icon: "pie", title: "Data yang Anda lampirkan", body: "AI hanya melihat ringkasan dari Portofolio, Makro, atau Emiten yang Anda pilih. Data portofolio punya pengaturan akses tersendiri." },
  { icon: "search", title: "Terlihat, tidak tersembunyi", body: "Buka pratinjau untuk melihat persis data yang dikirim. Setiap jawaban menyebut data apa yang dipakainya." },
];

/* ---------- hero ---------- */

type DemoTab = "risiko" | "kepastian" | "korelasi" | "makro";
const DEMO_TABS: readonly TabItem<DemoTab>[] = [
  { id: "makro", label: "Makro" },
  { id: "risiko", label: "Risiko" },
  { id: "kepastian", label: "Kepastian" },
  { id: "korelasi", label: "Korelasi" },
];
const DEMO_CAPTION: Record<DemoTab, string> = {
  risiko: "Bobot adalah porsi uang Anda di sebuah saham. Risiko adalah seberapa besar saham itu menggerakkan naik-turunnya portofolio.",
  kepastian: "Sharpe ratio mengukur imbal hasil per unit risiko. Batang adalah rentang kepastiannya; jika melewati nol, hasilnya belum bisa dibedakan dari suku bunga.",
  korelasi: "Makin terang warnanya, makin kompak dua saham bergerak. Saham yang tidak kompak membantu menyebar risiko.",
  makro: "Bandingkan dua indikator pada skala yang sama untuk melihat apakah keduanya bergerak searah.",
};

function DemoCard() {
  const reduced = useReduced();
  const [tab, setTab] = useState<DemoTab>("makro");
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const next = () => setTab((t) => DEMO_TABS[(DEMO_TABS.findIndex((x) => x.id === t) + 1) % DEMO_TABS.length].id);
  return (
    <aside
      className="lp-demo lp-in" style={delay(260)} aria-label="Contoh ilustrasi hasil analisis"
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
    >
      <div className="lp-demo-head"><span>Contoh interaktif</span><span className="lp-tag">Ilustrasi</span></div>
      <Tabs items={DEMO_TABS} value={tab} label="Jenis analisis" onChange={(id) => { setTab(id); setAuto(false); }} />
      <div className="lp-panel" role="tabpanel" key={tab}>
        {tab === "risiko" && <RiskBars />}
        {tab === "kepastian" && <CiPlot />}
        {tab === "korelasi" && <Heatmap />}
        {tab === "makro" && <MacroChart />}
        {tab === "ai" && <AiMock />}
      </div>
      <p className="lp-caption">{DEMO_CAPTION[tab]}</p>
      {auto && !reduced && (
        <div className="lp-timer" aria-hidden><i key={tab} className={paused ? "paused" : ""} onAnimationEnd={next} /></div>
      )}
      <p className="lp-fine">Seluruh angka adalah data contoh, bukan portofolio nyata.</p>
    </aside>
  );
}

const AUDIENCES = ["pemula", "pelajar", "pekerja", "karyawan", "investor", "mahasiswa", "pengusaha"] as const;

function Audience() {
  const reduced = useReduced();
  const [cur, setCur] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const idx = useRef(0);
  const word = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => {
      const p = idx.current;
      idx.current = (p + 1) % AUDIENCES.length;
      setPrev(p);
      setCur(idx.current);
    }, 2600);
    return () => clearInterval(t);
  }, [reduced]);

  useLayoutEffect(() => {
    const measure = () => {
      if (word.current) setWidth(word.current.offsetWidth);
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [cur]);

  return (
    <p className="lp-aud lp-in" style={delay(200)}>
      Dirancang untuk{" "}
      <span className="lp-rot" aria-hidden style={width ? { width } : undefined}>
        {prev !== null && (
          <span key={`o${prev}`} className="lp-rot-word out" onAnimationEnd={() => setPrev(null)}>{AUDIENCES[prev]}</span>
        )}
        <span key={cur} ref={word} className="lp-rot-word in">{AUDIENCES[cur]}</span>
      </span>
      <span className="lp-sr">{AUDIENCES.join(", ")}</span>, apa pun latar belakang Anda.
    </p>
  );
}

const MARQUEE = [
  "Kontribusi risiko", "Korelasi antar saham", "Sharpe ratio", "Selang kepercayaan", "Sinyal kuantitatif",
  "IHSG", "Kurs rupiah", "Komoditas", "Suku bunga", "Diversifikasi", "Asisten AI",
] as const;

function Marquee() {
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="lp-marquee" aria-hidden>
      <div className="lp-marquee-track">
        {items.map((t, i) => <span key={i}><i />{t}</span>)}
      </div>
    </div>
  );
}

/* ---------- simulator ---------- */

const SIM = [
  { n: "Saham A", s: 0.35 },
  { n: "Saham B", s: 0.22 },
  { n: "Saham C", s: 0.14 },
] as const;
const PRESETS = [
  { label: "Seimbang", a: 34, rho: 30 },
  { label: "Satu saham dominan", a: 70, rho: 50 },
  { label: "Saham kompak", a: 34, rho: 85 },
] as const;

function simulate(a: number, rho: number) {
  const w = [a, (1 - a) / 2, (1 - a) / 2];
  const cov = SIM.map((p, i) => SIM.map((q, j) => (i === j ? p.s * p.s : rho * p.s * q.s)));
  const sw = cov.map((row) => row.reduce((s, c, j) => s + c * w[j], 0));
  const variance = w.reduce((s, wi, i) => s + wi * sw[i], 0);
  const sd = Math.sqrt(variance);
  const rc = w.map((wi, i) => (wi * sw[i]) / variance);
  const undiversified = w.reduce((s, wi, i) => s + wi * SIM[i].s, 0);
  return { w, rc, sd, saving: 1 - sd / undiversified };
}

function Simulator() {
  const [a, setA] = useState(55);
  const [rho, setRho] = useState(40);
  const r = useMemo(() => simulate(a / 100, rho / 100), [a, rho]);
  const sd = useTween(r.sd * 100);
  const saving = useTween(r.saving * 100);
  const top = r.rc.reduce((best, v, i) => (v - r.w[i] > r.rc[best] - r.w[best] ? i : best), 0);
  const gap = r.rc[top] - r.w[top];
  const insight = gap >= 0.05
    ? `${SIM[top].n} memegang ${Math.round(r.w[top] * 100)}% bobot, tetapi menyumbang ${Math.round(r.rc[top] * 100)}% risiko.`
    : "Risiko tersebar hampir sebanding dengan bobot.";
  const diversify = rho >= 70
    ? `Karena saham bergerak kompak, diversifikasi hanya menghemat ${f1(r.saving * 100)}% risiko.`
    : `Karena saham tidak sepenuhnya bergerak kompak, diversifikasi menghemat ${f1(r.saving * 100)}% risiko.`;
  return (
    <div className="lp-sim">
      <div className="lp-sim-card">
        <div className="lp-presets" role="group" aria-label="Skenario siap pakai">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={`lp-chipbtn${a === p.a && rho === p.rho ? " on" : ""}`} onClick={() => { setA(p.a); setRho(p.rho); }}>{p.label}</button>
          ))}
        </div>
        <label className="lp-field">
          <span><b>Porsi Saham A</b><output>{a}%</output></span>
          <input className="lp-range" type="range" min={10} max={80} step={1} value={a} onChange={(e) => setA(Number(e.target.value))} />
          <small>Sisanya dibagi rata ke Saham B dan C.</small>
        </label>
        <label className="lp-field">
          <span><b>Seberapa kompak saham bergerak</b><output>{f2(rho / 100)}</output></span>
          <input className="lp-range" type="range" min={0} max={90} step={5} value={rho} onChange={(e) => setRho(Number(e.target.value))} />
          <small>Mendekati 0: bergerak sendiri-sendiri. Mendekati 1: naik dan turun bersamaan.</small>
        </label>
      </div>
      <div className="lp-sim-card">
        <Legend />
        <ul className="lp-bars">
          {SIM.map((s, i) => (
            <li key={s.n} className="lp-bar">
              <b>{s.n}</b>
              <span className="lp-tracks"><Track kind="w" v={r.w[i] * 100} /><Track kind="r" v={r.rc[i] * 100} /></span>
            </li>
          ))}
        </ul>
        <div className="lp-stats">
          <div><small>Volatilitas portofolio</small><strong>{f1(sd)}%</strong><span>per tahun</span></div>
          <div><small>Dihemat diversifikasi</small><strong>{f1(saving)}%</strong><span>dibanding saham yang kompak</span></div>
        </div>
        <p className="lp-note" aria-live="polite">{insight} {diversify}</p>
        <p className="lp-fine">Simulasi sederhana dengan volatilitas contoh 35%, 22%, dan 14% per tahun. Angka bersifat ilustrasi.</p>
      </div>
    </div>
  );
}

/* ---------- konten ---------- */

type Principle = { icon: IconName; title: string; body: string; gain: string };

const PRINCIPLES: readonly Principle[] = [
  {
    icon: "zap",
    title: "Perangkat institusi, kini untuk semua investor",
    body: "Analisis yang lazim di meja riset institusi, seperti kontribusi risiko, korelasi, dan Sharpe ratio, tersedia untuk siapa pun yang berinvestasi di saham Indonesia.",
    gain: "Keputusan Anda bertumpu pada metode yang teruji, bukan firasat.",
  },
  {
    icon: "chart",
    title: "Kuantitatif untuk siapa saja",
    body: "Tidak perlu latar belakang statistik atau keuangan. Setiap angka dijelaskan dalam bahasa sehari-hari, disertai sorotan otomatis dan grafik yang langsung bisa dibaca.",
    gain: "Pemula, profesional dari bidang lain, hingga investor berpengalaman sama-sama dapat memahami hasilnya.",
  },
  {
    icon: "globe",
    title: "Terhubung dengan alat yang Anda pakai",
    body: "Data Anda tidak dikunci di satu tempat. Tabel dapat diunduh sebagai CSV dan hasil evaluasi diekspor ke JSON untuk dipadukan dengan spreadsheet, notebook, atau alur riset Anda sendiri.",
    gain: "Anda tetap memegang kendali atas cara kerja Anda.",
  },
  {
    icon: "search",
    title: "Transparan dan dibangun bersama",
    body: "Cara hitung, asumsi, dan batasan data ditampilkan apa adanya. Kode sumbernya terbuka di GitHub dengan lisensi MIT, sehingga siapa pun dapat memeriksa, mengusulkan perbaikan, atau menambahkan alat baru.",
    gain: "Anda tidak perlu percaya begitu saja; Anda bisa memeriksanya sendiri.",
  },
];

type FeatId = "emiten" | "sinyal" | "portofolio" | "makro" | "ai";
const FEATURES: readonly (TabItem<FeatId> & { hint: string; lead: string; points: readonly string[] })[] = [
    {
    id: "ai", label: "Asisten AI", icon: "sparkle", hint: "Baru: tanya dengan data Anda",
    lead: "Minta penjelasan istilah atau bacaan atas hasil Anda, dengan data yang Anda lampirkan sendiri.",
    points: ["Pilih model dari OpenRouter, termasuk yang gratis", "Lampirkan ringkasan Portofolio, Makro, atau Emiten", "Lihat data yang dikirim dan data yang dipakai jawaban", "Jawaban tampil rapi: daftar, tabel, dan kode"],
  },
  {
    id: "makro", label: "Makro", icon: "globe", hint: "Pasar, kurs, komoditas",
    lead: "Pahami lingkungan yang membentuk pasar: dari IHSG dan kurs hingga komoditas dan suku bunga.",
    points: ["IHSG, kurs, komoditas, suku bunga, dan indikator Indonesia", "Perbandingan indikator pada skala yang sama", "Hubungan antar indikator dalam bahasa sederhana"],
  },
  {
    id: "sinyal", label: "Sinyal", icon: "zap", hint: "Pemindai pasar",
    lead: "Lihat saham dengan sinyal kuantitatif aktif tanpa harus memeriksa satu per satu.",
    points: ["Sinyal aktif beserta kekuatan dan skor z", "Daftar terbaru langsung tampil di Beranda", "Dasar penelusuran lanjutan per emiten"],
  },
  {
    id: "emiten", label: "Emiten", icon: "chart", hint: "Telusuri satu saham",
    lead: "Telusuri satu saham dari berbagai sisi, dimulai dari pencarian yang cepat.",
    points: ["Cari berdasarkan kode atau sektor", "Pintasan papan ketik dengan tombol garis miring", "Riwayat emiten yang terakhir dibuka"],
  },
];

function FeatureVisual({ id }: { id: FeatId }) {
  if (id === "emiten") return <PriceChart />;
  if (id === "sinyal") return <SignalList />;
  if (id === "portofolio") return <RiskBars />;
    if (id === "ai") return <AiMock />;
  return <MacroChart />;
}

function Features() {
  const [id, setId] = useState<FeatId>("portofolio");
  const [ref, seen] = useInView<HTMLDivElement>(0.12);
  const f = FEATURES.find((x) => x.id === id) ?? FEATURES[0];
  return (
    <div className="lp-feat" ref={ref}>
      <Tabs vertical items={FEATURES} value={id} label="Fitur Nirflo" onChange={setId} />
      <div className="lp-feat-panel" role="tabpanel" key={id}>
        <div className="lp-feat-copy">
          <h3>{f.label}</h3>
          <p>{f.lead}</p>
          <ul className="lp-checks">
            {f.points.map((p, i) => <li key={p} style={{ "--i": i } as CSSProperties}>{p}</li>)}
          </ul>
          <Link to={LOGIN} className="lp-more">Coba di aplikasi <Icon name="arrow" size={16} /></Link>
        </div>
        <div className="lp-feat-viz">{seen && <FeatureVisual id={id} />}</div>
      </div>
    </div>
  );
}

const STEPS = [
  ["Masuk", "Gunakan akun Google, GitHub, atau email."],
  ["Isi posisi", "Masukkan kode saham, jumlah lot, dan tanggal beli."],
    ["Baca hasilnya", "Lihat risiko, korelasi, dan Sharpe ratio beserta penjelasannya. Ada yang membingungkan? Tanyakan ke asisten AI."],
] as const;

function Steps() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className={`lp-steps${seen ? " in" : ""}`} role="list" onPointerMove={spot} onPointerLeave={spotReset}>
      {STEPS.map(([t, b], i) => (
        <Reveal key={t} kind="zoom" delayMs={i * 160}>
          <div className="lp-card" role="listitem">
            <span className="lp-stepno" style={delay(300 + i * 160)}>{i + 1}</span>
            <h3>{t}</h3>
            <p>{b}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

const TRANSPARENCY = [
  "Selang kepercayaan 95% ditampilkan, bukan satu angka tunggal.",
  "Catatan dan peringatan kualitas data ditampilkan, bukan disembunyikan.",
  "Return dihitung dari harga yang disesuaikan dividen dan split.",
  "Suku bunga bebas risiko memakai mata uang yang sama dengan return saham.",
] as const;

const WAYS = [
  { n: "01", t: "Laporkan masalah", d: "Temukan angka yang janggal atau fitur yang membingungkan? Catat di Issues.", href: `${REPO}/issues` },
  { n: "02", t: "Usulkan perbaikan", d: "Kirim pull request untuk memperbaiki rumus, dokumentasi, atau tampilan.", href: `${REPO}/pulls` },
  { n: "03", t: "Diskusikan gagasan", d: "Punya ide alat baru atau metode yang lebih baik? Mulai percakapan di Discussions.", href: `${REPO}/discussions` },
] as const;

const FAQ: readonly (readonly [string, ReactNode])[] = [
  ["Apakah Nirflo memberi rekomendasi beli atau jual?", "Tidak. Nirflo adalah alat riset dan edukasi yang membantu Anda memahami risiko dan konteks pasar. Keputusan investasi sepenuhnya menjadi tanggung jawab Anda."],
  ["Apakah saya perlu memahami statistik?", "Tidak. Setiap hasil disertai penjelasan dalam bahasa sehari-hari dan sorotan otomatis. Bagi yang ingin menyelam lebih dalam, rincian perhitungan tersedia di setiap panel."],
  ["Dari mana data berasal dan seberapa baru?", "Harga saham dan indikator makro dikumpulkan dari sumber data publik dan diperbarui secara berkala. Tanggal data terakhir tampil di bagian atas aplikasi, dan halaman Status data merinci kondisinya."],
  ["Apakah AI bisa melihat portofolio saya?", "Hanya jika Anda mengizinkan. Akses data diatur di Profil, bagian Koneksi AI, dan data portofolio punya pengaturan tersendiri. Untuk setiap pertanyaan, Anda memilih ringkasan mana yang dilampirkan dan bisa melihat persis isi yang dikirim."],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="lp-faq">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`lp-qa${open === i ? " open" : ""}`}>
          <h3>
            <button type="button" id={`faq-h-${i}`} aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)}>
              {q}<span className="lp-plus" aria-hidden />
            </button>
          </h3>
          <div id={`faq-${i}`} role="region" aria-labelledby={`faq-h-${i}`} className="lp-qa-body"><div><p>{a}</p></div></div>
        </div>
      ))}
    </div>
  );
}

function Head({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const words = title.split(" ");
  return (
    <div ref={ref} className={`lp-sec-head${seen ? " in" : ""}`}>
      <span className="lp-kicker">{kicker}</span>
      <h2>
        <span className="lp-sr">{title}</span>
        {words.map((w, i) => (
          <span key={i} aria-hidden>
            <span className="lp-w" style={{ "--i": i } as CSSProperties}><span>{w}</span></span>{" "}
          </span>
        ))}
      </h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ---------- halaman ---------- */

export default function LandingPage() {
  useEffect(() => {
    document.title = TITLE;
  }, []);
  const { active, scrolled, showTop, bar, root } = useScrollUi(SECTION_IDS);

  const onHeroMove = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  return (
    <div className="lp" ref={root}>
      <div className="lp-progress" ref={bar} aria-hidden />
      <div className="lp-orbs" aria-hidden><i className="o1" /><i className="o2" /><i className="o3" /></div>
      <nav className="lp-dots" aria-label="Navigasi bagian">
        {DOTS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={active === id ? "on" : ""} aria-label={label}><span>{label}</span></a>
        ))}
      </nav>

      <header className={`lp-nav${scrolled ? " scrolled" : ""}`}>
        <div className="lp-wrap">
          <Link to="/" className="lp-brand" aria-label="Nirflo"><Logo size={32} /><span>Nirflo</span></Link>
          <nav className="lp-links" aria-label="Bagian halaman">
            {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{label}</a>)}
          </nav>
          <div className="lp-actions">
            <a className="lp-gh" href={REPO} target="_blank" rel="noopener noreferrer" aria-label="Nirflo di GitHub" title="Nirflo di GitHub"><GitHubMark /></a>
            <Link to={LOGIN} className="lp-btn primary">Masuk</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero" onPointerMove={onHeroMove}>
          <div className="lp-wrap">
            <div>
              <span className="lp-eyebrow lp-in">Riset kuantitatif saham Indonesia</span>
              <h1 className="lp-in" style={delay(80)}>Alat riset institusi, <em>di tangan Anda.</em></h1>
              <Audience />
              <p className="lp-lead lp-in" style={delay(300)}>
                Nirflo membawa analisis kuantitatif yang biasanya hanya ada di meja riset institusi kepada setiap
                investor Indonesia: risiko portofolio, sinyal statistik, konteks makro, dan asisten AI yang hanya
                melihat data yang Anda izinkan.
              </p>
              <div className="lp-cta lp-in" style={delay(400)} onPointerMove={magnet} onPointerLeave={magnetReset}>
                <Link to={LOGIN} className="lp-btn primary lg">Mulai sekarang <Icon name="arrow" size={18} /></Link>
                <a href="#coba" className="lp-btn lg">Coba simulasinya</a>
                <a href={REPO} className="lp-btn lg gh" target="_blank" rel="noopener noreferrer"><GitHubMark size={18} />GitHub</a>
              </div>
              <p className="lp-assure lp-in" style={delay(480)}>Setiap hasil disertai selang kepercayaan dan catatan kualitas data.</p>
            </div>
            <DemoCard />
          </div>
        </section>

        <Marquee />

        <section id="coba" className="lp-sec">
          <div className="lp-wrap">
            <Head kicker="Coba sendiri" title="Bobot bukan risiko. Lihat sendiri bedanya.">
              Geser pengaturan di bawah dan perhatikan bagaimana kontribusi risiko berubah. Wawasan seperti inilah yang
              diberikan Nirflo pada portofolio Anda yang sebenarnya.
            </Head>
            <Reveal><Simulator /></Reveal>
          </div>
        </section>

        <section id="prinsip" className="lp-sec">
          <div className="lp-wrap">
            <Head kicker="Prinsip" title="Empat prinsip yang menjaga Nirflo tetap berpihak pada Anda">
              Cara kami membangunnya, dalam bahasa yang sederhana.
            </Head>
            <div className="lp-grid two" onPointerMove={spot} onPointerLeave={spotReset}>
              {PRINCIPLES.map((p, i) => (
                <Reveal key={p.title} delayMs={i * 90} kind={i % 2 === 0 ? "left" : "right"}>
                  <article className="lp-card">
                    <div className="lp-card-top">
                      <span className="lp-ico"><Icon name={p.icon} size={20} /></span>
                      <span className="lp-num" aria-hidden>0{i + 1}</span>
                    </div>
                    <h3>{p.title}</h3>
                    <p>{p.body}</p>
                    <p className="lp-gain"><small>Bagi Anda</small>{p.gain}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="fitur" className="lp-sec">
          <div className="lp-wrap">
            <Head kicker="Fitur" title="Satu terminal untuk seluruh alur riset Anda">
              Dari gambaran makro, ke satu saham, hingga risiko seluruh portofolio.
            </Head>
            <Reveal kind="zoom"><Features /></Reveal>
          </div>
        </section>

        <section id="ai" className="lp-sec">
          <div className="lp-wrap">
            <Head kicker="Asisten AI" title="Tanya AI, dengan data yang Anda pilih sendiri">
              Minta penjelasan istilah atau bacaan atas hasil Anda. Anda yang menentukan model dan data yang dilihatnya.
            </Head>
            <div className="lp-ai-grid">
              <div>
                <ul className="lp-ai-points">
                  {AI_POINTS.map((p) => (
                    <li key={p.title}>
                      <span className="lp-ico"><Icon name={p.icon} size={20} /></span>
                      <span><b>{p.title}</b><small>{p.body}</small></span>
                    </li>
                  ))}
                </ul>
                <Link to={LOGIN} className="lp-more">Coba asisten di aplikasi <Icon name="arrow" size={16} /></Link>
              </div>
              <Reveal kind="zoom"><AiShowcase /></Reveal>
            </div>
          </div>
        </section>

        <section id="mulai" className="lp-sec">
          <div className="lp-wrap">
            <Head kicker="Cara mulai" title="Mulai dalam tiga langkah">Tidak perlu persiapan khusus.</Head>
            <Steps />
          </div>
        </section>

        <section id="terbuka" className="lp-sec">
          <div className="lp-wrap">
            <Reveal kind="zoom">
              <div className="lp-open">
                <div>
                  <span className="lp-kicker">Transparan dan terbuka</span>
                  <h2>Terbuka untuk diperiksa, terbuka untuk dibangun bersama</h2>
                  <p>
                    Kepercayaan datang dari kemampuan memeriksa. Karena itu cara hitung, asumsi, dan batasan data
                    ditampilkan apa adanya, dan seluruh kode sumber dapat dibaca siapa pun.
                  </p>
                  <ul className="lp-checks">{TRANSPARENCY.map((t) => <li key={t}>{t}</li>)}</ul>
                  <div className="lp-cta">
                    <a href={REPO} className="lp-btn primary" target="_blank" rel="noopener noreferrer"><GitHubMark size={18} />Lihat di GitHub</a>
                    <a href={`${REPO}/blob/main/LICENSE`} className="lp-btn" target="_blank" rel="noopener noreferrer">Lisensi MIT</a>
                  </div>
                </div>
                <div className="lp-ways">
                  <h3>Cara berkontribusi</h3>
                  {WAYS.map((w) => (
                    <a key={w.n} href={w.href} target="_blank" rel="noopener noreferrer">
                      <span className="lp-way-n">{w.n}</span>
                      <span><b>{w.t}</b><small>{w.d}</small></span>
                      <Icon name="arrow" size={18} />
                    </a>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="faq" className="lp-sec">
          <div className="lp-wrap lp-narrow">
            <Head kicker="FAQ" title="Pertanyaan yang sering muncul" />
            <Reveal><Faq /></Reveal>
          </div>
        </section>

        <section className="lp-final">
          <div className="lp-wrap">
            <Reveal kind="zoom">
              <div className="lp-final-in">
                <span className="lp-final-logo"><i /><i /><Logo size={56} /></span>
                <h2>Mulai membaca risiko portofolio Anda</h2>
                <p>Masuk dan tambahkan posisi pertama. Hasilnya langsung terlihat.</p>
                <Link to={LOGIN} className="lp-btn primary lg">Masuk ke Nirflo <Icon name="arrow" size={18} /></Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot-top">
            <div className="lp-foot-brand"><Logo size={26} /><span>Nirflo</span></div>
            <nav className="lp-foot-links" aria-label="Tautan">
              <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">Lisensi MIT</a>
              <Link to={LOGIN}>Masuk</Link>
            </nav>
          </div>
          <p>
            Nirflo adalah alat riset dan edukasi, bukan nasihat investasi. Keputusan investasi sepenuhnya menjadi
            tanggung jawab Anda.
          </p>
          <small>&copy; {new Date().getFullYear()} Nirflo</small>
        </div>
      </footer>

      <button
        type="button" className={`lp-top${showTop ? " show" : ""}`} aria-label="Kembali ke atas"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        <Icon name="arrow" size={18} />
      </button>
    </div>
  );
}