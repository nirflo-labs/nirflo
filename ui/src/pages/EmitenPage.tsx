import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useFinancials, usePrices, useScanHistory, useTickerSignals, useTickers } from "../lib/api";
import { day, lowerBound, num, pct, compact, tone } from "../lib/format";
import { store, useColors, useParam, type Palette } from "../lib/hooks";
import type { Annual, AnnualKey, Financials, HistRow, Prices, SignalMark, Ticker } from "../lib/types";
import { baseOption, Chart, line, pts, stack, X, Y, yName } from "../components/Chart";
import { pushRecent } from "../components/TickerSearch";
import { Async, Chip, DataTable, Kpi, Section, Segmented, Tabs, type Col } from "../components/ui";
import RegimeTab from "./RegimeTab";

export default function EmitenPage() {
  const { ticker } = useParams();
  const q = useTickers();
  return (
    <Async q={q} isEmpty={(d) => d.length === 0 && "Belum ada emiten aktif di tabel emitens."}>
      {(list) => <EmitenView list={list} ticker={ticker} />}
    </Async>
  );
}

function EmitenView({ list, ticker }: { list: Ticker[]; ticker?: string }) {
  const [tab, setTab] = useParam("tab", "harga");
  const current = list.find((t) => t.ticker === ticker?.toUpperCase());
  useEffect(() => {
    if (current) {
      store.set("ticker", current.ticker);
      pushRecent(current.ticker);
      document.title = `${current.ticker} · Nirflo`;
    }
  }, [current]);

  if (!ticker) {
    const saved = list.find((t) => t.ticker === store.get("ticker"))?.ticker ?? list[0].ticker;
    return <Navigate replace to={`/emiten/${saved}`} />;
  }
  return (
    <>
      <header className="pagehead">
        {current ? <div><h2>{current.ticker}</h2><p className="muted">{current.sector}</p></div> : <h2>{ticker.toUpperCase()}</h2>}
      </header>
      {!current ? (
        <div className="state empty">Emiten “{ticker}” tidak ditemukan atau tidak aktif. Gunakan pencarian di atas untuk memilih emiten lain.</div>
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: "harga", label: "Harga" }, { id: "keuangan", label: "Laporan keuangan" },
            { id: "sinyal", label: "Sinyal" }, { id: "rezim", label: "Rezim" },
          ]} />
          <div role="tabpanel">
            {tab === "harga" && <PriceTab ticker={current.ticker} />}
            {tab === "keuangan" && <FinancialTab ticker={current.ticker} />}
            {tab === "sinyal" && <SignalTab ticker={current.ticker} />}
            {tab === "rezim" && <RegimeTab key={current.ticker} ticker={current.ticker} />}
          </div>
        </>
      )}
    </>
  );
}

const RANGES: Record<string, number> = { "1 bulan": 31, "3 bulan": 92, "6 bulan": 183, "1 tahun": 365, "3 tahun": 1095, Semua: 0 };

function sma(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0;
  v.forEach((x, i) => { s += x; if (i >= n) s -= v[i - n]; out.push(i >= n - 1 ? s / n : null); });
  return out;
}

