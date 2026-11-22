"""API tipis untuk UI TypeScript. Logika bisnis tetap di analytics/ dan core/."""
from __future__ import annotations

import math
import time
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache, wraps
from pathlib import Path
from threading import Lock
from typing import Any

import orjson
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from api.auth import current_clerk_id
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from analytics import regime_signal as rs
from analytics import signal_report as sr
from api.jobs import RegimeJobs
from core import history as hist

SIGNAL_STATUSES = ("STRONG", "MODERATE")
HORIZONS = (1, 5, 10, 20)
PERIOD_ORDER = {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}
CONFIRMATION_ORDER = ("CONFIRMED", "RECOVERING", "DIVERGENT", "UNCONFIRMED", "--")
FLOW = ("revenue", "gross_profit", "operating_profit", "net_income", "operating_cash_flow", "capital_expenditure")
BALANCE = ("total_assets", "total_liabilities", "total_equity", "cash_and_equivalents")
AMOUNTS = (*FLOW, *BALANCE)
RATIOS = ("revenue_yoy", "net_income_yoy", "gross_margin", "net_margin", "roe", "der")
MACRO_ROLES = {
    "key": ("indicator_ticker", "ticker", "indicator_code", "indicator", "series_id", "code", "symbol"),
    "date": ("record_date", "date", "obs_date", "observation_date", "period_date", "as_of_date"),
    "value": ("value", "val", "close", "data_value", "indicator_value"),
}
MACRO_NAME_CANDIDATES = ("indicator_name", "name", "full_name", "description", "label", "title")
REGIME_SERIES = ("buy_hold", "macd_only", "mrs_only", "macd_mrs")
REGIME_LABELS = {
    "buy_hold": "Buy and hold", "bh_matched": "Buy and hold (eksposur disamakan)",
    "macd_only": "MACD saja", "mrs_only": "MRS saja", "macd_mrs": "MACD + MRS",
}
REGIME_MIN_DURATION = 5.0
D = rs.RegimeConfig()
query = hist.run_query


# ---------------------------------------------------------------- serialisasi
def _default(o: Any):
    if o is pd.NaT or o is pd.NA:
        return None
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, datetime):  # termasuk pd.Timestamp
        s = o.isoformat()
        return s[:10] if s.endswith("T00:00:00") else s
    if isinstance(o, date):
        return o.isoformat()
    raise TypeError(type(o))


class Json(Response):
    """orjson: NaN otomatis jadi null, numpy native, Decimal/Timestamp lewat _default."""
    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, default=_default, option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS)


CACHES: list = []


def ttl_cache(seconds: int):
    """Pengganti st.cache_data(ttl=...). Exception tidak di-cache."""
    def deco(fn):
        store: dict = {}
        lock = Lock()

        @wraps(fn)
        def inner(*args):
            now = time.monotonic()
            with lock:
                hit = store.get(args)
                if hit and now - hit[0] < seconds:
                    return hit[1]
            value = fn(*args)
            with lock:
                store[args] = (now, value)
            return value

        inner.clear = store.clear  # type: ignore[attr-defined]
        CACHES.append(inner)
        return inner
    return deco


def to_numeric(frame: pd.DataFrame, columns) -> pd.DataFrame:
    for c in columns:
        if c in frame.columns:
            frame[c] = pd.to_numeric(frame[c], errors="coerce")
    return frame


def day(index) -> list[str]:
    return pd.DatetimeIndex(index).strftime("%Y-%m-%d").tolist()


def pack(df: pd.DataFrame) -> dict:
    """Format kolom: {x: [...], kolom: [...]}. Jauh lebih kecil dari array of objects."""
    return {"x": day(df.index), **{c: df[c].tolist() for c in df.columns}}


def table(df: pd.DataFrame, index: str | None = None) -> dict:
    if index and not isinstance(df.index, pd.RangeIndex):
        df = df.reset_index(names=index)
    return {"columns": [str(c) for c in df.columns], "rows": df.to_dict("records")}


def summarize(values: pd.Series, negative: bool) -> dict:
    v = values.dropna()
    n = len(v)
    if n == 0:
        return {"n": 0, "mean": None, "median": None, "win": None, "ci": 0.0}
    ci = 1.96 * float(v.std(ddof=1)) / math.sqrt(n) if n >= 2 else 0.0
    win = float((v < 0).mean() if negative else (v > 0).mean())
    return {"n": n, "mean": float(v.mean()), "median": float(v.median()), "win": win, "ci": ci}


