import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { usePerformance, useScanPeriods, useScanResults } from "../lib/api";
import { daysAgo, day, num, pct, tone } from "../lib/format";
import { useColors, useParam, type Palette } from "../lib/hooks";
import { useCountUp, useMounted } from "../lib/motion";
import { HORIZONS, type Performance, type PerfRow, type ScanRow, type Summary } from "../lib/types";
import { baseOption, Chart, Y, yName } from "../components/Chart";
import { Async, DataTable, TextField, type Col } from "../components/ui";
import { statusChip } from "./EmitenPage";
import "./signals.css";

const STATUSES = ["STRONG", "MODERATE", "WEAK", "NO SIGNAL"];
const STATUS_COLOR: Record<string, string> = { STRONG: "var(--accent)", MODERATE: "var(--s6)", WEAK: "var(--warn)", "NO SIGNAL": "var(--s8)" };
const MIN_MATURED = 30;
const TABS = [{ id: "kinerja", label: "Kinerja sinyal" }, { id: "scan", label: "Hasil pemindaian" }];
const DIRS = [{ value: "POSITIVE", label: "Positif" }, { value: "NEGATIVE", label: "Negatif" }] as const;
const DIR_WORD: Record<string, string> = { POSITIVE: "positif", NEGATIVE: "negatif" };
const SPANS = [{ value: "182", label: "6 bulan" }, { value: "365", label: "1 tahun" }, { value: "730", label: "2 tahun" }, { value: "1095", label: "3 tahun" }] as const;

/** Jeda animasi bertahap untuk kartu yang muncul berurutan. */
const stagger = (i: number) => ({ "--d": `${i * 70}ms` }) as CSSProperties;

// ---------------------------------------------------------------- komponen kecil
function Count({ value, fmt }: { value: number | null | undefined; fmt: (v: number) => string }) {
  const v = useCountUp(value ?? null);
  return <>{v == null ? "-" : fmt(v)}</>;
}

