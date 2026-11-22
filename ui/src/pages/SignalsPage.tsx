import { useMemo, useState } from "react";
import { usePerformance, useScanPeriods, useScanResults } from "../lib/api";
import { daysAgo, day, num, pct, tone } from "../lib/format";
import { useColors, useParam, type Palette } from "../lib/hooks";
import { HORIZONS, type Performance, type PerfRow, type ScanRow, type Summary } from "../lib/types";
import { baseOption, Chart, Y, yName } from "../components/Chart";
import { Async, DataTable, Kpi, Section, Tabs, TextField, type Col } from "../components/ui";
import { statusChip } from "./EmitenPage";

const STATUSES = ["STRONG", "MODERATE", "WEAK", "NO SIGNAL"];
const MIN_MATURED = 30;

export default function SignalsPage() {
  const [tab, setTab] = useParam("tab", "kinerja");
  return (
    <>
      <h2>Sinyal</h2>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "kinerja", label: "Kinerja sinyal" }, { id: "scan", label: "Hasil pemindaian" }]} />
      {tab === "kinerja" ? <PerformanceTab /> : <ScanTab />}
    </>
  );
}

function PerformanceTab() {
  const [since, setSince] = useParam("since", daysAgo(365));
  const [hz, setHz] = useParam("hz", "20");
  const [dir, setDir] = useParam("dir", "POSITIVE");
  const [bm, setBm] = useParam("bm", "");
  const [lag, setLag] = useParam("lag", "");
  const [gap, setGap] = useParam("gap", "");
  const q = usePerformance({ since, benchmark: bm.toUpperCase() || undefined, entry_lag: lag || undefined, max_gap: gap || undefined });
  const a = q.data?.assumptions;
  return (
    <>
      <div className="formgrid">
        <label className="field"><span>Sejak</span><input type="date" value={since} max={daysAgo(0)} onChange={(e) => e.target.value && setSince(e.target.value)} /></label>
        <label className="field"><span>Lama tahan</span>
          <select value={hz} onChange={(e) => setHz(e.target.value)}>{HORIZONS.map((h) => <option key={h} value={h}>+{h} hari bursa</option>)}</select>
        </label>
        <label className="field"><span>Arah</span>
          <select value={dir} onChange={(e) => setDir(e.target.value)}>{["POSITIVE", "NEGATIVE", "MIXED"].map((d) => <option key={d}>{d}</option>)}</select>
        </label>
        <TextField label="Benchmark (kode di daily_prices)" value={bm} onChange={setBm} placeholder="mis. IHSG.JK" />
      </div>
      <details className="card">
        <summary>Asumsi entry</summary>
        <div className="formgrid">
          <TextField label="Entry lag (hari bursa)" value={lag} onChange={setLag} placeholder={a ? String(a.entryLag) : "default"} />
          <TextField label="Batas jeda entry (hari)" value={gap} onChange={setGap} placeholder={a ? String(a.maxGap) : "default"} />
        </div>
      </details>
      <Async q={q} isEmpty={(d) => (!d.available ? "Kinerja sinyal memerlukan koneksi database dan belum tersedia pada mode snapshot." : d.rows.length === 0 && "Belum ada sinyal pada rentang ini.")}>
        {(d) => <PerfView d={d} dir={dir} hz={hz} bm={bm.toUpperCase()} />}
      </Async>
    </>
  );
}

function horizonOption(c: Palette, stats: Record<string, Summary>) {
  const hs = HORIZONS.map((h) => stats[String(h)]);
  return baseOption(c, {
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

function PerfView({ d, dir, hz, bm }: { d: Performance; dir: string; hz: string; bm: string }) {
  const c = useColors();
  const s = d.stats[dir]?.[hz];
  const negative = dir === "NEGATIVE";
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
      <div className="kpis">
        <Kpi label="Sinyal matang" value={s?.n ?? 0} hint={`Sinyal yang sudah mencapai +${hz} hari bursa.`} />
        <Kpi label="Rata-rata" value={pct(s?.mean, 1, true)} tone={tone(s?.mean)} />
        <Kpi label="Median" value={pct(s?.median, 1, true)} tone={tone(s?.median)} />
        <Kpi label={negative ? "Turun" : "Naik"} value={pct(s?.win, 0)} hint="Porsi sinyal yang bergerak sesuai arah tesis." />
      </div>
      {d.benchmarkMissing && <div className="banner" role="alert">Harga benchmark {bm} tidak ditemukan, return ditampilkan tanpa penyesuaian.</div>}
      {(s?.n ?? 0) < MIN_MATURED && <p className="muted">Sampel {s?.n ?? 0} masih di bawah {MIN_MATURED}; belum cukup untuk menarik kesimpulan.</p>}
      <div className="two">
        <Section title="Return menurut lama tahan"><Chart option={hOpt} height={320} label="Rata-rata return per lama tahan dengan interval kepercayaan 95%" /></Section>
        <Section title="Return menurut konfirmasi laba">
          {cRows.length ? <Chart option={cOpt} height={320} label="Rata-rata return per status konfirmasi laba" /> : <p className="muted">Belum ada sinyal yang matang.</p>}
        </Section>
      </div>
      <DataTable cols={cols} rows={rows} sort={{ key: "detected", dir: -1 }} csv="sinyal.csv" />
    </>
  );
}

function ScanTab() {
  const q = useScanPeriods();
  return (
    <Async q={q} isEmpty={(d) => d.length === 0 && "Belum ada hasil pemindaian. Jalankan run.py fetch terlebih dahulu."}>
      {(ps) => <ScanView periods={ps} />}
    </Async>
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
    <>
      <div className="toolbar">
        <label className="field"><span>Periode</span>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {periods.map((p) => <option key={`${p.year}-${p.period}`} value={`${p.year}-${p.period}`}>{p.period} {p.year}</option>)}
          </select>
        </label>
        <fieldset className="chips"><legend>Status</legend>
          {STATUSES.map((s) => <label key={s} className="check"><input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(s)} /> {s}</label>)}
        </fieldset>
      </div>
      <Async q={q}>
        {(d) => {
          const rows = d.rows.filter((r) => statuses.includes(r.status))
            .sort((a, b) => (b.z_score == null ? -1 : a.z_score == null ? 1 : Math.abs(b.z_score) - Math.abs(a.z_score)));
          return (
            <>
              <div className="kpis">
                <Kpi label="Diperiksa" value={d.rows.length} />
                <Kpi label="STRONG" value={d.counts.STRONG ?? 0} />
                <Kpi label="MODERATE" value={d.counts.MODERATE ?? 0} />
                <Kpi label="Tanpa skor" value={d.counts["NO SIGNAL"] ?? 0} />
              </div>
              <DataTable cols={cols} rows={rows} csv={`pemindaian_${period}_${year}.csv`} />
              <p className="muted">Angka triwulan bersifat kumulatif tahun berjalan dan dibandingkan dengan periode yang sama tahun lalu.</p>
            </>
          );
        }}
      </Async>
    </>
  );
}