app = FastAPI(title="Nirflo API", dependencies=[Depends(current_clerk_id)])
app.add_middleware(GZipMiddleware, minimum_size=1024)
jobs = RegimeJobs()


# ---------------------------------------------------------------- meta
@ttl_cache(60)
def meta_payload() -> dict:
    if hist.database_available():
        source, snapshot = "database", None
    else:
        source, snapshot = "snapshot", hist.latest_snapshot_stamp()  # raise bila R2 juga mati
    last, age = None, None
    try:
        last = pd.to_datetime(query("SELECT MAX(price_date) AS d FROM daily_prices;")["d"].iloc[0]).date()
        age = (date.today() - last).days
    except Exception:  # noqa: BLE001
        pass
    return {"source": source, "snapshot": snapshot, "lastPriceDate": last, "ageDays": age}


@app.get("/api/meta")
def meta():
    try:
        return Json(meta_payload())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Database dan snapshot R2 tidak tersedia: {exc}")


@app.post("/api/refresh")
def refresh():
    hist.reset_caches()
    for c in CACHES:
        c.clear()
    _evaluate.cache_clear()
    jobs.clear()
    return Json({"ok": True})


# ---------------------------------------------------------------- emiten
@ttl_cache(600)
def tickers_payload() -> list[dict]:
    return query(
        "SELECT ticker, COALESCE(NULLIF(sector, ''), 'Unknown') AS sector "
        "FROM emitens WHERE is_active = TRUE ORDER BY ticker;"
    ).to_dict("records")


@app.get("/api/tickers")
def tickers():
    return Json(tickers_payload())


@ttl_cache(300)
def prices_payload(ticker: str) -> dict:
    f = hist.load_prices([ticker], columns=["close_price", "volume", "is_no_trade"]).drop(columns="ticker")
    f = to_numeric(f[f["close_price"].notna()].copy(), ["close_price", "volume"])
    f["price_date"] = pd.to_datetime(f["price_date"])
    f = f.sort_values("price_date")
    return {
        "x": day(f["price_date"]), "close": f["close_price"].tolist(), "volume": f["volume"].tolist(),
        "noTrade": f["is_no_trade"].fillna(False).astype(bool).tolist(),
    }


@app.get("/api/emiten/{ticker}/prices")
def prices(ticker: str):
    return Json(prices_payload(ticker.upper()))


def build_annual(reports: pd.DataFrame) -> pd.DataFrame:
    a = reports[reports["period"] == "FY"].copy()
    if a.empty:
        return a
    a = a.sort_values("year").reset_index(drop=True)
    a["label"] = a["year"].astype(int).astype(str)
    rev = a["revenue"].where(a["revenue"] > 0)
    eq = a["total_equity"].where(a["total_equity"] > 0)
    a["gross_margin"] = a["gross_profit"] / rev
    a["net_margin"] = a["net_income"] / rev
    a["roe"] = a["net_income"] / eq
    a["der"] = a["total_liabilities"] / eq
    prior = a[["year", "revenue", "net_income"]].copy()
    prior["year"] += 1
    a = a.merge(prior, on="year", how="left", suffixes=("", "_py"))
    a["revenue_yoy"] = a["revenue"] / a["revenue_py"].where(a["revenue_py"] > 0) - 1
    a["net_income_yoy"] = a["net_income"] / a["net_income_py"].where(a["net_income_py"] > 0) - 1
    return a


def build_ytd(reports: pd.DataFrame, annual: pd.DataFrame) -> dict | None:
    interim = reports[reports["period"] != "FY"].copy()
    if interim.empty:
        return None
    interim["order"] = interim["period"].map(PERIOD_ORDER)
    latest = interim.sort_values(["year", "order"]).iloc[-1]
    if int(latest["year"]) <= (int(annual["year"].max()) if not annual.empty else 0):
        return None
    m = interim[(interim["year"] == latest["year"] - 1) & (interim["period"] == latest["period"])]
    prev = m.iloc[-1] if not m.empty else None
    rows = []
    for name, col in (("Pendapatan", "revenue"), ("Laba sebelum pajak", "operating_profit"), ("Laba bersih", "net_income")):
        now = latest[col] / 1e9
        before = None if prev is None else prev[col] / 1e9
        growth = None if before is None or pd.isna(before) or before <= 0 else now / before - 1
        rows.append({"name": name, "before": before, "now": now, "growth": growth})
    return {"period": latest["period"], "year": int(latest["year"]), "rows": rows}