/** Pilihan tunggal dengan penanda yang meluncur ke opsi terpilih. */
function Pills<V extends string>({ label, value, options, onChange }: {
  label: string; value: V | ""; options: readonly { value: V; label: string }[]; onChange: (v: V) => void;
}) {
  const i = options.findIndex((o) => o.value === value);
  return (
    <div className="sg-pills" role="radiogroup" aria-label={label} data-none={i < 0} style={{ "--n": options.length, "--i": Math.max(0, i) } as CSSProperties}>
      <i className="sg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function TabBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const i = Math.max(0, TABS.findIndex((t) => t.id === value));
  return (
    <div className="sg-tabs" role="tablist" style={{ "--n": TABS.length, "--i": i } as CSSProperties}>
      <i className="sg-thumb" aria-hidden />
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sg-group"><span className="sg-label">{label}</span>{children}</div>;
}

function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className="sg-collapse" data-open={open}><div>{children}</div></div>;
}

function Card({ title, sub, i = 0, children }: { title: string; sub?: ReactNode; i?: number; children: ReactNode }) {
  return (
    <section className="sg-card sg-rise" style={stagger(i)}>
      <header className="sg-card-head"><h3>{title}</h3>{sub && <span className="muted">{sub}</span>}</header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- halaman
export default function SignalsPage() {
  const [tab, setTab] = useParam("tab", "kinerja");
  return (
    <div className="sg">
      <header className="sg-head sg-rise">
        <div>
          <h2>Sinyal</h2>
          <p className="muted">Seberapa jauh harga bergerak setelah sinyal laba terdeteksi, dan emiten mana yang sedang menyala.</p>
        </div>
        <TabBar value={tab} onChange={setTab} />
      </header>
      <div className="sg-pane" key={tab}>{tab === "kinerja" ? <PerformanceTab /> : <ScanTab />}</div>
    </div>
  );
}

// ---------------------------------------------------------------- tab kinerja
function PerformanceTab() {
  const [since, setSince] = useParam("since", daysAgo(365));
  const [hz, setHz] = useParam("hz", "10");
  const [dir, setDir] = useParam("dir", "POSITIVE");
  const [bm, setBm] = useParam("bm", "");
  const [lag, setLag] = useParam("lag", "");
  const [gap, setGap] = useParam("gap", "");
  const [more, setMore] = useState(false);
  const q = usePerformance({ since, benchmark: bm.toUpperCase() || undefined, entry_lag: lag || undefined, max_gap: gap || undefined });
  const a = q.data?.assumptions;
  const span = SPANS.find((s) => daysAgo(Number(s.value)) === since)?.value ?? "";
  const custom = [bm, lag, gap].filter(Boolean).length;
  return (
    <div className="sg-stack">
      <section className="sg-card sg-controls sg-rise" style={stagger(1)} aria-label="Filter kinerja sinyal">
        <Group label="Arah sinyal"><Pills label="Arah sinyal" value={dir} options={DIRS} onChange={setDir} /></Group>
        <Group label="Lama tahan">
          <Pills label="Lama tahan" value={hz} onChange={setHz} options={HORIZONS.map((h) => ({ value: String(h), label: `+${h} hari` }))} />
        </Group>
        <Group label="Sinyal sejak">
          <div className="sg-since">
            <Pills label="Rentang waktu" value={span} options={SPANS} onChange={(k) => setSince(daysAgo(Number(k)))} />
            <input type="date" aria-label="Tanggal mulai" value={since} max={daysAgo(0)} onChange={(e) => e.target.value && setSince(e.target.value)} />
          </div>
        </Group>
        <div className="sg-more">
          <button type="button" className="sg-link" aria-expanded={more} onClick={() => setMore(!more)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
            Pengaturan lanjutan{custom > 0 && <b>{custom}</b>}
          </button>
          <Collapse open={more}>
            <div className="sg-fields">
              <TextField label="Benchmark (kode di daily_prices)" value={bm} onChange={setBm} placeholder="mis. IHSG.JK" />
              <TextField label="Entry lag (hari bursa)" value={lag} onChange={setLag} placeholder={a ? String(a.entryLag) : "default"} />
              <TextField label="Batas jeda entry (hari)" value={gap} onChange={setGap} placeholder={a ? String(a.maxGap) : "default"} />
            </div>
          </Collapse>
        </div>
      </section>
      <Async q={q} isEmpty={(d) => (!d.available ? "Kinerja sinyal memerlukan koneksi database dan belum tersedia pada mode snapshot." : d.rows.length === 0 && "Belum ada sinyal pada rentang ini.")}>
        {(d) => <PerfView d={d} dir={dir} hz={hz} bm={bm.toUpperCase()} />}
      </Async>
    </div>
  );
}

function horizonOption(c: Palette, stats: Record<string, Summary>) {
  const hs = HORIZONS.map((h) => stats[String(h)]);
  return baseOption(c, {
    animationDuration: 900, animationEasing: "cubicOut",
    legend: { show: false }, grid: { left: 64, right: 16, top: 20, bottom: 28 },
    xAxis: { type: "category", data: HORIZONS.map((h) => `+${h} hari`), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
    yAxis: Y(c, yName("Rata-rata return (%)", 44)),
    series: [
      { type: "bar", barMaxWidth: 48, itemStyle: { color: c.accent }, data: hs.map((s) => (s.mean == null ? null : s.mean * 100)),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: c.muted }, data: [{ yAxis: 0 }] } },
      { // whisker interval kepercayaan 95%
        type: "custom", z: 10, silent: true, tooltip: { show: false },
        data: hs.map((s, i) => (s.mean == null ? [i, null, null] : [i, (s.mean - s.ci) * 100, (s.mean + s.ci) * 100])),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderItem: (_: unknown, api: any) => {
          const x = api.value(0) as number, lo = api.value(1) as number, hi = api.value(2) as number;
          if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { type: "group", children: [] };
          const a = api.coord([x, lo]), b = api.coord([x, hi]), style = { stroke: c.text, lineWidth: 1.4 };
          const cap = (p: number[]) => ({ type: "line", shape: { x1: p[0] - 7, y1: p[1], x2: p[0] + 7, y2: p[1] }, style });
          return { type: "group", children: [{ type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style }, cap(a), cap(b)] };
        },
      },
    ],
  });
}

function confirmOption(c: Palette, rows: { label: string; mean: number; n: number }[]) {
  return baseOption(c, {
    animationDuration: 900, animationEasing: "cubicOut",
    legend: { show: false }, grid: { left: 64, right: 16, top: 30, bottom: 28 },
    xAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { color: c.muted } },
    yAxis: Y(c, yName("Rata-rata return (%)", 44)),
    series: [{
      type: "bar", barMaxWidth: 48,
      data: rows.map((r) => ({ value: r.mean * 100, itemStyle: { color: r.mean >= 0 ? c.up : c.down } })),
      label: { show: true, position: "top", color: c.text, formatter: (p: { dataIndex: number }) => `${pct(rows[p.dataIndex].mean, 1, true)} (n=${rows[p.dataIndex].n})` },
    }],
  });
}

// ---------------------------------------------------------------- ringkasan
function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const on = useMounted();
  const R = 46, C = 2 * Math.PI * R;
  const v = value == null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <svg className="sg-ring" viewBox="0 0 120 120" role="img" aria-label={label}>
      <circle className="sg-ring-bg" cx="60" cy="60" r={R} />
      <circle className="sg-ring-fg" cx="60" cy="60" r={R} transform="rotate(-90 60 60)" strokeDasharray={C} strokeDashoffset={on ? C * (1 - v) : C} style={{ stroke: color }} />
    </svg>
  );
}

