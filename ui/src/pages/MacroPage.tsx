import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMacroOverview, useMacroSeries } from "../lib/api";
import { day, num, pct, tone } from "../lib/format";
import { useColors, useParam } from "../lib/hooks";
import { addRecent, loadRecent } from "../lib/recent";
import type { MacroRow, MacroSeries } from "../lib/types";
import { baseOption, Chart, line, X, Y } from "../components/Chart";
import { Icon } from "../components/Icon";
import { Async, Section, Segmented } from "../components/ui";

const YEARS: Record<string, number | null> = { "1 tahun": 1, "3 tahun": 3, "5 tahun": 5, "10 tahun": 10, Semua: null };

const NAMES: Record<string, string> = {
  IHSG: "IHSG",
  USDIDR: "USD/IDR",
  DXY: "Indeks Dolar AS",
  VIX: "Indeks Volatilitas (VIX)",
  BRENT_OIL: "Minyak Brent",
  COAL: "Batubara Newcastle",
  COAL_GLOBAL: "Batubara Termal Australia",
  COPPER: "Tembaga",
  GOLD: "Emas",
  NICKEL: "Nikel",
  BAUXITE: "Bauksit (indeks harga impor)",
  ID_RATE: "Suku Bunga Antarbank 3 Bulan",
  ID_CPI_YOY_BPS: "Inflasi Tahunan (BPS)",
  ID_CPI: "Indeks Harga Konsumen",
  ID_GDP: "Pertumbuhan PDB Riil",
  ID_CURRENT_ACCOUNT: "Transaksi Berjalan",
  ID_TRADE_BALANCE: "Neraca Perdagangan Barang",
  ID_RESERVES: "Cadangan Devisa (di luar emas)",
  ID_FOREIGN_DEBT: "Kepemilikan Asing pada SBN",
  US_10Y: "Imbal Hasil Treasury AS 10 Tahun",
  US_CPI: "Indeks Harga Konsumen AS",
};
const PRIORITY = Object.keys(NAMES);

const GROUPS = ["Pasar & kurs", "Komoditas", "Indonesia", "Global"] as const;
type Group = (typeof GROUPS)[number];
const MARKET = new Set(["IHSG", "USDIDR", "DXY", "VIX", "SPX", "SP500", "NASDAQ"]);
const COMMODITY = /^(BAUXITE|BRENT|WTI|COAL|COPPER|GOLD|SILVER|NICKEL|TIN|PALM|CPO|RUBBER|OIL|GAS|LNG|IRON|ALUMINUM|ALUMINIUM|ZINC)/;

function groupOf(key: string): Group {
  const k = key.toUpperCase();
  if (MARKET.has(k)) return "Pasar & kurs";
  if (COMMODITY.test(k)) return "Komoditas";
  if (k.startsWith("ID_")) return "Indonesia";
  return "Global";
}

function fallbackName(r: MacroRow): string {
  const raw = r.name?.trim();
  if (!raw) return r.key;
  const prefix = `${r.key} - `;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

const rank = (k: string) => { const i = PRIORITY.indexOf(k); return i < 0 ? PRIORITY.length : i; };

const LIST_MIN = 280, LIST_MAX = 560, LIST_DEFAULT = 360;
const WIDTH_KEY = "nirflo.macroListWidth", OPEN_KEY = "nirflo.macroListOpen", RECENT_KEY = "nirflo.macroRecent";
const clampWidth = (w: number) => Math.max(LIST_MIN, Math.min(LIST_MAX, Math.round(w)));

function usePersisted<T>(key: string, initial: T, parse: (raw: string) => T | null) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw == null ? null : parse(raw);
      return parsed ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(v)); } catch { return; }
  }, [key, v]);
  return [v, setV] as const;
}

