import { useMemo, useState } from "react";
import { useRegime } from "../lib/api";
import { num, pct } from "../lib/format";
import { useColors, type Palette } from "../lib/hooks";
import type { RegimeParams, RegimeReady } from "../lib/types";
import { baseOption, Chart, line, pts, stack, Y, yName, X } from "../components/Chart";
import { DataGrid, ErrorState, Loading, NumberField, Section, Segmented } from "../components/ui";

// Samakan dengan RegimeConfig() di regime_signal.py
type Form = { enter: number; exit: number; vol: number; refit: number; lag: number; smooth: number; band: number; rf: number; size: boolean };
const DEFAULTS: Form = { enter: 0.7, exit: 0.4, vol: 0.15, refit: 21, lag: 2, smooth: 1, band: 0, rf: 0, size: true };
const toApi = (f: Form): RegimeParams => ({
  enter_prob: f.enter, exit_prob: f.exit, vol_target: f.vol, refit_every: f.refit, execution_lag: f.lag,
  prob_smooth_span: f.smooth, rebalance_band: f.band, risk_free: f.rf / 100, size_by_prob: f.size,
});
const RANGES: Record<string, number | null> = { "1 tahun": 365, "3 tahun": 1095, "5 tahun": 1825, Semua: null };

const EQUITY = [["buy_hold", "Buy and hold"], ["macd_only", "MACD saja"], ["mrs_only", "MRS saja"], ["macd_mrs", "MACD + MRS"]] as const;

function equityOption(c: Palette, e: RegimeReady["equity"]) {
  const colors = [c.muted, c.accent2, c.warn, c.up];
  return baseOption(c, {
    grid: { left: 64, right: 16, top: 36, bottom: 28 },
    xAxis: X(c), yAxis: Y(c, yName("Ekuitas bersih (awal = 1)", 44)),
    dataZoom: [{ type: "inside" }],
    series: EQUITY.map(([k, name], i) => {
      const base = e[k].find((v) => v != null) ?? 1;
      return line(name, e.x, e[k].map((v) => (v == null ? null : v / base)), colors[i], {
        lineStyle: { width: k === "macd_mrs" ? 2.2 : 1.2, color: colors[i] },
        ...(i === 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: c.muted }, data: [{ yAxis: 1 }] } } : {}),
      });
    }),
  });
}

function gateRuns(x: string[], gate: (number | null)[]) {
  const runs: [string, string][] = [];
  let start: string | null = null;
  gate.forEach((g, i) => {
    const on = (g ?? 0) > 0.5;
    if (on && start == null) start = x[i];
    if (start != null && (!on || i === gate.length - 1)) { runs.push([start, on ? x[i] : x[i - 1]]); start = null; }
  });
  return runs;
}