@ttl_cache(300)
def financials_payload(ticker: str) -> dict:
    r = hist.load_financial_reports(tickers=[ticker], columns=["currency", *BALANCE, *FLOW]).drop(columns="ticker")
    r = to_numeric(r, AMOUNTS).drop_duplicates(["year", "period"], keep="last")
    a = build_annual(r)
    if a.empty:
        return {"annual": None}
    currency = a["currency"].dropna().iloc[-1] if a["currency"].notna().any() else "IDR"
    a[list(AMOUNTS)] = a[list(AMOUNTS)] / 1e9
    cols = ["year", "label", *AMOUNTS, *RATIOS]
    return {
        "annual": {c: a[c].tolist() for c in cols}, "currency": currency,
        "unit": f"{'Rp' if currency == 'IDR' else currency} miliar", "ytd": build_ytd(r, a),
    }


@app.get("/api/emiten/{ticker}/financials")
def financials(ticker: str):
    return Json(financials_payload(ticker.upper()))


HIST_COLS = ["period", "year", "status", "trigger_source", "direction", "confirmation", "growth_yoy", "z_score", "sur"]


@ttl_cache(300)
def scan_history_payload(ticker: str) -> list[dict]:
    try:
        f = query("SELECT * FROM scan_results WHERE ticker = %s;", (ticker,))
    except Exception:  # noqa: BLE001
        return []
    f = to_numeric(f, ["growth_yoy", "z_score", "sur"])
    if f.empty:
        return []
    f["order"] = f["period"].map(PERIOD_ORDER)
    f = f.sort_values(["year", "order"], ascending=False)
    return f[[c for c in HIST_COLS if c in f.columns]].to_dict("records")


@app.get("/api/emiten/{ticker}/scans")
def scan_history(ticker: str):
    return Json(scan_history_payload(ticker.upper()))


@ttl_cache(300)
def all_signals() -> list[dict]:
    return sr.fetch_signals(None, SIGNAL_STATUSES) if hist.database_available() else []


@app.get("/api/emiten/{ticker}/signals")
def ticker_signals(ticker: str):
    t = ticker.upper()
    return Json([
        {"detected": s["detected"], "period": s["period"], "year": s["year"], "status": s["status"]}
        for s in all_signals() if s["ticker"] == t
    ])


# ---------------------------------------------------------------- sinyal
def _confirmation(sub: pd.DataFrame, col: str) -> list[dict]:
    out = []
    for label in CONFIRMATION_ORDER:
        v = sub.loc[sub["confirmation"] == label, col].dropna()
        if len(v):
            out.append({"label": label, "mean": float(v.mean()), "n": len(v)})
    return out


@ttl_cache(300)
def performance_payload(since: date, entry_lag: int, max_gap: int, benchmark: str | None) -> dict:
    empty = {"available": True, "rows": [], "stats": {}, "confirm": {}, "prefix": "ret", "benchmarkMissing": False}
    if not hist.database_available():
        return {**empty, "available": False}
    signals = sr.fetch_signals(since, SIGNAL_STATUSES)
    if not signals:
        return empty
    tickers_ = sorted({s["ticker"] for s in signals})
    start = min(s["detected"] for s in signals) - pd.Timedelta(days=10)
    series = sr.fetch_series(tickers_, start, True)
    sectors = sr.fetch_sectors(tickers_)
    market_last = sr.fetch_market_last()
    bench = sr.fetch_series([benchmark], start, False).get(benchmark) if benchmark else None

    records = []
    for s in signals:
        e = sr.evaluate_signal(s, series.get(s["ticker"]), bench, sectors.get(s["ticker"], "Unknown"),
                               market_last, entry_lag, HORIZONS, max_gap)
        row = {k: e[k] for k in ("id", "ticker", "year", "period", "sector", "status", "direction",
                                 "trigger_source", "z", "sur", "confirmation", "detected",
                                 "entry_date", "entry_price", "flags")}
        for h in HORIZONS:
            row[f"ret_{h}d"] = e["returns"].get(h)
            row[f"excess_{h}d"] = e["excess"].get(h)
        records.append(row)
    df = pd.DataFrame(records)
    num_cols = [f"{p}_{h}d" for p in ("ret", "excess") for h in HORIZONS]
    df = to_numeric(df, num_cols)

    has_excess = bool(benchmark) and df[[f"excess_{h}d" for h in HORIZONS]].notna().any().any()
    prefix = "excess" if has_excess else "ret"
    stats, confirm = {}, {}
    for d in ("POSITIVE", "NEGATIVE", "MIXED"):
        sub = df[df["direction"] == d]
        stats[d] = {str(h): summarize(sub[f"{prefix}_{h}d"], d == "NEGATIVE") for h in HORIZONS}
        confirm[d] = {str(h): _confirmation(sub, f"{prefix}_{h}d") for h in HORIZONS}
    return {
        "available": True, "rows": df.to_dict("records"), "stats": stats, "confirm": confirm,
        "prefix": prefix, "benchmarkMissing": bool(benchmark) and not has_excess,
        "assumptions": {"entryLag": entry_lag, "maxGap": max_gap},
    }