const fitHeight = () => Math.max(380, Math.min(720, window.innerHeight - 340));
function useChartHeight() {
  const [h, setH] = useState(fitHeight);
  useEffect(() => {
    const onResize = () => setH(fitHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return h;
}

export default function MacroPage() {
  const q = useMacroOverview();
  return (
    <>
      <h2>Makro</h2>
      <Async q={q} isEmpty={(d) => d.length === 0 && "Belum ada data di macro_indicators."}>{(rows) => <MacroView rows={rows} />}</Async>
    </>
  );
}

function MacroView({ rows }: { rows: MacroRow[] }) {
  const c = useColors();
  const [sp, setSp] = useSearchParams();
  const [range, setRange] = useParam("rentang", "5 tahun");
  const [mode, setMode] = useParam("mode", "per");
  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(RECENT_KEY));
  const [listW, setListW] = usePersisted<number>(WIDTH_KEY, LIST_DEFAULT, (r) => (Number(r) ? clampWidth(Number(r)) : null));
  const [open, setOpen] = usePersisted<boolean>(OPEN_KEY, true, (r) => (r === "false" ? false : r === "true" ? true : null));
  const searchRef = useRef<HTMLInputElement>(null);
  const chartH = useChartHeight();
  const setWidth = (v: number) => setListW(clampWidth(v));

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const label = useCallback(
    (k: string) => NAMES[k] ?? (byKey.has(k) ? fallbackName(byKey.get(k)!) : k),
    [byKey],
  );

  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const urlKeys = JSON.stringify(sp.getAll("k"));
  const chosen = useMemo(() => {
    const fromUrl = (JSON.parse(urlKeys) as string[]).filter((k) => keys.includes(k));
    const def = ["IHSG", "USDIDR"].filter((k) => keys.includes(k));
    return fromUrl.length ? fromUrl : def.length ? def : keys.slice(0, 2);
  }, [urlKeys, keys]);
  const colorOf = (k: string) => c.series[chosen.indexOf(k) % c.series.length];

  const apply = (next: string[]) => {
    if (!next.length) return;
    setSp((p) => { const n = new URLSearchParams(p); n.delete("k"); next.forEach((x) => n.append("k", x)); return n; }, { replace: true });
  };
  const remember = (k: string) => setRecent(addRecent(RECENT_KEY, k));
  const toggle = (k: string) => {
    if (chosen.includes(k)) {
      apply(chosen.filter((x) => x !== k));
    } else {
      apply([...chosen, k]);
      remember(k);
    }
  };
  const ensure = (k: string) => {
    if (!chosen.includes(k)) apply([...chosen, k]);
    remember(k);
  };

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const sorted = [...rows]
      .filter((r) => !needle || `${r.key} ${label(r.key)}`.toLowerCase().includes(needle))
      .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
    return GROUPS
      .map((g) => ({ group: g, items: sorted.filter((r) => groupOf(r.key) === g) }))
      .filter((x) => x.items.length > 0);
  }, [rows, filter, label]);

  const typed = filter.trim().length > 0;
  const recentRows = useMemo(
    () => recent.map((k) => byKey.get(k)).filter((r): r is MacroRow => Boolean(r)),
    [recent, byKey],
  );
  const popOpen = focus && !typed && recentRows.length > 0;

  const pickRecent = (r: MacroRow) => {
    ensure(r.key);
    searchRef.current?.blur();
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && popOpen) {
      e.preventDefault();
      setActive((i) => Math.min(recentRows.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && popOpen) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const hit = popOpen ? recentRows[active] : grouped[0]?.items[0];
      if (hit) {
        e.preventDefault();
        ensure(hit.key);
        if (popOpen) searchRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      if (typed) setFilter("");
      else searchRef.current?.blur();
    }
  };

  const s = useMacroSeries(chosen, YEARS[range]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX, startW = listW;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => setWidth(startW + (startX - ev.clientX));
    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  };
  const keyResize = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setWidth(listW + 16); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setWidth(listW - 16); }
    else if (e.key === "Home") { e.preventDefault(); setWidth(LIST_DEFAULT); }
  };

  const detail = (r: MacroRow) =>
    [label(r.key) !== r.key ? r.key : null, r.source, day(r.last_date), `12 bulan ${pct(r.change12m, 1, true)}`].filter(Boolean).join(" · ");

  return (
    <div className={`macro${open ? "" : " collapsed"}`} style={{ "--macro-w": `${listW}px` } as CSSProperties}>
      <div className="macro-main">
        <div className="toolbar">
          <Segmented label="Rentang" value={range} onChange={setRange} options={Object.keys(YEARS).map((k) => ({ value: k, label: k }))} />
          <Segmented label="Tampilan" value={mode} onChange={setMode} options={[{ value: "per", label: "Per indikator" }, { value: "cmp", label: "Perbandingan" }]} />
          <button
            type="button" className={`macro-toggle${open ? " on" : ""}`}
            aria-pressed={open} aria-controls="macro-list" aria-label="Daftar indikator"
            title={open ? "Tutup daftar indikator" : `Buka daftar indikator (${chosen.length} terpilih)`}
            onClick={() => setOpen(!open)}
          >
            <Icon name="panel" size={18} />
            {!open && <b className="count">{chosen.length}</b>}
          </button>
        </div>
        <div className="macro-sel" aria-label="Indikator terpilih">
          {chosen.map((k) => (
            <button key={k} onClick={() => toggle(k)} disabled={chosen.length === 1} title="Hapus dari grafik" aria-label={`Hapus ${label(k)} dari grafik`}>
              <i className="mdot" style={{ background: colorOf(k) }} />
              {label(k)} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
        <Async q={s}>
          {(d) => (mode === "per"
            ? <div className="two">{chosen.map((k) => <Mini key={k} k={k} title={label(k)} d={d} i={chosen.indexOf(k)} />)}</div>
            : <Compare d={d} chosen={chosen} label={label} height={chartH} />)}
        </Async>
      </div>

      {open && (
        <>
          <div
            className="macro-resize" role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label="Atur lebar daftar indikator" aria-valuemin={LIST_MIN} aria-valuemax={LIST_MAX} aria-valuenow={listW}
            title="Seret untuk mengatur lebar, klik dua kali untuk mengembalikan"
            onPointerDown={startDrag} onKeyDown={keyResize} onDoubleClick={() => setWidth(LIST_DEFAULT)}
          />
          <aside id="macro-list" className="card macro-list" aria-label="Daftar indikator">
            <div className="macro-scroll">
              <div className="macro-listhead">
                <div className="tsearch compact">
                  <span className="tsearch-input">
                    <Icon name="search" size={16} />
                    <input
                      ref={searchRef} type="search" value={filter} placeholder="Cari indikator" aria-label="Cari indikator"
                      role="combobox" aria-expanded={popOpen} aria-controls="macro-recent" aria-autocomplete="list"
                      aria-activedescendant={popOpen && recentRows[active] ? `macro-recent-${recentRows[active].key}` : undefined}
                      autoComplete="off" spellCheck={false}
                      onChange={(e) => setFilter(e.target.value)}
                      onFocus={() => { setFocus(true); setActive(0); }}
                      onBlur={() => setFocus(false)}
                      onKeyDown={onSearchKey}
                    />
                  </span>
                  {popOpen && (
                    <ul className="tsearch-pop" role="listbox" id="macro-recent">
                    <li className="tsearch-head" role="presentation">Terakhir dipilih</li>
                      {recentRows.map((r, i) => (
                        <li
                          key={r.key} id={`macro-recent-${r.key}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
                          onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pickRecent(r); }}
                        >
                          <strong>{label(r.key)}</strong>
                          {chosen.includes(r.key) && <em>Di grafik</em>}
                          <span>{groupOf(r.key)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {grouped.length === 0 && <p className="muted">Tidak ada indikator yang cocok.</p>}
              {grouped.map(({ group, items }) => (
                <div key={group} className="mgroup">
                  <h4>{group}</h4>
                  {items.map((r) => {
                    const on = chosen.includes(r.key);
                    return (
                      <button
                        key={r.key} type="button" className={`mrow${on ? " on" : ""}`}
                        aria-pressed={on} title={detail(r)} onClick={() => toggle(r.key)}
                      >
                        <i className="mdot" style={on ? { background: colorOf(r.key), borderColor: colorOf(r.key) } : undefined} />
                        <span className="mrow-name">{label(r.key)}</span>
                        <span className="mrow-val">{num(r.last_value, 2)}</span>
                        <span className={`mrow-chg ${tone(r.change1m)}`}>{pct(r.change1m, 1, true)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function Mini({ k, title, d, i }: { k: string; title: string; d: MacroSeries; i: number }) {
  const c = useColors();
  const s = d.series[k];
  const opt = useMemo(() => s && baseOption(c, {
    legend: { show: false }, grid: { left: 56, right: 12, top: 12, bottom: 24 }, xAxis: X(c), yAxis: Y(c),
    series: [line(k, s.x, s.y, c.series[i % c.series.length])],
  }), [c, s, k, i]);
  return (
    <Section title={title}>
      {opt ? <Chart option={opt} height={300} label={`Grafik ${title}`} /> : <p className="muted">Tidak ada data pada rentang ini.</p>}
    </Section>
  );
}

function describe(r: number): string {
  const a = Math.abs(r);
  if (a < 0.2) return "Nyaris tidak berkaitan";
  return `${r > 0 ? "Searah" : "Berlawanan"}, ${a < 0.4 ? "lemah" : a < 0.7 ? "sedang" : "kuat"}`;
}

function Pairs({ cor, label }: { cor: NonNullable<MacroSeries["correlation"]>; label: (k: string) => string }) {
  const pairs = useMemo(() => {
    const out: { a: string; b: string; r: number }[] = [];
    cor.keys.forEach((a, i) => cor.keys.forEach((b, j) => {
      const r = cor.matrix[i][j];
      if (j > i && r != null) out.push({ a, b, r });
    }));
    return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  }, [cor]);
  if (!pairs.length) return <p className="muted">Data belum cukup untuk menghitung korelasi.</p>;
  return (
    <>
      <p className="muted pair-note">Dihitung dari perubahan bulanan. Batang ke kanan berarti bergerak searah, ke kiri berlawanan.</p>
      <ul className="pairs">
        {pairs.map(({ a, b, r }) => (
          <li key={`${a}|${b}`} className="pair">
            <span className="pair-names">{label(a)} <i aria-hidden>↔</i> {label(b)}</span>
            <span className="pair-bar" role="img" aria-label={`${describe(r)}, koefisien ${num(r, 2)}`}>
              <b className={r >= 0 ? "pos" : "neg"} style={{ width: `${Math.abs(r) * 50}%`, [r >= 0 ? "left" : "right"]: "50%" }} />
            </span>
            <span className="pair-text"><strong>{describe(r)}</strong><small>{num(r, 2)}</small></span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Compare({ d, chosen, label, height }: { d: MacroSeries; chosen: string[]; label: (k: string) => string; height: number }) {
  const c = useColors();
  const opt = useMemo(() => baseOption(c, {
    grid: { left: 56, right: 16, top: 36, bottom: 28 }, xAxis: X(c), yAxis: Y(c),
    dataZoom: [{ type: "inside", zoomOnMouseWheel: "ctrl" }],
    series: chosen.flatMap((k, i) => {
      const s = d.series[k];
      if (!s || !s.y[0]) return [];
      return [line(label(k), s.x, s.y.map((v) => (v / s.y[0]) * 100), c.series[i % c.series.length], {
        ...(i === 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: c.muted }, data: [{ yAxis: 100 }] } } : {}),
      })];
    }),
  }), [c, d, chosen, label]);
  return (
    <>
      <Section title="Indeks (awal rentang = 100)"><Chart option={opt} height={height} label="Perbandingan indikator, dinormalisasi ke 100" /></Section>
      {d.correlation && <Section title="Hubungan antar indikator"><Pairs cor={d.correlation} label={label} /></Section>}
    </>
  );
}