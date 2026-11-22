import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { slim, MAX_SEND, type CtxItem, type CtxKind } from "./aiContext";
import type { Evaluation, Holding, PfSummary, SharpeBlock } from "./portfolio";
import type { AnnualKey, Financials, HistRow, MacroRow, Prices, ScanPeriod, ScanResults } from "./types";

/**
 * Mengambil data untuk satu pertanyaan, hanya dari endpoint yang sama dengan yang dipakai halaman Nirflo
 * (hasilnya dibagi lewat cache query yang sama). Semua bersifat baca-saja. Pengguna tidak perlu membuka halamannya.
 */
type Scope = "off" | "public" | "portfolio";
type Job = { id: string; kind: CtxKind; label: string; run: () => Promise<unknown> };

const MIN = 60_000;
const MAX_TICKERS = 3;
const enc = encodeURIComponent;

const get = <T,>(qc: QueryClient, key: unknown[], path: string, min = 5) =>
  qc.fetchQuery({ queryKey: key, queryFn: ({ signal }) => api<T>(path, undefined, { signal }), staleTime: min * MIN });

const FIN_WORDS = /laba|pendapatan|keuangan|laporan|revenue|margin|roe|aset|liabilitas|ekuitas|arus kas|der\b|fundamental/i;
const SIGNAL_WORDS = /sinyal|signal|z-?score|\bsur\b|pemindai|scan/i;
const MACRO_WORDS = /makro|macro|ihsg|kurs|usd|rupiah|dolar|suku bunga|bunga|inflasi|cpi|komoditas|emas|gold|minyak|brent|batubara|coal|nikel|tembaga|dxy|vix|pdb|cadangan devisa/i;
const PORTFOLIO_WORDS = /portofolio|portfolio|sharpe|bobot|korelasi|cash|risiko|posisi|saham saya|holding/i;

const LINES: [AnnualKey, string][] = [
  ["revenue", "Pendapatan"], ["gross_profit", "Laba kotor"], ["operating_profit", "Laba sebelum pajak"], ["net_income", "Laba bersih"],
  ["operating_cash_flow", "Arus kas operasi"], ["capital_expenditure", "Belanja modal"], ["total_assets", "Total aset"],
  ["total_liabilities", "Total liabilitas"], ["total_equity", "Total ekuitas"], ["cash_and_equivalents", "Kas dan setara kas"],
  ["revenue_yoy", "Pertumbuhan pendapatan YoY"], ["net_income_yoy", "Pertumbuhan laba bersih YoY"],
  ["gross_margin", "Margin laba kotor"], ["net_margin", "Margin laba bersih"], ["roe", "ROE"], ["der", "Liabilitas / ekuitas (x)"],
];

const sma = (v: number[], n: number) => (v.length < n ? null : v.slice(-n).reduce((s, x) => s + x, 0) / n);

function priceSnap(ticker: string, p: Prices) {
  const n = p.close.length, last = p.close[n - 1];
  const chg = (k: number) => (n > k && p.close[n - 1 - k] > 0 ? last / p.close[n - 1 - k] - 1 : null);
  const year = p.close.slice(-252);
  return {
    ticker, as_of: p.x[n - 1], last_close: last, change_1d: chg(1), change_1m: chg(21), change_1y: chg(252),
    high_52w: Math.max(...year), low_52w: Math.min(...year), sma_50: sma(p.close, 50), sma_200: sma(p.close, 200),
  };
}

function finSnap(ticker: string, d: Financials) {
  const a = d.annual;
  if (!a) return null;
  return {
    ticker, unit: d.unit ?? "Rp miliar", years: a.label.slice(-6),
    annual: Object.fromEntries(LINES.map(([k, l]) => [l, a[k].slice(-6)])),
    ytd: d.ytd && { period: d.ytd.period, year: d.ytd.year, rows: d.ytd.rows },
  };
}

const sigSnap = (rows: HistRow[]) => rows.slice(0, 6).map((r) => ({
  period: `${r.period} ${r.year}`, status: r.status, trigger: r.trigger_source, direction: r.direction,
  confirmation: r.confirmation, growth_yoy: r.growth_yoy, z_score: r.z_score, sur: r.sur,
}));

function macroSnap(rows: MacroRow[], question: string) {
  const q = question.toLowerCase();
  const wanted = new Set(["IHSG", "USDIDR", "ID_RATE"]);
  rows.forEach((r) => {
    if (q.includes(r.key.toLowerCase()) || (r.name && q.includes(r.name.toLowerCase()))) wanted.add(r.key);
  });
  return rows.filter((r) => wanted.has(r.key)).slice(0, 10).map((r) => ({
    key: r.key, name: r.name, source: r.source, last_date: r.last_date, last_value: r.last_value, change_1m: r.change1m, change_12m: r.change12m,
  }));
}

const sharpe = (b: SharpeBlock | null) =>
  b && { sharpe: b.sharpe, ci_low: b.ci_low, ci_high: b.ci_high, verdict: b.verdict, annual_excess_return: b.annual_excess_return, annual_vol: b.annual_vol, n_obs: b.n_obs };

