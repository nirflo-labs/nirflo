import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTickers } from "../lib/api";
import { day, num, pct, tone } from "../lib/format";
import { store, useColors, useParam, useSplit } from "../lib/hooks";
import { useCountUp, useMounted } from "../lib/motion";
import {
  isMix, mixName, mixParts,
  useEvaluation, useHistory, useHoldings, usePortfolioMutations, usePortfolios,
  type Evaluation, type Holding, type PfHistory, type PfSummary, type SharpeBlock,
} from "../lib/portfolio";
import { baseOption, Chart, line, X, Y, yName } from "../components/Chart";
import { Donut, type Slice } from "../components/Donut";
import { Icon } from "../components/Icon";
import { Chip, DataTable, ErrorState, Section, Segmented, type Col } from "../components/ui";
import { AddPanel, rp, usd, type CashBalance, type Composer } from "./AddPanel";
import "./portfolio.css";

const VERDICTS: Record<SharpeBlock["verdict"], string> = {
  positif: "di atas suku bunga",
  negatif: "di bawah suku bunga",
  tidak_pasti: "belum dapat dibedakan dari nol",
  tidak_dapat_dihitung: "tidak dapat dihitung",
};
const VERDICT_SHORT: Record<SharpeBlock["verdict"], string> = {
  positif: "Di atas suku bunga",
  negatif: "Di bawah suku bunga",
  tidak_pasti: "Belum pasti",
  tidak_dapat_dihitung: "Tidak dapat dihitung",
};
const VERDICT_TEXT: Record<SharpeBlock["verdict"], string> = {
  positif: "Imbal hasil melampaui suku bunga bebas risiko setelah memperhitungkan risiko.",
  negatif: "Imbal hasil berada di bawah suku bunga bebas risiko setelah memperhitungkan risiko.",
  tidak_pasti: "Belum dapat dibedakan dari suku bunga bebas risiko: selang kepercayaan melewati nol, jadi belum ada bukti yang kuat.",
  tidak_dapat_dihitung: "Data belum cukup untuk menghitung Sharpe ratio.",
};
const SHARPE_ROWS = [
  ["since_buy", "Sejak dibeli", "Memakai return yang benar-benar terjadi sejak tanggal beli."],
  ["current_weights", "Bobot sekarang", "Mengandaikan komposisi hari ini konstan selama jendela data."],
  ["equal_weight", "Dibagi sama rata", "Pembanding: setiap saham diberi bobot yang sama."],
] as const;

const clamp = (v: number | null | undefined) => `${Math.max(0, Math.min(100, (v ?? 0) * 100))}%`;
const corrWord = (r: number) => (r < 0.3 ? "rendah" : r < 0.6 ? "sedang" : "tinggi");
const relation = (r: number) => {
  const a = Math.abs(r);
  if (a < 0.2) return "nyaris tidak berkaitan";
  return `${r > 0 ? "searah" : "berlawanan"}, ${a < 0.4 ? "lemah" : a < 0.7 ? "sedang" : "kuat"}`;
};

type Insight = { tone: "good" | "info" | "warn"; text: string };

function insights(e: Evaluation, sectorOf: (t: string) => string | undefined): Insight[] {
  const out: Insight[] = [];
  if (e.cash && e.cash.weight > 0) {
    const fxText = e.cash.usd > 0 ? " Cash dolar ikut menambah risiko kurs." : "";
    out.push({
      tone: "info",
      text: `Cash ${pct(e.cash.weight, 0)} dari total. Sharpe hanya menilai bagian saham, sedangkan volatilitas total menjadi ${pct(e.portfolio_risk.total_vol, 1)} dari ${pct(e.portfolio_risk.stock_vol, 1)}.${fxText}`,
    });
  }
  const rows = Object.keys(e.weights).map((t) => ({ t, w: e.weights[t] ?? 0, r: e.risk_contribution[t] ?? 0 }));
  if (rows.length === 1) {
    out.push({ tone: "info", text: `Portofolio baru berisi satu saham (${rows[0].t}), sehingga risikonya sepenuhnya bergantung pada saham itu.` });
  } else if (rows.length > 1) {
    const top = [...rows].sort((a, b) => b.w - a.w)[0];
    if (top.w >= 0.6) out.push({ tone: "warn", text: `${top.t} mendominasi ${pct(top.w, 0)} bagian saham, sehingga hasilnya sangat bergantung pada satu saham.` });
    else if (top.w >= 0.4) out.push({ tone: "info", text: `${top.t} adalah porsi terbesar (${pct(top.w, 0)} dari bagian saham).` });
    else out.push({ tone: "good", text: `Bobot relatif merata, porsi terbesar ${top.t} (${pct(top.w, 0)} dari bagian saham).` });

    const risky = [...rows].sort((a, b) => b.r - a.r)[0];
    if (risky.r - risky.w >= 0.05) {
      out.push({ tone: "warn", text: `${risky.t} menyumbang ${pct(risky.r, 1)} risiko dengan bobot ${pct(risky.w, 1)}.` });
    }

    const avg = e.correlation.average;
    if (avg != null) {
      if (avg < 0.3) out.push({ tone: "good", text: `Korelasi antar saham rendah (${num(avg, 2)}), jadi risiko cukup menyebar.` });
      else if (avg < 0.6) out.push({ tone: "info", text: `Korelasi antar saham sedang (${num(avg, 2)}).` });
      else out.push({ tone: "warn", text: `Korelasi antar saham tinggi (${num(avg, 2)}): saham cenderung bergerak bersamaan.` });
    }

    const bySector = new Map<string, number>();
    for (const r of rows) {
      const s = sectorOf(r.t) ?? "Unknown";
      bySector.set(s, (bySector.get(s) ?? 0) + r.w);
    }
    const topSector = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topSector && topSector[0] !== "Unknown" && topSector[1] >= 0.6) {
      out.push({ tone: "info", text: `${pct(topSector[1], 0)} bagian saham berada di sektor ${topSector[0]}.` });
    }
  }
  return out.slice(0, 5);
}