function signalOption(c: Palette, r: RegimeReady) {
  const { comp, position, events, thresholds } = r;
  const s = stack(c, 820, [46, 20, 17, 17], ["Harga", "MACD", "P(tenang)", "Posisi"]);
  s.yAxis[2] = { ...s.yAxis[2], min: 0, max: 1 };
  const marker = (name: string, key: keyof typeof events, symbol: string, color: string, extra: object = {}) => ({
    type: "scatter", name, xAxisIndex: 0, yAxisIndex: 0, symbol, symbolSize: 10, itemStyle: { color }, data: pts(events[key].x, events[key].y), ...extra,
  });
  const price = line("Penutupan", comp.x, comp.close, c.accent, {
    xAxisIndex: 0, yAxisIndex: 0,
    markArea: { silent: true, itemStyle: { color: c.gate }, data: gateRuns(comp.x, comp.gate).map(([a, b]) => [{ xAxis: a }, { xAxis: b }]) },
  });
  const hist = {
    type: "bar", name: "Histogram MACD", xAxisIndex: 1, yAxisIndex: 1,
    data: comp.x.map((d, i) => ({ value: [d, comp.hist[i]], itemStyle: { color: (comp.gate[i] ?? 0) < 0.5 ? c.muted : (comp.hist[i] ?? 0) >= 0 ? c.up : c.down } })),
  };
  const calm = line("P(tenang) t+1", comp.x, comp.calm, c.accent2, {
    xAxisIndex: 2, yAxisIndex: 2,
    markLine: { silent: true, symbol: "none", label: { show: false }, data: [{ yAxis: thresholds.enter, lineStyle: { color: c.up, type: "dotted" } }, { yAxis: thresholds.exit, lineStyle: { color: c.down, type: "dotted" } }] },
  });
  const pos = line("Posisi", position.x, position.macd_mrs, c.up, { xAxisIndex: 3, yAxisIndex: 3, areaStyle: { opacity: 0.25 }, lineStyle: { width: 1, color: c.up } });
  return baseOption(c, {
    ...s,
    legend: { top: 0, data: ["Penutupan", "Masuk", "Keluar", "MACD naik, diblokir rezim"], textStyle: { color: c.muted } },
    series: [price, marker("Masuk", "entries", "triangle", c.up), marker("Keluar", "exits", "triangle", c.down, { symbolRotate: 180 }),
      marker("MACD naik, diblokir rezim", "blocked", "circle", c.muted, { itemStyle: { color: "transparent", borderColor: c.muted, borderWidth: 1.5 } }), hist, calm, pos],
  });
}

const P1S = (v: number) => pct(v, 1, true);
const FMT = {
  metrics: {
    "Return bersih total": P1S, "Return kotor total": P1S, CAGR: P1S, Volatilitas: (v: number) => pct(v, 1), Sharpe: (v: number) => num(v, 2),
    "Sharpe kotor": (v: number) => num(v, 2), "Max drawdown": (v: number) => pct(v, 1), "Turnover tahunan": (v: number) => `${num(v, 1)}x`,
    Eksposur: (v: number) => pct(v, 0), "Rata-rata posisi": (v: number) => num(v, 2), "Jumlah entry": (v: number) => num(v, 0),
  },
  conditional: { "Sharpe MACD saja": (v: number) => num(v, 2), "Rata-rata harian MACD (%)": (v: number) => num(v, 3), "Rata-rata harian buy-hold (%)": (v: number) => num(v, 3) },
  summary: {
    "Volatilitas tahunan": (v: number) => pct(v, 1), "Rata-rata harian": (v: number) => pct(v, 3, true), "Peluang bertahan": (v: number) => pct(v, 1),
    "Durasi rata-rata (hari)": (v: number) => num(v, 1), "Porsi waktu": (v: number) => pct(v, 0),
  },
  fits: new Proxy({}, { get: () => (v: unknown) => (typeof v === "number" ? num(v, 4) : String(v ?? "-")) }) as Record<string, (v: number) => string>,
};