function Hero({ s, dir, hz, bm, prefix }: { s?: Summary; dir: string; hz: string; bm: string; prefix: string }) {
  const on = useMounted();
  const n = s?.n ?? 0;
  const win = s?.win ?? null;
  const mean = s?.mean ?? null;
  const verb = dir === "NEGATIVE" ? "turun" : "naik";
  const level = n >= MIN_MATURED ? "ok" : n >= 10 ? "mid" : "low";
  const levelText = { ok: "Memadai", mid: "Masih kecil", low: "Sangat kecil" }[level];
  const ring = win == null ? "var(--muted)" : win >= 0.55 ? "var(--up)" : win >= 0.45 ? "var(--warn)" : "var(--down)";
  const range = mean == null || !s ? "-" : `${pct(mean - s.ci, 1, true)} sampai ${pct(mean + s.ci, 1, true)}`;
  const headline = n === 0
    ? `Belum ada sinyal ${DIR_WORD[dir] ?? dir.toLowerCase()} yang sudah mencapai +${hz} hari bursa.`
    : `Dari ${n} sinyal ${DIR_WORD[dir] ?? dir.toLowerCase()} yang sudah mencapai +${hz} hari bursa, ${pct(win, 0)} ${verb} sesuai tesis dengan rata-rata return ${pct(mean, 1, true)}.`;
  return (
    <section className="sg-card sg-hero sg-rise" style={stagger(2)} aria-label="Ringkasan kinerja">
      <div className="sg-ringbox">
        <Ring value={win} color={ring} label={`${pct(win, 0)} sinyal ${verb} sesuai tesis`} />
        <div className="sg-ring-c"><strong><Count value={win} fmt={(v) => pct(v, 0)} /></strong><small>{verb} sesuai tesis</small></div>
      </div>
      <div className="sg-read">
        <p className="sg-headline">{headline}</p>
        <dl className="sg-metrics">
          <div><dt>Rata-rata</dt><dd className={tone(mean)}><Count value={mean} fmt={(v) => pct(v, 1, true)} /></dd></div>
          <div><dt>Median</dt><dd className={tone(s?.median)}><Count value={s?.median} fmt={(v) => pct(v, 1, true)} /></dd></div>
          <div><dt>Selang 95%</dt><dd className="small">{range}</dd></div>
        </dl>
        <p className="muted sg-basis">
          {prefix === "excess" ? `Dihitung sebagai excess return terhadap ${bm}.` : "Return harga mentah, belum dibandingkan dengan benchmark."}
        </p>
      </div>
      <div className="sg-trust">
        <span className="sg-label">Keandalan sampel</span>
        <strong><Count value={n} fmt={(v) => String(Math.round(v))} /> <small>dari {MIN_MATURED} sinyal</small></strong>
        <div className="sg-bar" role="img" aria-label={`${n} dari ${MIN_MATURED} sinyal`}>
          <i data-level={level} style={{ width: on ? `${Math.min(1, n / MIN_MATURED) * 100}%` : "0%" }} />
        </div>
        <span className="sg-badge" data-level={level}>{levelText}</span>
        <p className="muted">{n >= MIN_MATURED ? "Jumlah sinyal cukup untuk dibaca sebagai pola." : `Di bawah ${MIN_MATURED} sinyal, angkanya mudah berubah. Jangan dijadikan dasar kesimpulan.`}</p>
      </div>
    </section>
  );
}