@app.get("/api/signals/performance")
def performance(since: date, entry_lag: int | None = None, max_gap: int | None = None, benchmark: str | None = None):
    return Json(performance_payload(
        since,
        sr.DEFAULT_ENTRY_LAG if entry_lag is None else entry_lag,
        sr.DEFAULT_MAX_ENTRY_GAP_DAYS if max_gap is None else max_gap,
        benchmark.strip().upper() if benchmark else None,
    ))


@ttl_cache(300)
def scan_periods_payload() -> list[dict]:
    f = query("SELECT DISTINCT year, period FROM scan_results;")
    f["order"] = f["period"].map(PERIOD_ORDER)
    return f.sort_values(["year", "order"], ascending=False)[["year", "period"]].to_dict("records")


@app.get("/api/scans/periods")
def scan_periods():
    try:
        return Json(scan_periods_payload())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Tabel scan_results belum bisa dibaca: {exc}")


@ttl_cache(300)
def scan_results_payload(year: int, period: str) -> dict:
    f = query("SELECT * FROM scan_results WHERE year = %s AND period = %s;", (year, period))
    f = to_numeric(f, ["growth_yoy", "sector_median_growth", "z_score", "sur",
                       "revenue_curr", "revenue_prev", "net_income_curr", "net_income_prev"])
    keep = ["ticker", "sector", "status", "direction", "trigger_source", "confirmation", "growth_yoy",
            "sector_median_growth", "z_score", "z_source", "sur", "revenue_curr", "revenue_prev",
            "net_income_curr", "net_income_prev", "note"]
    return {"counts": f["status"].value_counts().to_dict(), "rows": f[[c for c in keep if c in f.columns]].to_dict("records")}


@app.get("/api/scans/{year}/{period}")
def scan_results(year: int, period: str):
    return Json(scan_results_payload(year, period))


# ---------------------------------------------------------------- makro
@ttl_cache(600)
def table_columns(name: str) -> list[str]:
    return query(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position;", (name,),
    )["column_name"].tolist()


def pick(columns: list[str], candidates: tuple) -> str | None:
    return next((c for c in candidates if c in columns), None)


def macro_mapping() -> tuple[dict, list[str]]:
    cols = table_columns("macro_indicators")
    if not cols:
        raise HTTPException(404, "Tabel macro_indicators tidak ditemukan.")
    mapping = {role: pick(cols, cands) for role, cands in MACRO_ROLES.items()}
    missing = [r for r, c in mapping.items() if c is None]
    if missing:
        raise HTTPException(422, f"Kolom macro_indicators belum dikenali ({', '.join(missing)}). Kolom yang ada: {', '.join(cols)}.")
    return mapping, cols


@ttl_cache(600)
def macro_names() -> dict:
    cols = table_columns("macro_dictionary")
    k, n = pick(cols, MACRO_ROLES["key"]), pick(cols, MACRO_NAME_CANDIDATES)
    if not k or not n:
        return {}
    f = query(f'SELECT "{k}" AS key, "{n}" AS name FROM macro_dictionary;')
    return dict(zip(f["key"], f["name"]))


