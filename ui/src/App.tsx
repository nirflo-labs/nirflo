import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as KeyEvt, type PointerEvent as PtrEvt } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { UserButton, useUser } from "@clerk/react";
import { useMeta } from "./lib/api";
import { day, stampLabel } from "./lib/format";
import { store } from "./lib/hooks";
import { Icon, type IconName } from "./components/Icon";
import { Logo } from "./components/Logo";
import { OpenRouterConnect } from "./components/OpenRouterConnect";
import { TickerSearch } from "./components/TickerSearch";
import { Empty, ErrorBoundary, ErrorState, Loading } from "./components/ui";
import { AiAccessToggle } from "./components/AiAccess";

const HomePage = lazy(() => import("./pages/HomePage"));
const EmitenPage = lazy(() => import("./pages/EmitenPage"));
const SignalsPage = lazy(() => import("./pages/SignalsPage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const MacroPage = lazy(() => import("./pages/MacroPage"));
const StatusPage = lazy(() => import("./pages/StatusPage"));
const AiPage = lazy(() => import("./pages/AiPage"));
const OpenRouterCallbackPage = lazy(() => import("./pages/OpenRouterCallbackPage"));

const NAV: readonly { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Beranda", icon: "home", end: true },
  { to: "/emiten", label: "Emiten", icon: "chart" },
  { to: "/sinyal", label: "Sinyal", icon: "zap" },
  { to: "/portofolio", label: "Portofolio", icon: "pie" },
  { to: "/makro", label: "Makro", icon: "globe" },
  { to: "/ai", label: "Asisten AI", icon: "sparkles" },
];

const TITLES: Record<string, string> = {
  "": "Beranda",
  emiten: "Emiten",
  sinyal: "Sinyal",
  portofolio: "Portofolio",
  makro: "Makro",
  ai: "Asisten AI",
  auth: "Menyambungkan AI",
  status: "Status data",
};

function pageTitle(pathname: string): string {
  const [, section = "", ticker] = pathname.split("/");
  if (section === "emiten" && ticker) return `${decodeURIComponent(ticker)} · Emiten · Nirflo`;
  const name = TITLES[section];
  return name ? `${name} · Nirflo` : "Nirflo";
}

const MIN_W = 72, MAX_W = 340, DEFAULT_W = 240, SNAP_W = 140;

function useSidebar() {
  const [w, setW] = useState(() => {
    const n = Number(store.get("side"));
    return n >= MIN_W && n <= MAX_W ? n : DEFAULT_W;
  });
  const [drag, setDrag] = useState(false);
  const latest = useRef(w);
  const apply = (v: number, persist: boolean) => {
    const c = Math.min(MAX_W, Math.max(MIN_W, v));
    latest.current = c;
    setW(c);
    if (persist) store.set("side", String(c));
  };
  const settle = () => apply(latest.current < SNAP_W ? MIN_W : Math.max(200, latest.current), true);
  const toggle = () => apply(latest.current < SNAP_W ? DEFAULT_W : MIN_W, true);
  const onPointerDown = (e: PtrEvt<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDrag(true);
    const move = (ev: PointerEvent) => apply(ev.clientX, false);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDrag(false);
      settle();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyEvt<HTMLDivElement>) => {
    if (e.key === "Enter") toggle();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      apply(latest.current + (e.key === "ArrowLeft" ? -16 : 16), false);
      settle();
    }
  };
  return { w, drag, collapsed: w < SNAP_W, toggle, onPointerDown, onKeyDown };
}

export default function App() {
  const meta = useMeta();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const { user } = useUser();
  const side = useSidebar();
  const m = meta.data;
  const stale = m?.ageDays != null && m.ageDays > 4;
  const warn = m?.source === "snapshot" || stale;
  const pill = m
    ? `${m.source === "snapshot" ? `Snapshot R2 ${m.snapshot ? stampLabel(m.snapshot) : ""}` : `Data per ${day(m.lastPriceDate)}`}${stale ? " · tertinggal" : ""}`
    : meta.isPending ? "Memeriksa…" : "";

  useEffect(() => {
    document.title = pageTitle(pathname);
  }, [pathname]);

  const pickTicker = (t: string) => {
    const tab = pathname.startsWith("/emiten") ? new URLSearchParams(search).get("tab") : null;
    nav(`/emiten/${t}${tab ? `?tab=${tab}` : ""}`);
  };

  return (
    <div
      className={`shell${side.collapsed ? " collapsed" : ""}${side.drag ? " dragging" : ""}`}
      style={{ "--side": `${side.w}px` } as CSSProperties}
    >
      <a className="skip" href="#main">Lewati ke konten</a>
      <aside className="side">
        <h1>
          <Link to="/" className="brand" aria-label="Nirflo, ke beranda" title="Nirflo">
            <Logo size={32} />
            <span className="label">Nirflo</span>
          </Link>
        </h1>
        <nav aria-label="Halaman utama">
          {NAV.map(({ to, label, icon, end }) => (
            <NavLink key={to} to={to} end={end} title={side.collapsed ? label : undefined} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={icon} /><span className="label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <UserButton>
            <UserButton.UserProfilePage label="Koneksi AI" url="ai" labelIcon={<Icon name="sparkles" size={16} />}>
              <OpenRouterConnect flat />
              <AiAccessToggle flat />
            </UserButton.UserProfilePage>
          </UserButton>
          <span className="label acc-name">{user?.firstName ?? user?.username ?? ""}</span>
        </div>
        <button type="button" className="collapse" onClick={side.toggle} title={side.collapsed ? "Perluas menu" : "Ciutkan menu"} aria-label={side.collapsed ? "Perluas menu" : "Ciutkan menu"}>
          <Icon name={side.collapsed ? "right" : "left"} /><span className="label">Ciutkan</span>
        </button>
        <div
          className="side-resize" role="separator" aria-orientation="vertical" aria-label="Ubah lebar menu"
          aria-valuenow={side.w} tabIndex={0} title="Seret untuk mengubah lebar, klik dua kali untuk ciutkan"
          onPointerDown={side.onPointerDown} onKeyDown={side.onKeyDown} onDoubleClick={side.toggle}
        />
      </aside>
      <main id="main">
        <div className="topbar">
          {pathname !== "/" && <TickerSearch compact globalKey placeholder="Cari emiten…" onPick={pickTicker} />}
          <NavLink to="/status" className={`pill${warn ? " warn" : ""}`} title="Lihat status data">
            <span className={`dot ${warn ? "warn" : "ok"}`} aria-hidden />
            <span className="pill-text">{pill}</span>
          </NavLink>
        </div>
        {meta.isError ? (
          <ErrorState error={meta.error} retry={() => meta.refetch()} />
        ) : (
          <>
            {m?.source === "snapshot" && (
              <div className="banner" role="status">
                Database tidak terjangkau. Tampilan memakai snapshot R2; Kinerja sinyal, Portofolio, dan beberapa tabel tidak tersedia.
              </div>
            )}
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/emiten/:ticker?" element={<EmitenPage />} />
                  <Route path="/sinyal" element={<SignalsPage />} />
                  <Route path="/portofolio" element={<PortfolioPage />} />
                  <Route path="/makro" element={<MacroPage />} />
                  <Route path="/ai" element={<AiPage />} />
                  <Route path="/auth/openrouter/callback" element={<OpenRouterCallbackPage />} />
                  <Route path="/status" element={<StatusPage />} />
                  <Route path="*" element={<Empty>Halaman tidak ditemukan.</Empty>} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </>
        )}
      </main>
    </div>
  );
}