function PerfView({ d, dir, hz, bm }: { d: Performance; dir: string; hz: string; bm: string }) {
  const c = useColors();
  const s = d.stats[dir]?.[hz];
  const col = `${d.prefix}_${hz}d`;
  const rows = useMemo(() => d.rows.filter((r) => r.direction === dir), [d.rows, dir]);
  const hOpt = useMemo(() => horizonOption(c, d.stats[dir]), [c, d.stats, dir]);
  const cRows = d.confirm[dir]?.[hz] ?? [];
  const cOpt = useMemo(() => confirmOption(c, cRows), [c, cRows]);
  const cols: Col<PerfRow>[] = [
    { key: "ticker", label: "Ticker" },
    { key: "period", label: "Periode", get: (r) => `${r.period} ${r.year}` },
    { key: "status", label: "Status", fmt: statusChip },
    { key: "trigger_source", label: "Pemicu" },
    { key: "z", label: "Z-score", num: true, fmt: (v) => num(v, 2) },
    { key: "sur", label: "SUR", num: true, fmt: (v) => num(v, 2) },
    { key: "confirmation", label: "Konfirmasi laba" },
    { key: "detected", label: "Terdeteksi", fmt: (v) => day(v) },
    { key: "entry_price", label: "Harga entry", num: true, fmt: (v) => num(v, 0) },
    { key: col, label: `Return +${hz} hari`, num: true, get: (r) => (r as unknown as Record<string, number | null>)[col], fmt: (v) => <span className={tone(v)}>{pct(v, 1, true)}</span> },
    { key: "flags", label: "Catatan data", get: (r) => r.flags.join(", ") },
  ];
  return (
    <>
      {d.benchmarkMissing && <div className="banner" role="alert">Harga benchmark {bm} tidak ditemukan, return ditampilkan tanpa penyesuaian.</div>}
      <Hero s={s} dir={dir} hz={hz} bm={bm} prefix={d.prefix} />
      <div className="sg-two">
        <Card title="Return menurut lama tahan" i={3} sub="Batang: rata-rata. Garis: selang 95%">
          <Chart option={hOpt} height={300} label="Rata-rata return per lama tahan dengan interval kepercayaan 95%" />
          <p className="sg-note">Jika garis melewati nol, hasilnya belum bisa dibedakan dari kebetulan.</p>
        </Card>
        <Card title="Return menurut konfirmasi laba" i={4} sub={`Lama tahan +${hz} hari`}>
          {cRows.length ? <Chart option={cOpt} height={300} label="Rata-rata return per status konfirmasi laba" /> : <p className="muted">Belum ada sinyal yang matang.</p>}
          <p className="sg-note">CONFIRMED berarti laba ikut mendukung lonjakan pendapatan.</p>
        </Card>
      </div>
      <Card title="Daftar sinyal" i={5} sub={`${rows.length} sinyal`}>
        <DataTable cols={cols} rows={rows} sort={{ key: "detected", dir: -1 }} csv="sinyal.csv" />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- tab pemindaian
function ScanTab() {
  const q = useScanPeriods();
  return (
    <Async q={q} isEmpty={(d) => d.length === 0 && "Belum ada hasil pemindaian. Jalankan run.py fetch terlebih dahulu."}>
      {(ps) => <ScanView periods={ps} />}
    </Async>
  );
}

function Stat({ label, value, color, i }: { label: string; value: number; color?: string; i: number }) {
  return (
    <div className="sg-stat sg-rise" style={{ ...stagger(i), "--c": color ?? "var(--muted)" } as CSSProperties}>
      <span><i aria-hidden />{label}</span>
      <strong><Count value={value} fmt={(v) => String(Math.round(v))} /></strong>
    </div>
  );
}

function Spread({ counts }: { counts: Record<string, number> }) {
  const on = useMounted();
  const total = STATUSES.reduce((t, s) => t + (counts[s] ?? 0), 0) || 1;
  return (
    <div className="sg-spread">
      <div className="sg-spread-bar" role="img" aria-label="Sebaran status sinyal">
        {STATUSES.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
          <i key={s} title={`${s}: ${counts[s]}`} style={{ width: on ? `${((counts[s] ?? 0) / total) * 100}%` : "0%", background: STATUS_COLOR[s] }} />
        ))}
      </div>
      <ul>
        {STATUSES.map((s) => <li key={s}><i style={{ background: STATUS_COLOR[s] }} aria-hidden />{s}<b>{pct((counts[s] ?? 0) / total, 0)}</b></li>)}
      </ul>
    </div>
  );
}