@ttl_cache(600)
def macro_overview_payload() -> list[dict]:
    m, cols = macro_mapping()
    k, d, v = m["key"], m["date"], m["value"]
    src_in = ', "data_source"' if "data_source" in cols else ""
    src_out = ", l.data_source AS source" if "data_source" in cols else ""
    f = query(f"""
        WITH latest AS (
            SELECT DISTINCT ON ("{k}") "{k}" AS key, "{d}" AS last_date, "{v}" AS last_value{src_in}
            FROM macro_indicators WHERE "{v}" IS NOT NULL ORDER BY "{k}", "{d}" DESC
        )
        SELECT l.key, l.last_date, l.last_value, m.value AS month_ago, y.value AS year_ago{src_out}
        FROM latest l
        LEFT JOIN LATERAL (
            SELECT "{v}" AS value FROM macro_indicators t
            WHERE t."{k}" = l.key AND t."{d}" <= l.last_date - INTERVAL '1 month' AND t."{v}" IS NOT NULL
            ORDER BY t."{d}" DESC LIMIT 1) m ON TRUE
        LEFT JOIN LATERAL (
            SELECT "{v}" AS value FROM macro_indicators t
            WHERE t."{k}" = l.key AND t."{d}" <= l.last_date - INTERVAL '1 year' AND t."{v}" IS NOT NULL
            ORDER BY t."{d}" DESC LIMIT 1) y ON TRUE
        ORDER BY l.key;""")
    f = to_numeric(f, ["last_value", "month_ago", "year_ago"])
    names = macro_names()
    f["name"] = f["key"].map(lambda x: names.get(x) if pd.notna(names.get(x)) else None)
    f["change1m"] = f["last_value"] / f["month_ago"].where(f["month_ago"] > 0) - 1
    f["change12m"] = f["last_value"] / f["year_ago"].where(f["year_ago"] > 0) - 1
    return f.drop(columns=["month_ago", "year_ago"]).to_dict("records")


@app.get("/api/macro/overview")
def macro_overview():
    return Json(macro_overview_payload())


def correlation(data: pd.DataFrame, keys: list[str]) -> dict | None:
    cols = {}
    for key in keys:
        s = data[data["key"] == key].set_index("obs_date")["value"].resample("MS").last().dropna()
        if len(s) < 6:
            continue
        cols[key] = s.pct_change() if (s > 0).all() else s.diff()
    if len(cols) < 2:
        return None
    m = pd.DataFrame(cols).dropna().corr()
    return {"keys": list(m.columns), "matrix": m.values.tolist()}


@ttl_cache(600)
def macro_series_payload(keys: tuple, years: int | None) -> dict:
    m, cols = macro_mapping()
    k, d, v = m["key"], m["date"], m["value"]
    f = query(
        f'SELECT "{k}" AS key, "{d}" AS obs_date, "{v}" AS value FROM macro_indicators '
        f'WHERE "{k}" = ANY(%s) AND "{v}" IS NOT NULL ORDER BY "{d}";', (list(keys),),
    )
    f = to_numeric(f, ["value"])
    f["obs_date"] = pd.to_datetime(f["obs_date"])
    f = f.dropna(subset=["value"])
    if years and not f.empty:
        f = f[f["obs_date"] >= f["obs_date"].max() - pd.DateOffset(years=years)]
    series = {key: {"x": day(g["obs_date"]), "y": g["value"].tolist()} for key, g in f.groupby("key")}
    return {"series": series, "correlation": correlation(f, list(keys))}


@app.get("/api/macro/series")
def macro_series(keys: list[str] = Query(...), years: int | None = None):
    return Json(macro_series_payload(tuple(keys), years))


# ---------------------------------------------------------------- status data
@ttl_cache(60)
def status_payload() -> dict:
    def run(sql: str) -> dict:
        try:
            return table(query(sql))
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    out = {
        "prices": run("SELECT MAX(price_date) AS tanggal_terakhir, COUNT(DISTINCT ticker) AS jumlah_emiten FROM daily_prices;"),
        "signals": run("SELECT COUNT(*) AS jumlah, MIN(detected_at)::date AS pertama, MAX(detected_at)::date AS terakhir FROM signal_log;"),
        "reports": run("SELECT year AS tahun, period AS periode, COUNT(*) AS jumlah_emiten FROM financial_reports "
                       "GROUP BY year, period ORDER BY year DESC, period DESC LIMIT 8;"),
        "scans": run("SELECT year AS tahun, period AS periode, COUNT(*) AS jumlah, "
                     "date_trunc('second', MAX(computed_at)) AS dihitung FROM scan_results "
                     "GROUP BY year, period ORDER BY year DESC, period DESC LIMIT 8;"),
    }
    try:
        cols = table_columns("macro_indicators")
        k, d = pick(cols, MACRO_ROLES["key"]), pick(cols, MACRO_ROLES["date"])
        out["macro"] = run(f'SELECT "{k}" AS indikator, MAX("{d}") AS tanggal_terakhir FROM macro_indicators GROUP BY 1 ORDER BY 2 ASC;') if k and d else None
    except Exception as exc:  # noqa: BLE001
        out["macro"] = {"error": str(exc)}
    return out


