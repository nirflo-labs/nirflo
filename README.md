# Nirflo

A quantitative research terminal for Indonesian equities (IDX). It collects financial filings and prices, scores earnings-driven signals, evaluates how those signals performed, and shows the results in a local web dashboard.

## What it does

- Fetches IDX XBRL filings and daily prices, and stores them in PostgreSQL.
- Scans each reporting period for revenue and earnings surprises (cross-sectional Z-score, SUR, profit confirmation).
- Measures forward returns of past signals by direction, horizon, and earnings confirmation.
- Estimates volatility regimes with a Markov switching model and combines them with a MACD signal (walk-forward backtest).
- Serves everything through a small API and a TypeScript dashboard.

## Architecture

```
IDX filings, yfinance  ->  run.py (fetch, prices)  ->  PostgreSQL  ->  analytics/  ->  api/ (FastAPI)  ->  ui/ (React)
                                                          |
                                                          +-- Parquet archive and R2 snapshot (read fallback)
```

| Folder | Purpose |
|---|---|
| `api/` | FastAPI service. Thin layer over `core/` and `analytics/`. |
| `analytics/` | Growth scanner, signal report, regime signal, portfolio logic. |
| `core/` | Data access (`history.py`), configuration, portfolio storage. |
| `pipeline/` | Pipeline steps such as XBRL backup. |
| `data/r2/` | Database export and Cloudflare R2 backup scripts. |
| `ui/` | Dashboard (Vite, React, TypeScript). |
| `tests/` | Tests. |

Data access follows a hot/cold split. Recent data (last 2 years) is read from PostgreSQL. Older data is read from local Parquet files through DuckDB. If the database is unreachable, the latest snapshot in Cloudflare R2 is used.

## Requirements

- Linux or WSL2 (developed on Ubuntu 24.04)
- Python 3.12
- Node.js 20 or newer
- PostgreSQL
- Docker (optional, only for the browser fallback used when IDX requires a Cloudflare check)

## Setup

```bash
git clone https://github.com/nirflo-dev/nirflo.git
cd nirflo

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd ui
npm install
```

Create a `.env` file in the project root. Do not commit it. Variable names are defined in `core/config.py` and `data/r2/r2_config.py`. At minimum:

```
# PostgreSQL connection (see core/config.py for exact names)
...

# Cloudflare R2 (backup and snapshot fallback)
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_READ_ACCESS_KEY_ID=...
R2_READ_SECRET_ACCESS_KEY=...
```

## Running the data pipeline

```bash
python run.py prices          # update daily prices
python run.py fetch           # fetch and parse new filings, then run the scanner
python daily.py               # run the configured daily steps in order
```

Signal performance report:

```bash
python -m analytics.signal_report --csv reports/signals.csv
```

Portfolio evaluation:

```bash
python portfolio_cli.py evaluate-all
```

If IDX presents a Cloudflare check during `fetch`, the script falls back to a Chrome instance (remote debugging on port 9222) that can be viewed through noVNC (port 6080). Start it with `docker compose up -d` and complete the check manually.

## Running the dashboard

Development uses two terminals.

```bash
# Terminal 1, from the project root
uvicorn api.main:app --reload --reload-dir api --reload-dir analytics --reload-dir core --port 8000

# Terminal 2
cd ui
npm run dev
```

Open http://localhost:5173.

For a single-process setup, build the UI and let the API serve it:

```bash
cd ui && npm run build && cd ..
uvicorn api.main:app --port 8000
```

Then open http://localhost:8000.

## Dashboard pages

- **Emiten**: price chart with signal markers, annual financials, scan history, and regime analysis for one ticker.
- **Sinyal**: forward returns of past signals, and scan results by period.
- **Makro**: macro indicators with comparison and monthly correlation.
- **Status data**: freshness of prices, filings, scans, and macro series.

The selected ticker, tab, range, and filters are stored in the URL, so any view can be bookmarked.

## API

All endpoints are under `/api`.

| Endpoint | Description |
|---|---|
| `GET /meta` | Data source (database or snapshot) and last price date |
| `POST /refresh` | Clear caches and reload data |
| `GET /tickers` | Active tickers and sectors |
| `GET /emiten/{ticker}/prices` | Price series |
| `GET /emiten/{ticker}/financials` | Annual figures, ratios, year-to-date |
| `GET /emiten/{ticker}/scans` | Scan history for a ticker |
| `GET /emiten/{ticker}/signals` | Signal markers for the price chart |
| `GET /signals/performance` | Forward returns by direction and horizon |
| `GET /scans/periods`, `GET /scans/{year}/{period}` | Scan results |
| `GET /macro/overview`, `GET /macro/series` | Macro indicators |
| `GET /status` | Data freshness tables |
| `GET /regime/{ticker}` | Regime backtest. Returns 202 while the model is fitting, then the result. |

The regime model is computed in a separate process and cached for one hour. Changing only the trading parameters re-evaluates the cached probabilities, without refitting.

## Backup

`data/r2/` contains scripts to export the PostgreSQL database (custom-format dump and Parquet per table) and upload it to Cloudflare R2 with retention (7 daily, 4 weekly, 12 monthly). `archive_copy.py` copies a frozen snapshot to an `archive/` prefix.

## Known limitations

- Only prices from the last 10 days are re-fetched, so adjusted-close values can go stale after corporate actions.
- Signal performance needs a live database connection. In snapshot mode that page is empty.
- Browser verification for IDX needs a person present. A scheduled run stops if a challenge appears.
- Regime fits are recomputed after an API restart, because the cache is in memory.
- UI added

## Disclaimer

This is a research tool. Nothing here is investment advice.