async function portfolioSnap(qc: QueryClient, sectors: Map<string, string>) {
  const list = await get<PfSummary[]>(qc, ["pf", "list"], "/portfolio", 1);
  const name = list.find((p) => p.name === "default")?.name ?? list[0]?.name;
  if (!name) return null;
  const rows = await get<Holding[]>(qc, ["pf", "holdings", name], `/portfolio/${enc(name)}/holdings`, 1);
  if (!rows.length) return { portfolio: name, catatan: "portofolio masih kosong" };
  const e = await qc.fetchQuery({
    queryKey: ["pf", "eval", name, "full"],
    queryFn: ({ signal }) => api<Evaluation>(`/portfolio/${enc(name)}/evaluate`, { mode: "full" }, { signal }),
    staleTime: 5 * MIN,
  });
  const lots = new Map<string, number>();
  rows.forEach((h) => lots.set(h.ticker, (lots.get(h.ticker) ?? 0) + h.lots));
  const order = [...lots.keys()].sort((a, b) => (e.weights[b] ?? 0) - (e.weights[a] ?? 0));
  return {
    portfolio: name, as_of: e.as_of, mode: e.mode,
    catatan: "bobot dan kontribusi risiko dihitung dari bagian saham saja (jumlah 100%)",
    stocks: order.map((t) => ({ ticker: t, sector: sectors.get(t), lots: lots.get(t), weight: e.weights[t], risk_contribution: e.risk_contribution[t] })),
    sharpe: { since_buy: sharpe(e.sharpe.since_buy), current_weights: sharpe(e.sharpe.current_weights), equal_weight: sharpe(e.sharpe.equal_weight) },
    correlation_average: e.correlation.average,
    cash: e.cash && { weight: e.cash.weight, idr: e.cash.idr, usd: e.cash.usd, usd_idr: e.cash.fx?.rate },
    portfolio_risk: e.portfolio_risk,
    warnings: e.warnings.slice(0, 8),
  };
}

export function planContext(question: string, scope: Scope, qc: QueryClient, tickers: { ticker: string; sector?: string | null }[]): Job[] {
  if (scope === "off") return [];
  const known = new Set(tickers.map((t) => t.ticker));
  const sectors = new Map(tickers.flatMap((t) => (t.sector ? [[t.ticker, t.sector] as [string, string]] : [])));
  const mentioned = [...new Set(question.toUpperCase().match(/\b[A-Z]{4}\b/g) ?? [])].filter((t) => known.has(t)).slice(0, MAX_TICKERS);

  const jobs: Job[] = [];
  const wantsFin = FIN_WORDS.test(question), wantsSig = SIGNAL_WORDS.test(question);
  for (const t of mentioned) {
    jobs.push({ id: `emiten:${t}:harga`, kind: "market", label: `${t} harga`, run: async () => priceSnap(t, await get<Prices>(qc, ["prices", t], `/emiten/${t}/prices`)) });
    if (wantsFin || !wantsSig) {
      jobs.push({ id: `emiten:${t}:keuangan`, kind: "market", label: `${t} laporan keuangan`, run: async () => finSnap(t, await get<Financials>(qc, ["fin", t], `/emiten/${t}/financials`)) });
    }
    if (wantsSig) {
      jobs.push({ id: `emiten:${t}:sinyal`, kind: "market", label: `${t} riwayat sinyal`, run: async () => sigSnap(await get<HistRow[]>(qc, ["hist", t], `/emiten/${t}/scans`)) });
    }
  }
  if (MACRO_WORDS.test(question)) {
    jobs.push({ id: "makro", kind: "market", label: "Makro", run: async () => macroSnap(await get<MacroRow[]>(qc, ["macro-ov"], "/macro/overview", 10), question) });
  }
  if (wantsSig && !mentioned.length) {
    jobs.push({
      id: "sinyal:scan", kind: "market", label: "Pemindaian terbaru",
      run: async () => {
        const periods = await get<ScanPeriod[]>(qc, ["periods"], "/scans/periods");
        const p = periods[0];
        if (!p) return null;
        const d = await get<ScanResults>(qc, ["scan", p.year, p.period], `/scans/${p.year}/${p.period}`);
        return {
          period: `${p.period} ${p.year}`, counts: d.counts,
          top: d.rows.filter((r) => r.status === "STRONG" || r.status === "MODERATE")
            .sort((a, b) => Math.abs(b.z_score ?? 0) - Math.abs(a.z_score ?? 0)).slice(0, 15)
            .map((r) => ({ ticker: r.ticker, sector: r.sector, status: r.status, direction: r.direction, growth_yoy: r.growth_yoy, z_score: r.z_score, sur: r.sur, confirmation: r.confirmation })),
        };
      },
    });
  }
  if (scope === "portfolio" && PORTFOLIO_WORDS.test(question)) {
    jobs.push({ id: "portfolio:auto", kind: "portfolio", label: "Portofolio", run: () => portfolioSnap(qc, sectors) });
  }
  return jobs.slice(0, MAX_SEND);
}

/** Jalankan rencana di atas. Yang gagal dilewati diam-diam, jawaban tetap jalan dengan data yang berhasil diambil. */
export async function resolveContext(question: string, scope: Scope, qc: QueryClient, tickers: { ticker: string; sector?: string | null }[]): Promise<CtxItem[]> {
  const jobs = planContext(question, scope, qc, tickers);
  const results = await Promise.allSettled(jobs.map((j) => j.run()));
  const now = Date.now();
  return jobs.flatMap((j, i) => {
    const r = results[i];
    const data = r.status === "fulfilled" ? slim(r.value) : undefined;
    return data === undefined ? [] : [{ id: j.id, kind: j.kind, label: j.label, data, at: now - i }];
  });
}