function ScanView({ periods }: { periods: { year: number; period: string }[] }) {
  const [sel, setSel] = useParam("periode", `${periods[0].year}-${periods[0].period}`);
  const [year, period] = sel.split("-");
  const [statuses, setStatuses] = useState(["STRONG", "MODERATE"]);
  const q = useScanResults(Number(year), period);
  const toggle = (s: string) => setStatuses((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const B = (v: number | null) => num(v == null ? null : v / 1e9, 1);
  const cols: Col<ScanRow>[] = [
    { key: "ticker", label: "Ticker" }, { key: "sector", label: "Sektor" },
    { key: "status", label: "Status", fmt: statusChip }, { key: "direction", label: "Arah" },
    { key: "trigger_source", label: "Pemicu" }, { key: "confirmation", label: "Konfirmasi laba" },
    { key: "growth_yoy", label: "Pertumbuhan", num: true, fmt: (v) => pct(v, 1, true) },
    { key: "sector_median_growth", label: "Median sektor", num: true, fmt: (v) => pct(v, 1, true) },
    { key: "z_score", label: "Z-score", num: true, fmt: (v) => num(v, 2) },
    { key: "z_source", label: "Sumber Z", fmt: (v) => ({ PEER: "Peer", HIST: "Riwayat" } as Record<string, string>)[v] ?? "-" },
    { key: "sur", label: "SUR", num: true, fmt: (v) => num(v, 2) },
    { key: "revenue_curr", label: "Pendapatan (miliar)", num: true, fmt: B }, { key: "revenue_prev", label: "Pembanding (miliar)", num: true, fmt: B },
    { key: "net_income_curr", label: "Laba bersih (miliar)", num: true, fmt: B }, { key: "net_income_prev", label: "Pembanding laba (miliar)", num: true, fmt: B },
    { key: "note", label: "Catatan" },
  ];
  return (
    <div className="sg-stack">
      <section className="sg-card sg-controls sg-scan sg-rise" style={stagger(1)} aria-label="Filter pemindaian">
        <Group label="Periode laporan">
          <select value={sel} aria-label="Periode laporan" onChange={(e) => setSel(e.target.value)}>
            {periods.map((p) => <option key={`${p.year}-${p.period}`} value={`${p.year}-${p.period}`}>{p.period} {p.year}</option>)}
          </select>
        </Group>
        <Group label="Tampilkan status">
          <div className="sg-chips">
            {STATUSES.map((s) => (
              <button key={s} type="button" className="sg-chip" aria-pressed={statuses.includes(s)} style={{ "--c": STATUS_COLOR[s] } as CSSProperties} onClick={() => toggle(s)}>
                <i aria-hidden />{s}
              </button>
            ))}
          </div>
        </Group>
      </section>
      <Async q={q}>
        {(d) => {
          const rows = d.rows.filter((r) => statuses.includes(r.status))
            .sort((a, b) => (b.z_score == null ? -1 : a.z_score == null ? 1 : Math.abs(b.z_score) - Math.abs(a.z_score)));
          return (
            <>
              <div className="sg-stats">
                <Stat label="Diperiksa" value={d.rows.length} i={2} />
                <Stat label="STRONG" value={d.counts.STRONG ?? 0} color={STATUS_COLOR.STRONG} i={3} />
                <Stat label="MODERATE" value={d.counts.MODERATE ?? 0} color={STATUS_COLOR.MODERATE} i={4} />
                <Stat label="Tanpa skor" value={d.counts["NO SIGNAL"] ?? 0} color={STATUS_COLOR["NO SIGNAL"]} i={5} />
              </div>
              <Card title="Sebaran status" i={6} sub={`${period} ${year}`}><Spread counts={d.counts} /></Card>
              <Card title="Hasil pemindaian" i={7} sub={`${rows.length} emiten, diurutkan menurut kekuatan Z-score`}>
                <DataTable cols={cols} rows={rows} csv={`pemindaian_${period}_${year}.csv`} />
                <p className="sg-note">Angka triwulan bersifat kumulatif tahun berjalan dan dibandingkan dengan periode yang sama tahun lalu.</p>
              </Card>
            </>
          );
        }}
      </Async>
    </div>
  );
}