function priceOption(c: Palette, p: Prices, days: number, ma: boolean, marks: SignalMark[]) {
  const n = p.x.length;
  const cut = days ? new Date(new Date(p.x[n - 1]).getTime() - days * 864e5).toISOString().slice(0, 10) : "";
  const i0 = days ? lowerBound(p.x, cut) : 0;
  const x = p.x.slice(i0), close = p.close.slice(i0);
  const s = stack(c, 480, [76, 24], ["", ""]);
  s.yAxis[0] = { ...s.yAxis[0], name: "", axisLabel: { color: c.muted, formatter: (v: number) => num(v, 0) } };
  s.yAxis[1] = {
    ...s.yAxis[1], name: "", scale: false, splitNumber: 2, splitLine: { show: false },
    axisLabel: { color: c.muted, formatter: (v: number) => compact(v) },
  };

  const fill = { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${c.accent}40` }, { offset: 1, color: `${c.accent}00` }] };
  const series: object[] = [
    line("Penutupan", x, close, c.accent, { lineStyle: { width: 1.6, color: c.accent }, areaStyle: { color: fill } }),
  ];
  if (ma) {
    series.push(line("MA 50", x, sma(p.close, 50).slice(i0), c.accent2, { lineStyle: { width: 1, type: "dotted", color: c.accent2 } }));
    series.push(line("MA 200", x, sma(p.close, 200).slice(i0), c.muted, { lineStyle: { width: 1, type: "dotted", color: c.muted } }));
  }
  const hits = marks.flatMap((m) => {
    const i = lowerBound(x, m.detected.slice(0, 10));
    return i < x.length && m.detected >= x[0] ? [{ value: [x[i], close[i]], name: `${m.period} ${m.year} ${m.status}` }] : [];
  });
  if (hits.length) {
    series.push({ type: "scatter", name: "Sinyal", data: hits, symbol: "triangle", symbolSize: 11, itemStyle: { color: c.up },
      tooltip: { trigger: "item", formatter: (q: { name: string }) => q.name } });
  }
  const vol = p.x.flatMap((d, g) =>
    g < i0 || p.noTrade[g] ? [] : [{
      value: [d, p.volume[g]],
      itemStyle: { color: g === 0 || p.close[g] >= p.close[g - 1] ? c.up : c.down, opacity: 0.6 },
    }],
  );
  series.push({ type: "bar", name: "Volume", xAxisIndex: 1, yAxisIndex: 1, data: vol });

  const base = baseOption(c, {
    ...s,
    series,
    legend: {
      show: ma || hits.length > 0, top: 0, icon: "roundRect",
      data: series.slice(0, -1).map((o) => (o as { name: string }).name), textStyle: { color: c.muted },
    },
  }) as Record<string, unknown>;

  const formatter = (ps: { seriesName: string; marker: string; value: [string, number | null] }[]) => {
    const head = day(String(ps[0]?.value?.[0] ?? ""));
    const rows = ps
      .filter((q) => q.seriesName !== "Sinyal" && q.value?.[1] != null)
      .map((q) => `${q.marker}${q.seriesName}: <b>${q.seriesName === "Volume" ? compact(q.value[1] as number) : num(q.value[1] as number, 0)}</b>`);
    return [head, ...rows].join("<br/>");
  };
  return { ...base, tooltip: { ...(base.tooltip as object), formatter } };
}

function PriceTab({ ticker }: { ticker: string }) {
  const q = usePrices(ticker);
  const sig = useTickerSignals(ticker);
  return (
    <Async q={q} isEmpty={(d) => d.x.length === 0 && "Belum ada data harga untuk emiten ini."}>
      {(p) => <PriceView p={p} marks={sig.data ?? []} />}
    </Async>
  );
}

function PriceView({ p, marks }: { p: Prices; marks: SignalMark[] }) {
  const c = useColors();
  const [range, setRange] = useParam("range", "1 tahun");
  const [ma, setMa] = useParam("ma", "0");
  const n = p.close.length, last = p.close[n - 1];
  const chg = (k: number) => (n > k && p.close[n - 1 - k] > 0 ? last / p.close[n - 1 - k] - 1 : null);
  const year = p.close.slice(-252);
  const option = useMemo(() => priceOption(c, p, RANGES[range] ?? 0, ma === "1", marks), [c, p, range, ma, marks]);
  return (
    <>
      <div className="kpis">
        <Kpi label="Penutupan terakhir" value={num(last, 0)} hint={`Per ${day(p.x[n - 1])}`} />
        {([["1 hari", 1], ["1 bulan", 21], ["1 tahun", 252]] as const).map(([l, k]) => (
          <Kpi key={l} label={l} value={pct(chg(k), 1, true)} tone={tone(chg(k))} />
        ))}
        <Kpi label="Kisaran 52 minggu" value={`${num(Math.min(...year), 0)} - ${num(Math.max(...year), 0)}`} />
      </div>
      <div className="toolbar">
        <Segmented label="Rentang" value={range} onChange={setRange} options={Object.keys(RANGES).map((k) => ({ value: k, label: k }))} />
        <label className="switch">
          <input type="checkbox" checked={ma === "1"} onChange={(e) => setMa(e.target.checked ? "1" : "0")} />
          <span>MA 50 &amp; 200</span>
        </label>
      </div>
      <div className="card">
        <Chart option={option} height={480} label={`Grafik harga penutupan dan volume, ${range}`} />
        <p className="muted small">Ctrl + scroll atau cubit untuk zoom, seret untuk menggeser.</p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Laporan keuangan
const AMOUNTS: [AnnualKey, string][] = [
  ["revenue", "Pendapatan"], ["gross_profit", "Laba kotor"], ["operating_profit", "Laba sebelum pajak"], ["net_income", "Laba bersih"],
  ["operating_cash_flow", "Arus kas operasi"], ["capital_expenditure", "Belanja modal"], ["total_assets", "Total aset"],
  ["total_liabilities", "Total liabilitas"], ["total_equity", "Total ekuitas"], ["cash_and_equivalents", "Kas dan setara kas"],
];
const RATIOS: [AnnualKey, string, "pct" | "x"][] = [
  ["revenue_yoy", "Pertumbuhan pendapatan YoY", "pct"], ["net_income_yoy", "Pertumbuhan laba bersih YoY", "pct"],
  ["gross_margin", "Margin laba kotor", "pct"], ["net_margin", "Margin laba bersih", "pct"],
  ["roe", "ROE (laba bersih / ekuitas akhir)", "pct"], ["der", "Liabilitas / ekuitas (x)", "x"],
];
const VIEWS = {
  laba: [["revenue", "Pendapatan"], ["net_income", "Laba bersih"]],
  neraca: [["total_assets", "Total aset"], ["total_liabilities", "Total liabilitas"], ["total_equity", "Ekuitas"]],
  kas: [["operating_cash_flow", "Arus kas operasi"], ["capital_expenditure", "Belanja modal"]],
} as const;

function financeOption(c: Palette, a: Annual, view: keyof typeof VIEWS, unit: string) {
  const colors = [c.accent, c.accent2, c.muted];
  const series: object[] = VIEWS[view].map(([k, name], i) => ({ type: "bar", name, data: a[k], itemStyle: { color: colors[i] }, barMaxWidth: 36 }));
  const yAxis: object[] = [Y(c, { ...yName(unit, 56), scale: false })];
  if (view === "laba") {
    yAxis.push(Y(c, { ...yName("Margin (%)", 40), splitLine: { show: false } }));
    series.push({ type: "line", name: "Margin laba bersih (%)", yAxisIndex: 1, data: a.net_margin.map((v) => (v == null ? null : v * 100)), itemStyle: { color: c.up }, lineStyle: { color: c.up, width: 1.5 } });
  }
  return baseOption(c, { grid: { left: 70, right: view === "laba" ? 56 : 16, top: 36, bottom: 28 }, xAxis: { type: "category", data: a.label, axisLabel: { color: c.muted } }, yAxis, series });
}

type StmtRow = { metric: string; kind: "amt" | "pct" | "x"; [year: string]: unknown };

function FinancialTab({ ticker }: { ticker: string }) {
  const q = useFinancials(ticker);
  return (
    <Async q={q} isEmpty={(d) => !d.annual && "Belum ada laporan tahunan untuk emiten ini."}>
      {(d) => <FinancialView d={d} />}
    </Async>
  );
}

function FinancialView({ d }: { d: Financials }) {
  const c = useColors();
  const [view, setView] = useParam("view", "laba");
  const a = d.annual!, unit = d.unit ?? "Rp miliar";
  const option = useMemo(() => financeOption(c, a, view as keyof typeof VIEWS, unit), [c, a, view, unit]);
  const rows = useMemo<StmtRow[]>(() => {
    const cells = (k: AnnualKey) => Object.fromEntries(a.label.map((y, i) => [y, a[k][i]]));
    return [
      ...AMOUNTS.map(([k, l]): StmtRow => ({ metric: `${l} (${unit})`, kind: "amt", ...cells(k) })),
      ...RATIOS.map(([k, l, kind]): StmtRow => ({ metric: l, kind, ...cells(k) })),
    ];
  }, [a, unit]);
  const cols: Col<StmtRow>[] = [
    { key: "metric", label: "Metrik" },
    ...a.label.map((y): Col<StmtRow> => ({ key: y, label: y, num: true, fmt: (v: number | null, r) => (r.kind === "pct" ? pct(v) : num(v, r.kind === "x" ? 2 : 1)) })),
  ];
  return (
    <>
      <div className="toolbar">
        <Segmented label="Jenis laporan" value={view} onChange={setView} options={[{ value: "laba", label: "Laba rugi" }, { value: "neraca", label: "Neraca" }, { value: "kas", label: "Arus kas" }]} />
      </div>
      <Chart option={option} label={`Grafik ${view} tahunan`} />
      <Section title="Ringkasan tahunan"><DataTable cols={cols} rows={rows} csv="laporan_tahunan.csv" /></Section>
      {d.ytd && (
        <Section title={`Tahun berjalan (kumulatif ${d.ytd.period} ${d.ytd.year})`}>
          <DataTable csv="ytd.csv" rows={d.ytd.rows} cols={[
            { key: "name", label: `Item (${unit})` },
            { key: "before", label: `${d.ytd.period} ${d.ytd.year - 1}`, num: true, fmt: (v) => num(v, 1) },
            { key: "now", label: `${d.ytd.period} ${d.ytd.year}`, num: true, fmt: (v) => num(v, 1) },
            { key: "growth", label: "Pertumbuhan", num: true, fmt: (v) => <span className={tone(v)}>{pct(v, 1, true)}</span> },
          ]} />
        </Section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Sinyal per emiten
export const statusChip = (v: string | null) => (v ? <Chip kind={v.toLowerCase().replace(" ", "-")}>{v}</Chip> : "-");

function SignalTab({ ticker }: { ticker: string }) {
  const q = useScanHistory(ticker);
  const cols: Col<HistRow>[] = [
    { key: "period", label: "Periode", get: (r) => `${r.period} ${r.year}` },
    { key: "status", label: "Status", fmt: statusChip },
    { key: "trigger_source", label: "Pemicu" },
    { key: "direction", label: "Arah" },
    { key: "confirmation", label: "Konfirmasi laba" },
    { key: "growth_yoy", label: "Pertumbuhan", num: true, fmt: (v) => pct(v, 1, true) },
    { key: "z_score", label: "Z-score", num: true, fmt: (v) => num(v, 2) },
    { key: "sur", label: "SUR", num: true, fmt: (v) => num(v, 2) },
  ];
  return (
    <Async q={q} isEmpty={(d) => d.length === 0 && "Belum ada hasil pemindaian untuk emiten ini."}>
      {(rows) => <DataTable cols={cols} rows={rows} csv="riwayat_pemindaian.csv" />}
    </Async>
  );
}

export { pts as _pts, X as _X }; // dipertahankan agar tree-shaking tidak mengeluh bila dipakai ulang