export default function PortfolioPage() {
  const [name, setName] = useParam("p", "default");
  const [mode, setMode] = useParam("mode", "full");
  const [composer, setComposer] = useState<Composer | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  const list = usePortfolios();
  const tickers = useTickers();
  const holdings = useHoldings(name);
  const rows = holdings.data ?? [];
  const hasHoldings = rows.length > 0;
  const ev = useEvaluation(name, mode, hasHoldings);
  const e = hasHoldings ? ev.data : undefined;
  const count = e?.correlation.tickers.length ?? 0;
  const split = useSplit("pf-split-v2", 0.5, 0.4, 0.7);

  const mix = isMix(name);
  const cashOf = (n: string): CashBalance => {
    const p = list.data?.find((x) => x.name === n);
    return { idr: p?.cash ?? 0, usd: p?.cash_usd ?? 0 };
  };
  const cash: CashBalance = mix
    ? mixParts(name).reduce<CashBalance>((s, p) => {
        const c = cashOf(p);
        return { idr: s.idr + c.idr, usd: s.usd + c.usd };
      }, { idr: 0, usd: 0 })
    : cashOf(name);

  const sectors = useMemo(() => new Map((tickers.data ?? []).map((t) => [t.ticker, t.sector])), [tickers.data]);
  const sectorOf = (t: string) => sectors.get(t);
  const order = useMemo(() => {
    const ts = [...new Set((holdings.data ?? []).map((h) => h.ticker))];
    const w = e?.weights;
    return w ? ts.sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0)) : ts.sort();
  }, [holdings.data, e]);
  const colorOf = (t: string) => `var(--s${(Math.max(0, order.indexOf(t)) % 8) + 1})`;

  const corrLeft = useMemo(() => {
    const sharpeRows = e ? SHARPE_ROWS.filter(([k]) => e.sharpe[k]).length : 1;
    const stocks = 150 + 108 * order.length;
    const perf = 210 + 150 * sharpeRows;
    const corr = 200 + 56 * count;
    return Math.abs(stocks + corr - perf) <= Math.abs(stocks - (perf + corr));
  }, [e, order.length, count]);

  useEffect(() => setComposer(null), [name]);

  const resetLayout = () => {
    ["pf-sharpe", "pf-corr", "pf-history"].forEach((id) => store.set(`sec:${id}`, "0"));
    split.handle.onDoubleClick();
    setLayoutKey((k) => k + 1);
  };

  const corrCard = e && count > 1 ? (
    <Section title="Korelasi antar saham" className="pfx-corr rise d4" collapsible id="pf-corr">
      <CorrelationPanel e={e} />
    </Section>
  ) : null;

  return (
    <>
      <header className="pfx-head">
        <div>
          <h2>Portofolio</h2>
          <p className="muted">{e ? `${count} saham · data per ${day(e.as_of)}` : "Kinerja dan risiko portofolio saham IDX."}</p>
        </div>
        <div className="pfx-tools">
          <PortfolioSwitcher value={name} items={list.data ?? []} onChange={setName} />
          <Segmented
            label="Mode perhitungan" value={mode} onChange={setMode}
            options={[{ value: "full", label: "Lengkap" }, { value: "quick", label: "Cepat" }]}
          />
          {hasHoldings && (
            <>
              <button
                type="button" className="pfx-iconbtn" onClick={resetLayout}
                title="Atur ulang tata letak" aria-label="Atur ulang tata letak"
              >
                <Icon name="refresh" size={18} />
              </button>
              {!mix && (
                <button className={composer ? "" : "primary"} onClick={() => setComposer(composer ? null : "saham")}>
                  {composer ? "Tutup" : "+ Tambah"}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {composer && hasHoldings && !mix && (
        <AddPanel name={name} cash={cash} tab={composer} setTab={setComposer} onClose={() => setComposer(null)} />
      )}

      {mode === "quick" && (
        <p className="muted">Mode cepat memakai statistik universe tanpa membaca harga. Hasilnya hanya Sharpe bobot sekarang, tanpa Sharpe sejak dibeli.</p>
      )}
      {mix && (
        <p className="muted">
          Portofolio gabungan hanya dibaca: posisi dan cash dari {mixParts(name).join(" dan ")} dijumlahkan, dan setiap posisi
          tetap memakai tanggal belinya. Untuk mengubah isinya, buka portofolio aslinya.
        </p>
      )}

      {holdings.isPending ? <HeroSkeleton />
        : holdings.isError ? <ErrorState error={holdings.error} retry={() => holdings.refetch()} />
        : !hasHoldings ? <EmptyPortfolio name={name} cash={cash} />
        : (
          <>
            {e ? <Hero e={e} order={order} colorOf={colorOf} sectorOf={sectorOf} hover={hover} setHover={setHover} />
              : ev.isPending ? <HeroSkeleton />
              : ev.isError ? <ErrorState error={ev.error} retry={() => ev.refetch()} />
              : null}
            <div
              key={layoutKey} ref={split.ref} className="pfx-cols"
              style={{ "--cols": `minmax(0,${split.p.toFixed(3)}fr) 14px minmax(0,${(1 - split.p).toFixed(3)}fr)` } as CSSProperties}
            >
              <div className="pfx-col">
                <StocksPanel
                  name={name} holdings={rows} e={e} sectorOf={sectorOf} colorOf={colorOf}
                  hover={hover} setHover={setHover} readOnly={mix} cash={cash}
                  onEditCash={() => setComposer("cash")}
                />
                {corrLeft && corrCard}
              </div>
              <div className="split pfx-gap" title="Geser untuk mengubah lebar, klik dua kali untuk reset" {...split.handle} />
              <div className="pfx-col">
                <PerformancePanel e={e} pending={ev.isPending} error={ev.error} retry={() => ev.refetch()} />
                {!corrLeft && corrCard}
              </div>
            </div>
          </>
        )}

      {!mix && <HistoryPanel key={`h${layoutKey}`} name={name} hasHoldings={hasHoldings} />}
    </>
  );
}

function PortfolioSwitcher({ value, items, onChange }: { value: string; items: PfSummary[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const mixed = isMix(value);
  useEffect(() => {
    if (!open) return;
    setPicked(mixed ? mixParts(value) : []);
    const down = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, mixed, value]);
  const known = mixed || items.some((p) => p.name === value);
  const list: PfSummary[] = known ? items : [{ name: value, tickers: 0, positions: 0, firstBuy: "", cash: 0, cash_usd: 0 }, ...items];
  const choose = (n: string) => {
    setOpen(false);
    setDraft("");
    if (n !== value) onChange(n);
  };
  const create = (ev: FormEvent) => {
    ev.preventDefault();
    const n = draft.trim();
    if (n && n.length <= 60 && !n.includes(",") && !isMix(n)) choose(n);
  };
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const combine = () => {
    if (picked.length >= 2) choose(mixName(picked));
  };
  const caption = (p: PfSummary) => (p.tickers ? `${p.tickers} saham` : p.cash > 0 || p.cash_usd > 0 ? "cash saja" : "kosong");
  return (
    <div className="pfx-switch" ref={box}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span><small>{mixed ? "Gabungan" : "Portofolio"}</small><strong>{mixed ? mixParts(value).join(" + ") : value}</strong></span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div className="pfx-menu">
          <ul role="listbox" aria-label="Pilih portofolio">
            {list.map((p) => (
              <li key={p.name}>
                <button type="button" role="option" aria-selected={p.name === value} onClick={() => choose(p.name)}>
                  <strong>{p.name}</strong><small>{caption(p)}</small>
                </button>
              </li>
            ))}
          </ul>
          {items.length >= 2 && (
            <fieldset className="pfx-mix">
              <legend>Gabungkan portofolio</legend>
              {items.map((p) => (
                <label key={p.name}>
                  <input type="checkbox" checked={picked.includes(p.name)} onChange={() => toggle(p.name)} />
                  <span>{p.name}</span><small>{caption(p)}</small>
                </label>
              ))}
              <button type="button" className="primary" disabled={picked.length < 2} onClick={combine}>
                {picked.length < 2 ? "Pilih minimal 2" : `Tampilkan gabungan (${picked.length})`}
              </button>
            </fieldset>
          )}
          <form onSubmit={create}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Portofolio baru…" maxLength={60} aria-label="Nama portofolio baru" />
            <button type="submit" disabled={!draft.trim()}>Buat</button>
          </form>
        </div>
      )}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <section className="card pfx-hero">
      <div className="pfx-donut"><div className="donut-wrap"><div className="skel" style={{ width: "100%", height: "100%", borderRadius: "50%" }} /></div></div>
      <div className="pfx-read">
        <i className="skel" style={{ display: "block", height: 44, width: "38%" }} />
        <i className="skel" style={{ display: "block", height: 14, width: "82%" }} />
        <i className="skel" style={{ display: "block", height: 14, width: "64%" }} />
      </div>
    </section>
  );
}

function EmptyPortfolio({ name, cash }: { name: string; cash: CashBalance }) {
  const [tab, setTab] = useState<Composer>("saham");
  return (
    <Section title={`Mulai portofolio “${name}”`} className="pfx-empty rise">
      <div className="pfx-empty-body">
        <svg className="empty-ring" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="46" fill="none" strokeWidth="12" strokeDasharray="6 6" />
          <path d="M60 42v36M42 60h36" strokeWidth="6" strokeLinecap="round" fill="none" />
        </svg>
        <div>
          <p className="muted">Tambahkan posisi pertama untuk melihat Sharpe ratio, alokasi risiko, dan korelasi antar saham.</p>
          <AddPanel inline name={name} cash={cash} tab={tab} setTab={setTab} onClose={() => undefined} />
        </div>
      </div>
    </Section>
  );
}

function Hero({ e, order, colorOf, sectorOf, hover, setHover }: {
  e: Evaluation; order: string[]; colorOf: (t: string) => string; sectorOf: (t: string) => string | undefined;
  hover: string | null; setHover: (k: string | null) => void;
}) {
  const [view, setView] = useState<"w" | "r">("w");
  const now = e.sharpe.current_weights;
  const animated = useCountUp(now.sharpe);
  const n = order.length;
  const avg = e.correlation.average;
  const cw = e.cash?.weight ?? 0;

  // Bobot per saham terhadap total (saham + cash); kontribusi risiko tetap dari bagian saham.
  const raw: Slice[] = order.map((t) => ({
    key: t,
    value: Math.max(0, view === "w" ? (e.weights[t] ?? 0) * (1 - cw) : (e.risk_contribution[t] ?? 0)),
    color: colorOf(t),
  }));
  const slices: Slice[] = (() => {
    let out = raw;
    if (raw.length > 8) {
      const sorted = [...raw].sort((a, b) => b.value - a.value);
      const rest = sorted.slice(7).reduce((s, x) => s + x.value, 0);
      out = [...sorted.slice(0, 7), { key: "Lainnya", value: rest, color: "var(--s8)" }];
    }
    return view === "w" && cw > 0 ? [...out, { key: "Cash", value: cw, color: "var(--muted)" }] : out;
  })();
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const hot = hover ? slices.find((s) => s.key === hover) : undefined;
  const list = insights(e, sectorOf);

  return (
    <section className="card pfx-hero rise">
      <div className="pfx-donut">
        <div className="donut-wrap">
          <Donut slices={slices} hover={hover} onHover={setHover} label={view === "w" ? "Komposisi bobot per saham" : "Kontribusi risiko per saham"} />
          <div className="donut-center">
            {hot ? <><strong>{pct(hot.value / total, 1)}</strong><small>{hot.key}</small></> : <><strong>{n}</strong><small>saham</small></>}
          </div>
        </div>
        <Segmented
          label="Tampilan donat" value={view} onChange={setView}
          options={[{ value: "w", label: "Bobot" }, { value: "r", label: "Risiko" }]}
        />
      </div>

      <div className="pfx-read">
        <div className="pfx-sharpe">
          <span className="lbl">{cw > 0 ? "Sharpe ratio · bagian saham" : "Sharpe ratio"}</span>
          <strong className={`pfx-sharpe-val ${tone(now.sharpe)}`}>{animated == null ? "-" : num(animated, 2)}</strong>
          <Chip kind={now.verdict}>{VERDICT_SHORT[now.verdict]}</Chip>
          <p>{VERDICT_TEXT[now.verdict]} Patokan umum: di bawah 0 kalah dari suku bunga bebas risiko, 0 sampai 1 wajar, di atas 1 baik.</p>
        </div>
        {list.length > 0 && (
          <ul className="pfx-insights" aria-label="Sorotan">
            {list.map((x, i) => <li key={x.text} className={x.tone} style={{ animationDelay: `${200 + i * 90}ms` }}>{x.text}</li>)}
          </ul>
        )}
        {e.warnings.length > 0 && (
          <details className="pfx-notes">
            <summary>Catatan data ({e.warnings.length})</summary>
            <ul>{e.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
      </div>

      <dl className="pfx-facts">
        <div><dt>Jumlah saham</dt><dd>{n}</dd></div>
        <div>
          <dt>Korelasi rata-rata</dt>
          <dd>{n > 1 && avg != null ? num(avg, 2) : "-"}<small>{n > 1 && avg != null ? corrWord(avg) : "perlu minimal 2 saham"}</small></dd>
        </div>
        <div>
          <dt>Jendela data</dt>
          <dd>
            {e.window ? `${e.window.weeks} minggu` : "Estimasi cepat"}
            <small>{e.window ? `${day(e.window.start)} sampai ${day(e.window.end)}` : "dari statistik universe"}</small>
          </dd>
        </div>
        <div><dt>Data per</dt><dd>{day(e.as_of)}</dd></div>
      </dl>
    </section>
  );
}

type Group = { ticker: string; lots: number; items: Holding[] };

function StocksPanel({ name, holdings, e, sectorOf, colorOf, hover, setHover, readOnly, cash, onEditCash }: {
  name: string; holdings: Holding[]; e?: Evaluation; sectorOf: (t: string) => string | undefined; colorOf: (t: string) => string;
  hover: string | null; setHover: (k: string | null) => void; readOnly: boolean; cash: CashBalance; onEditCash: () => void;
}) {
  const grown = useMounted();
  const { remove } = usePortfolioMutations(name);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const h of holdings) {
      const g = m.get(h.ticker) ?? { ticker: h.ticker, lots: 0, items: [] };
      g.lots += h.lots;
      g.items.push(h);
      m.set(h.ticker, g);
    }
    return [...m.values()].sort((a, b) => (e?.weights[b.ticker] ?? 0) - (e?.weights[a.ticker] ?? 0) || a.ticker.localeCompare(b.ticker));
  }, [holdings, e]);
  const totalLots = holdings.reduce((s, h) => s + h.lots, 0);
  const hasCash = cash.idr > 0 || cash.usd > 0;

  return (
    <Section title={`Saham (${groups.length})`} className="pfx-stocks rise d2">
      <div className="stk-head" role="presentation">
        <span>Saham</span>
        <span><i className="sw bw" />Bobot <i className="sw br" />Risiko</span>
        <span>Lot</span>
        <span />
      </div>
      <ul className="stk-list">
        {groups.map((g, i) => {
          const w = e ? (e.weights[g.ticker] ?? 0) * (1 - (e.cash?.weight ?? 0)) : undefined;
          const r = e?.risk_contribution[g.ticker];
          const isOpen = open === g.ticker;
          return (
            <li
              key={g.ticker} className={`stk${isOpen ? " open" : ""}${hover === g.ticker ? " hot" : ""}`}
              style={{ animationDelay: `${i * 45}ms` }}
              onMouseEnter={() => setHover(g.ticker)} onMouseLeave={() => setHover(null)}
            >
              <button type="button" className="stk-main" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.ticker)}>
                <span className="stk-name">
                  <i className="stk-dot" style={{ background: colorOf(g.ticker) }} />
                  <span><strong>{g.ticker}</strong><small>{sectorOf(g.ticker) ?? "-"}</small></span>
                </span>
                <span className="stk-bars">
                  {e ? (
                    <>
                      <span className="stk-m"><span className="stk-t"><i className="stk-f bw" style={{ width: grown ? clamp(w) : "0%" }} /></span><b>{pct(w, 1)}</b></span>
                      <span className="stk-m r"><span className="stk-t"><i className="stk-f br" style={{ width: grown ? clamp(r) : "0%" }} /></span><b>{pct(r, 1)}</b></span>
                    </>
                  ) : (
                    <>
                      <i className="skel" style={{ display: "block", height: 8 }} />
                      <i className="skel" style={{ display: "block", height: 8, width: "70%" }} />
                    </>
                  )}
                </span>
                <span className="stk-lots"><b>{num(g.lots, 2)}</b><small>{g.items.length > 1 ? `${g.items.length} pembelian` : "lot"}</small></span>
                <span className="stk-chev"><Icon name="down" size={16} /></span>
              </button>
              {isOpen && (
                <ul className="stk-buys">
                  {g.items.map((h) => (
                    <li key={h.id}>
                      <span>{day(h.buy_date)}{readOnly && <small> · {h.portfolio}</small>}</span>
                      <span>{num(h.lots, 2)} lot</span>
                      <span className="act">
                        {readOnly ? null : confirm === h.id ? (
                          <>
                            <button type="button" className="btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(h.id, { onSettled: () => setConfirm(null) })}>Ya, hapus</button>
                            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>Batal</button>
                          </>
                        ) : (
                          <button type="button" className="btn-ghost" onClick={() => setConfirm(h.id)}>Hapus</button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {(hasCash || !readOnly) && (
        <div className="cash-row">
          <span className="cash-name">
            <i className="stk-dot cash" />
            <span>
              <strong>Cash</strong>
              <small>{cash.usd > 0 ? "Cash dolar ikut menambah risiko kurs" : "Dianggap berimbal sebesar suku bunga bebas risiko"}</small>
            </span>
          </span>
          <span className="cash-val">
            {hasCash ? (
              <>
                {cash.idr > 0 && <b>{rp(cash.idr)}</b>}
                {cash.usd > 0 && (
                  <b>
                    {usd(cash.usd)}
                    {e?.cash?.fx && <small className="cash-eq"> setara {rp(cash.usd * e.cash.fx.rate)}</small>}
                  </b>
                )}
                {e?.cash && <small>{pct(e.cash.weight, 1)} dari total</small>}
              </>
            ) : <b>belum diatur</b>}
          </span>
          {!readOnly && <button type="button" className="btn-ghost" onClick={onEditCash}>{hasCash ? "Atur" : "Tambah"}</button>}
        </div>
      )}
      <div className="stk-total"><span>Total</span><span>{num(totalLots, 2)} lot di {groups.length} saham</span></div>
      {remove.isError && <p className="down" role="alert">{remove.error.message}</p>}
    </Section>
  );
}

type SRow = { label: string; b: SharpeBlock };

function PerformancePanel({ e, pending, error, retry }: { e?: Evaluation; pending: boolean; error: unknown; retry: () => void }) {
  const on = useMounted();
  if (!e) {
    return (
      <Section title="Kinerja disesuaikan risiko" className="pfx-perf rise d3">
        {pending ? (
          <div className="skels">
            <i className="skel" style={{ display: "block", height: 18, width: "40%" }} />
            <i className="skel" style={{ display: "block", height: 24 }} />
            <i className="skel" style={{ display: "block", height: 18, width: "55%" }} />
          </div>
        ) : error ? <ErrorState error={error} retry={retry} /> : null}
      </Section>
    );
  }
  const rows = SHARPE_ROWS.flatMap(([k, label, note]) => (e.sharpe[k] ? [{ label, note, b: e.sharpe[k] as SharpeBlock }] : []));
  const ok = (r: { b: SharpeBlock }) => r.b.sharpe != null && r.b.ci_low != null && r.b.ci_high != null;
  const plotted = rows.filter(ok);
  const lo = Math.min(0, ...plotted.map((r) => r.b.ci_low as number));
  const hi = Math.max(0, ...plotted.map((r) => r.b.ci_high as number));
  const pad = (hi - lo) * 0.06 || 0.5;
  const a = lo - pad, b = hi + pad;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - a) / (b - a)) * 100))}%`;

  const cols: Col<SRow>[] = [
    { key: "label", label: "Perhitungan" },
    { key: "sharpe", label: "Sharpe", num: true, get: (r) => r.b.sharpe, fmt: (v) => num(v, 2) },
    { key: "ci", label: "Selang 95%", get: (r) => r.b.ci_low, fmt: (_, r) => (r.b.ci_low == null ? "-" : `${num(r.b.ci_low, 2)} sampai ${num(r.b.ci_high, 2)}`) },
    { key: "excess", label: "Excess return/thn", num: true, get: (r) => r.b.annual_excess_return, fmt: (v) => pct(v, 1, true) },
    { key: "vol", label: "Volatilitas/thn", num: true, get: (r) => r.b.annual_vol, fmt: (v) => pct(v, 1) },
    { key: "n", label: "Observasi", get: (r) => r.b.n_obs, fmt: (v, r) => `${v} ${r.b.basis}` },
    { key: "period", label: "Periode", get: (r) => r.b.start, fmt: (_, r) => (r.b.start ? `${day(r.b.start)} - ${day(r.b.end)}` : "-") },
    { key: "verdict", label: "Kesimpulan", get: (r) => VERDICTS[r.b.verdict] },
  ];

  const c = e.cash;
  return (
    <Section title="Kinerja disesuaikan risiko" className="pfx-perf rise d3" collapsible id="pf-sharpe">
      <ul className="rngs">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="rng-head"><span>{r.label}</span><strong className={tone(r.b.sharpe)}>{num(r.b.sharpe, 2)}</strong></div>
            <small className="rng-sub">{r.note}</small>
            {ok(r) ? (
              <>
                <div
                  className="rng-track" role="img"
                  aria-label={`${r.label}: Sharpe ${num(r.b.sharpe, 2)}, selang 95% ${num(r.b.ci_low, 2)} sampai ${num(r.b.ci_high, 2)}`}
                >
                  <i className="rng-zero" style={{ left: at(0) }} />
                  <i
                    className="rng-ci"
                    style={{
                      left: on ? at(r.b.ci_low as number) : at(0),
                      width: on ? `${(((r.b.ci_high as number) - (r.b.ci_low as number)) / (b - a)) * 100}%` : "0%",
                    }}
                  />
                  <i className="rng-dot" style={{ left: on ? at(r.b.sharpe as number) : at(0) }} />
                </div>
                <div className="rng-foot">
                  <span>{num(r.b.ci_low, 2)}</span>
                  <Chip kind={r.b.verdict}>{VERDICT_SHORT[r.b.verdict]}</Chip>
                  <span>{num(r.b.ci_high, 2)}</span>
                </div>
              </>
            ) : (
              <p className="muted">Tidak dapat dihitung (n={r.b.n_obs}).</p>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Batang adalah selang kepercayaan 95% dan garis putus-putus adalah nol. Jika batang melewati nol, hasilnya belum dapat dibedakan dari suku bunga bebas risiko.</p>
      <p className="muted small">Suku bunga bebas risiko memakai suku bunga antarbank 3 bulan (rupiah), sesuai mata uang return saham IDX.</p>
      {c && c.weight > 0 && (
        <div className="pfx-cashnote">
          <strong>Dampak cash ({pct(c.weight, 1)} dari total)</strong>
          <p>
            Sharpe di atas hanya menilai bagian saham, jadi tidak turun karena menahan cash. Cash mengurangi risiko:
            volatilitas total {pct(e.portfolio_risk.total_vol, 1)} per tahun (bagian saham saja {pct(e.portfolio_risk.stock_vol, 1)}),
            dengan excess return total {pct(e.portfolio_risk.total_excess_return, 1, true)} per tahun.
          </p>
          {c.usd > 0 && c.fx && (
            <p>
              Cash dolar ({usd(c.usd)}, setara {rp(c.usd_in_idr)} dengan kurs {num(c.fx.rate, 0)} per {day(c.fx.date)}) tidak bebas
              risiko dalam rupiah: fluktuasi kurs ikut dihitung dalam volatilitas total
              {c.fx.vol != null ? ` (volatilitas kurs ${pct(c.fx.vol, 1)} per tahun` : ""}
              {c.fx.vol != null ? (c.fx.rho != null ? `, korelasi dengan saham ${num(c.fx.rho, 2)}).` : "; mode cepat tidak menghitung korelasi dengan saham, dianggap 0).") : "."}
            </p>
          )}
          {c.usd > 0 && !e.portfolio_risk.fx_included && (
            <p>Data kurs belum cukup untuk menghitung volatilitas kurs, sehingga risiko kurs belum masuk dalam volatilitas total.</p>
          )}
        </div>
      )}
      <details className="more">
        <summary>Rincian perhitungan</summary>
        <DataTable cols={cols} rows={rows} />
      </details>
    </Section>
  );
}

function CorrelationPanel({ e }: { e: Evaluation }) {
  const { tickers, matrix, average } = e.correlation;
  const shade = (v: number | null) =>
    v == null ? undefined : `color-mix(in srgb, var(${v >= 0 ? "--accent" : "--down"}) ${Math.min(1, Math.abs(v)) * 65}%, transparent)`;
  let best: { a: string; b: string; r: number } | null = null;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = matrix[i][j];
      if (r != null && (best === null || Math.abs(r) > Math.abs(best.r))) best = { a: tickers[i], b: tickers[j], r };
    }
  }
  return (
    <>
      {best && (
        <p className="pfx-pair">
          Pasangan paling erat: <strong>{best.a} dan {best.b}</strong> ({num(best.r, 2)}, {relation(best.r)}).
        </p>
      )}
      <div className="tablewrap">
        <table>
          <thead><tr><th />{tickers.map((t) => <th key={t} className="r">{t}</th>)}</tr></thead>
          <tbody>
            {tickers.map((t, i) => (
              <tr key={t}>
                <th scope="row">{t}</th>
                {matrix[i].map((v, j) => <td key={j} className="r" style={{ background: shade(v) }}>{num(v, 2)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Return mingguan{e.window ? `, ${e.window.weeks} minggu` : ""}. Rata-rata berpasangan {num(average, 2)}. Semakin rendah, semakin menyebar risikonya.
      </p>
    </>
  );
}

function HistoryPanel({ name, hasHoldings }: { name: string; hasHoldings: boolean }) {
  const q = useHistory(name);
  const { snapshot } = usePortfolioMutations(name);
  const empty = q.data ? q.data.x.length === 0 : false;
  const save = (
    <button type="button" className={empty ? "primary" : ""} disabled={!hasHoldings || snapshot.isPending} onClick={() => snapshot.mutate()}>
      {snapshot.isPending ? "Menyimpan…" : "Simpan evaluasi hari ini"}
    </button>
  );
  return (
    <Section title="Riwayat evaluasi" className="pfx-hist rise d5" collapsible id="pf-history" action={q.data && !empty ? save : undefined}>
      {snapshot.isError && <p className="down" role="alert">{snapshot.error.message}</p>}
      {q.isPending ? <i className="skel" style={{ display: "block", height: 120 }} />
        : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} />
        : empty ? (
          <div className="hist-empty">
            <svg className="hist-art" viewBox="0 0 96 64" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="4,48 24,36 44,42 64,22 92,12" strokeDasharray="4 5" />
              <circle cx="4" cy="48" r="3" fill="currentColor" /><circle cx="24" cy="36" r="3" fill="currentColor" />
              <circle cx="44" cy="42" r="3" fill="currentColor" /><circle cx="64" cy="22" r="3" fill="currentColor" />
            </svg>
            <div>
              <strong>Belum ada riwayat</strong>
              <p>
                Riwayat merekam Sharpe ratio dan korelasi portofolio dari hari ke hari, sehingga Anda bisa melihat apakah risikonya membaik atau memburuk.
                Terisi otomatis setiap evaluasi harian berjalan, atau simpan hasil hari ini sekarang.
              </p>
              {hasHoldings ? save : <p>Tambahkan posisi terlebih dulu.</p>}
            </div>
          </div>
        )
        : <HistoryView h={q.data} />}
    </Section>
  );
}

type HRow = { as_of: string; since: number | null; now: number | null; equal: number | null; corr: number | null; warnings: number };

function HistoryView({ h }: { h: PfHistory }) {
  const c = useColors();
  const option = useMemo(() => baseOption(c, {
    grid: { left: 56, right: 16, top: 36, bottom: 28 },
    xAxis: X(c), yAxis: Y(c, yName("Sharpe ratio", 40)), dataZoom: [{ type: "inside", zoomOnMouseWheel: "ctrl" }],
    series: [
      line("Sejak dibeli", h.x, h.sharpe_since_buy, c.accent, { showSymbol: true, symbolSize: 6 }),
      line("Bobot sekarang", h.x, h.sharpe_current_weights, c.up, { showSymbol: true, symbolSize: 6 }),
      line("Dibagi sama rata", h.x, h.sharpe_equal_weight, c.muted, { showSymbol: true, symbolSize: 6 }),
    ],
  }), [c, h]);
  const rows: HRow[] = useMemo(
    () => h.x.map((d, i) => ({ as_of: d, since: h.sharpe_since_buy[i], now: h.sharpe_current_weights[i], equal: h.sharpe_equal_weight[i], corr: h.avg_correlation[i], warnings: h.warnings[i] })).reverse(),
    [h],
  );
  const cols: Col<HRow>[] = [
    { key: "as_of", label: "Per tanggal", fmt: (v) => day(v) },
    { key: "since", label: "Sharpe sejak dibeli", num: true, fmt: (v) => num(v, 2) },
    { key: "now", label: "Sharpe bobot sekarang", num: true, fmt: (v) => num(v, 2) },
    { key: "equal", label: "Sharpe sama rata", num: true, fmt: (v) => num(v, 2) },
    { key: "corr", label: "Rata-rata korelasi", num: true, fmt: (v) => num(v, 2) },
    { key: "warnings", label: "Peringatan", num: true },
  ];
  return (
    <>
      {h.x.length >= 2
        ? <Chart option={option} height={300} label="Riwayat Sharpe ratio portofolio" />
        : <p className="muted">Baru ada satu titik riwayat. Grafik muncul setelah ada minimal dua tanggal.</p>}
      <DataTable cols={cols} rows={rows} pageSize={15} csv="riwayat_portofolio.csv" />
    </>
  );
}