export default function RegimeTab({ ticker }: { ticker: string }) {
  const [f, setF] = useState(DEFAULTS);
  const [run, setRun] = useState(false);
  const [range, setRange] = useState("Semua");
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const q = useRegime(ticker, toApi(f), RANGES[range], run);

  return (
    <>
      <div className="formgrid">
        <NumberField label="Masuk jika P(tenang) >" value={f.enter} onChange={set("enter")} min={0.5} max={0.95} step={0.05} />
        <NumberField label="Keluar jika P(tenang) <" value={f.exit} onChange={set("exit")} min={0.05} max={0.6} step={0.05} />
        <NumberField label="Target volatilitas tahunan" value={f.vol} onChange={set("vol")} min={0.05} max={0.5} step={0.01} />
        <NumberField label="Refit tiap (hari bursa)" value={f.refit} onChange={set("refit")} min={5} max={63} step={1} hint="Mengubah ini memicu hitung ulang penuh" />
        <label className="field">
          <span>Eksekusi</span>
          <select value={f.lag} onChange={(e) => set("lag")(Number(e.target.value))}>
            <option value={1}>Close hari sinyal</option><option value={2}>Close hari berikutnya</option>
          </select>
        </label>
        <NumberField label="Haluskan P(tenang) (EMA hari)" value={f.smooth} onChange={set("smooth")} min={1} max={30} step={1} />
        <NumberField label="Zona tanpa transaksi" value={f.band} onChange={set("band")} min={0} max={0.3} step={0.01} />
        <NumberField label="Bunga kas tahunan (%)" value={f.rf} onChange={set("rf")} min={0} max={15} step={0.25} />
        <label className="check"><input type="checkbox" checked={f.size} onChange={(e) => set("size")(e.target.checked)} /> Posisi dikali P(tenang)</label>
      </div>
      <div className="toolbar">
        <button className="primary" onClick={() => setRun(true)} disabled={run && q.isFetching && !q.isPlaceholderData}>Jalankan analisis rezim</button>
        <button onClick={() => setF(DEFAULTS)}>Kembalikan default</button>
      </div>

      {!run ? (
        <p className="muted">Analisis memakai walk-forward expanding window, jadi perhitungan pertama untuk satu emiten memerlukan waktu (hasilnya disimpan 1 jam). Mengubah parameter lain setelahnya langsung terasa.</p>
      ) : q.isPending ? <Loading label="Menghubungi server…" />
        : q.isError ? <ErrorState error={q.error} />
        : q.data.state === "running" ? <Loading label={`Menghitung walk-forward rezim… ${Math.round(q.data.elapsed)} dtk. Bisa sampai satu menit; halaman ini tidak perlu ditinggalkan.`} />
        : <div className={q.isPlaceholderData ? "stale" : ""} aria-busy={q.isPlaceholderData}>
            <RegimeView r={q.data} range={range} setRange={setRange} />
          </div>}
    </>
  );
}

function RegimeView({ r, range, setRange }: { r: RegimeReady; range: string; setRange: (v: string) => void }) {
  const c = useColors();
  const eq = useMemo(() => equityOption(c, r.equity), [c, r.equity]);
  const sig = useMemo(() => signalOption(c, r), [c, r]);
  return (
    <>
      <div className="toolbar">
        <Segmented label="Rentang" value={range} onChange={setRange} options={Object.keys(RANGES).map((k) => ({ value: k, label: k }))} />
      </div>
      <Section title="Kurva ekuitas bersih">
        <Chart option={eq} height={360} label="Kurva ekuitas bersih empat strategi, dinormalisasi ke 1" />
      </Section>
      <Section title="Sinyal, rezim, dan posisi MACD + MRS">
        <Chart option={sig} height={820} label="Harga dengan titik masuk dan keluar, histogram MACD, probabilitas rezim tenang, dan posisi" />
        <p className="muted">Latar hijau: gate rezim tenang aktif. Segitiga: eksekusi masuk dan keluar pada harga penutupan. Lingkaran abu-abu: MACD berbalik naik tetapi diblokir rezim.</p>
      </Section>
      <Section title="Kinerja setelah biaya pada rentang terpilih"><DataGrid data={r.metrics} fmt={FMT.metrics} /></Section>
      <Section title="Uji asumsi: apakah MACD memang lebih baik di rezim tenang?"><DataGrid data={r.conditional} fmt={FMT.conditional} /></Section>
      <Section title="Model statistik rezim (median seluruh refit)">
        <DataGrid data={r.summary} fmt={FMT.summary} />
        {r.volatileDuration < r.minDuration && (
          <div className="banner" role="alert">
            Rezim gejolak rata-rata hanya bertahan {num(r.volatileDuration, 1)} hari. Model kemungkinan menangkap hari-hari ekstrem satu per satu, bukan rezim volatilitas. Coba haluskan P(tenang) atau perbesar zona tanpa transaksi.
          </div>
        )}
      </Section>
      <p className="muted">
        Gate berpindah {num(r.switchesPerYear, 1)}x per tahun. Refit berhasil {r.refits}x. Periode evaluasi {r.period[0]} sampai {r.period[1]}.
      </p>
      <details className="card"><summary>Riwayat estimasi tiap refit</summary><DataGrid data={r.fits} fmt={FMT.fits} /></details>
    </>
  );
}