@app.get("/api/status")
def status():
    return Json(status_payload())


# ---------------------------------------------------------------- rezim
@lru_cache(maxsize=24)
def _evaluate(ticker, stamp, refit_every, enter, exit_, vol, lag, smooth, band, rf, size):
    close, probs, fits = jobs.get(ticker, refit_every)["result"]
    cfg = rs.RegimeConfig(enter_prob=enter, exit_prob=exit_, vol_target=vol, refit_every=refit_every,
                          execution_lag=lag, prob_smooth_span=smooth, rebalance_band=band,
                          risk_free=rf, size_by_prob=size)
    return rs.evaluate(close, probs, fits, cfg)


def regime_payload(result: dict, days: int | None) -> dict:
    cfg, eq_all = result["config"], result["equity"]
    start = eq_all.index[0] if days is None else max(eq_all.index[0], eq_all.index[-1] - pd.Timedelta(days=days))
    comp, held = result["components"].loc[start:], result["held"].loc[start:]
    net, gross = result["net"].loc[start:], result["gross"].loc[start:]
    events = {}
    for key, dates in result["events"].items():
        dates = dates[dates >= start]
        events[key] = {"x": day(dates), "y": comp.loc[dates, "close"].tolist()}
    metrics = rs.performance_metrics(net, gross, held, cfg).rename(index=REGIME_LABELS)
    summary = result["summary"]
    return {
        "state": "ready", "minDuration": REGIME_MIN_DURATION,
        "equity": pack(eq_all.loc[start:, list(REGIME_SERIES)]),
        "comp": pack(comp[["close", "hist", "calm", "gate"]]),
        "position": pack(held[["macd_mrs"]]),
        "events": events, "thresholds": {"enter": cfg.enter_prob, "exit": cfg.exit_prob},
        "metrics": table(metrics, "Strategi"),
        "conditional": table(rs.regime_conditional_sharpe(gross, result["probs"], cfg), "Item"),
        "summary": table(summary, "Rezim"),
        "fits": table(result["fits"].tail(24).round(4), "Tanggal"),
        "volatileDuration": float(summary.loc["Gejolak", "Durasi rata-rata (hari)"]),
        "switchesPerYear": result["gate_switches_per_year"], "refits": result["refits"],
        "period": [str(eq_all.index[0].date()), str(eq_all.index[-1].date())],
    }


@app.get("/api/regime/{ticker}")
def regime(
    ticker: str,
    days: int | None = Query(None, ge=30),
    enter_prob: float = Query(D.enter_prob, ge=0.5, le=0.95),
    exit_prob: float = Query(D.exit_prob, ge=0.05, le=0.6),
    vol_target: float = Query(D.vol_target, ge=0.05, le=0.5),
    refit_every: int = Query(D.refit_every, ge=5, le=63),
    execution_lag: int = Query(D.execution_lag, ge=1, le=2),
    prob_smooth_span: int = Query(D.prob_smooth_span, ge=1, le=30),
    rebalance_band: float = Query(D.rebalance_band, ge=0, le=0.3),
    risk_free: float = Query(D.risk_free, ge=0, le=0.15),
    size_by_prob: bool = D.size_by_prob,
):
    t = ticker.upper()
    job = jobs.get(t, refit_every)
    if job["state"] == "running":
        return Json({"state": "running", "elapsed": round(time.time() - job["started"], 1)}, 202)
    if job["state"] == "invalid":
        raise HTTPException(422, job["message"])
    if job["state"] == "error":
        raise HTTPException(500, job["message"])
    result = _evaluate(t, job["done_at"], refit_every, enter_prob, exit_prob, vol_target,
                       execution_lag, prob_smooth_span, rebalance_band, risk_free, size_by_prob)
    return Json(regime_payload(result, days))

from api.portfolio import router as portfolio_router  # noqa: E402

app.include_router(portfolio_router)
from api.ai import router as ai_router 
app.include_router(ai_router)

# ---------------------------------------------------------------- produksi: layani hasil build UI
class SPA(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


DIST = Path(__file__).resolve().parent.parent / "ui" / "dist"
if DIST.exists():
    app.mount("/", SPA(directory=DIST, html=True), name="ui")