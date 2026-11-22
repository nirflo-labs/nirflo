import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, useTickers } from "../lib/api";
import { AI_STATUS_KEY, useAiModels, useAiStatus, type AiModel, type ChatMessage } from "../lib/ai";
import { ago, MAX_SEND, pickContext, shareContext, useContextItems } from "../lib/aiContext";
import { resolveContext } from "../lib/aiRetrieve";
import { useAiScope } from "../lib/aiScope";
import { store } from "../lib/hooks";
import { OpenRouterConnect } from "../components/OpenRouterConnect";
import "../ai.css";

type Flash = { kind: "ok" } | { kind: "err"; message: string };

const MODEL_KEY = "aiModel";
const AUTO_KEY = "aiAutoContext";
const HISTORY_LIMIT = 12;
// Tiga model "populer": potongan id yang dicocokkan ke daftar model OpenRouter yang sedang aktif.
// Hint yang tidak ada di daftar otomatis dilewati. Ubah di sini bila peringkat OpenRouter berubah.
const POPULAR_HINTS = ["deepseek/deepseek-v4", "anthropic/claude-opus-5", "z-ai/glm-5"];
const FREE_LIMIT = 5;
const SEARCH_LIMIT = 8;
const CUSTOM_ID = /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/;
const STARTERS = [
  "Jelaskan Sharpe ratio dengan bahasa sederhana.",
  "Apa arti z-score pada sinyal pertumbuhan laba?",
  "Bagaimana cara membaca kontribusi risiko di sebuah portofolio?",
];

type ChatReply = { content: string; model?: string; scope?: "on" | "off"; used?: string[] };
type CtxPayload = { id: string; kind: string; label: string; data: unknown };

// Pengiriman memakai api() langsung agar snapshot halaman ikut terkirim.
const chat = (body: { model: string; messages: ChatMessage[]; context: CtxPayload[]; signal: AbortSignal }) =>
  api<ChatReply>("/ai/chat", undefined, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: body.signal,
    body: JSON.stringify({ model: body.model, messages: body.messages, context: body.context }),
  });

// Efek cahaya mengikuti pointer pada permukaan kaca.
const light = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--px", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--py", `${e.clientY - r.top}px`);
};

/**
 * Membuka Profil > Koneksi AI, tempat saklar akses data berada.
 * Memakai tombol akun Clerk yang sudah ada (nama class Clerk: cl-userButtonTrigger dll), sehingga halaman khusus
 * "Koneksi AI" ikut muncul. Bila struktur Clerk berubah, tombol tidak melakukan apa-apa.
 */
async function find(selector: string, text?: string, tries = 20): Promise<HTMLElement | null> {
  for (let i = 0; i < tries; i++) {
    const hit = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => !text || el.textContent?.includes(text));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
async function openAiSettings() {
  (await find(".cl-userButtonTrigger", undefined, 3))?.click();
  (await find(".cl-userButtonPopoverActionButton__manageAccount"))?.click();
  (await find(".cl-navbarButton", "Koneksi AI"))?.click();
}

// Jawaban AI dirender sebagai markdown (judul, daftar, tabel, kode). HTML mentah tidak dirender, jadi aman.
const MD_COMPONENTS: Components = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" />,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  table: ({ node, ...p }) => <div className="ai-table"><table {...p} /></div>,
};

const Reply = memo(function Reply({ text }: { text: string }) {
  return (
    <div className="ai-md">
      <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</Markdown>
    </div>
  );
});

// "DeepSeek: DeepSeek V4 Flash (free)" -> vendor "DeepSeek", title "DeepSeek V4 Flash"
const parts = (name: string) => {
  const i = name.indexOf(": ");
  return { vendor: i > 0 ? name.slice(0, i) : "", title: (i > 0 ? name.slice(i + 2) : name).replace(/\s*\(free\)$/i, "") };
};

export default function AiPage() {
  const nav = useNavigate();
  const { state, pathname } = useLocation();
  const [flash, setFlash] = useState<Flash | null>(() => (state as { flash?: Flash } | null)?.flash ?? null);
  const status = useAiStatus();

  // Hasil dari halaman callback dibaca sekali, lalu dibersihkan supaya tidak muncul lagi setelah refresh.
  useEffect(() => {
    if (state) nav(pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notifikasi sukses hilang sendiri.
  useEffect(() => {
    if (flash?.kind !== "ok") return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div className="ai-page">
      <h2 className="ai-sr">Asisten AI</h2>

      {flash?.kind === "ok" && <div className="ai-notice ok" role="status">OpenRouter berhasil tersambung.</div>}
      {flash?.kind === "err" && (
        <div className="ai-notice err" role="alert">
          {flash.message}
          <button type="button" className="ai-btn ghost" onClick={() => setFlash(null)}>Tutup</button>
        </div>
      )}

      <OpenRouterConnect />
      {status.data?.connected && <AiChat />}
    </div>
  );
}

function ModelPicker({ value, models, loading, onChange }: {
  value: string; models: AiModel[]; loading: boolean; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Tanpa kata kunci: 3 populer, lalu model gratis. Dengan kata kunci: cari di semua model.
  const sections = useMemo(() => {
    const q = query.trim();
    if (q) {
      const needle = q.toLowerCase();
      const hits = models.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)).slice(0, SEARCH_LIMIT);
      const custom: AiModel[] = CUSTOM_ID.test(q) && !models.some((m) => m.id === q)
        ? [{ id: q, name: `Pakai id “${q}”`, context: null, free: false }] : [];
      const items = [...hits, ...custom];
      return items.length ? [{ title: "Hasil", items }] : [];
    }
    const popular = POPULAR_HINTS.map((h) => models.find((m) => m.id.includes(h))).filter((m): m is AiModel => !!m);
    const taken = new Set(popular.map((m) => m.id));
    const free = models.filter((m) => m.free && !taken.has(m.id)).slice(0, FREE_LIMIT);
    return [{ title: "Populer", items: popular }, { title: "Gratis", items: free }].filter((s) => s.items.length);
  }, [models, query]);
  const items = sections.flatMap((s) => s.items);

  useEffect(() => {
    if (!open) return;
    const outside = (e: globalThis.PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`ai-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (m: AiModel) => { onChange(m.id); setOpen(false); setQuery(""); };
  const glow = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = items[active];
      if (m) pick(m);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const selected = models.find((m) => m.id === value);
  const label = selected ? parts(selected.name).title : value || (loading ? "Memuat model…" : "Pilih model");

  return (
    <div className="ai-select-wrap" ref={box}>
      <button
        type="button" className="ai-select" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setActive(0); }}
      >
        <span className={selected || value ? "" : "ai-ph"}>{label}</span>
        <svg className="ai-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="ai-pop ai-model-pop">
          <input
            autoFocus role="combobox" aria-expanded aria-controls="ai-listbox" aria-activedescendant={items.length ? `ai-opt-${active}` : undefined}
            className="ai-search" placeholder="Cari model…" value={query} spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
          />
          <div className="ai-list" id="ai-listbox" role="listbox">
            {sections.map((s) => (
              <div key={s.title} role="group" aria-label={s.title}>
                <div className="ai-group">{s.title}</div>
                {s.items.map((m) => {
                  const i = items.indexOf(m);
                  const { vendor, title } = parts(m.name);
                  return (
                    <div
                      key={m.id} id={`ai-opt-${i}`} role="option" title={m.id} aria-selected={m.id === value}
                      className={`ai-opt${i === active ? " on" : ""}${m.id === value ? " sel" : ""}`}
                      onPointerEnter={() => setActive(i)} onPointerMove={glow} onClick={() => pick(m)}
                    >
                      <span className="ai-opt-name">{title}</span>
                      <span className="ai-opt-meta">
                        {vendor}
                        {m.free && s.title !== "Gratis" && <em className="ai-tag">Gratis</em>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {items.length === 0 && <p className="ai-hint">{loading ? "Memuat daftar model…" : "Tidak ada model yang cocok."}</p>}
            {!query && models.length > 0 && <p className="ai-hint">Ketik untuk mencari {models.length} model lainnya.</p>}
            {query && items.length >= SEARCH_LIMIT && <p className="ai-hint">Ketik lebih spesifik untuk mempersempit hasil.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextPicker({ skip, setSkip, auto, setAuto }: { skip: string[]; setSkip: (v: string[]) => void; auto: boolean; setAuto: (v: boolean) => void }) {
  const items = useContextItems();
  const scope = useAiScope().data?.scope ?? "off";
  const [show, setShow] = useState(false);
  const locked = (k: string) => scope === "off" || (k === "portfolio" && scope !== "portfolio");
  const active = pickContext(items, scope, skip);
  const activeIds = new Set(active.map((i) => i.id));
  const toggle = (id: string) => setSkip(skip.includes(id) ? skip.filter((x) => x !== id) : [...skip, id]);
  const pretty = useMemo(() => JSON.stringify(active.map(({ label, data }) => ({ label, data })), null, 2), [active]);

  const autoBtn = (
    <button
      type="button" className="ai-link" aria-pressed={auto} disabled={scope === "off"}
      title="Saat nyala, data yang relevan dengan pertanyaanmu diambil otomatis tanpa perlu membuka halamannya."
      onClick={() => setAuto(!auto)}
    >
      Otomatis: {auto && scope !== "off" ? "nyala" : "mati"}
    </button>
  );
  if (!items.length) {
    return (
      <div className="ai-ctx">
        <div className="ai-ctx-row">
          <span className="ai-ctx-title">Konteks</span>
          <p className="ai-muted ai-ctx-empty ai-ctx-grow">
            {scope === "off" ? "Akses data dimatikan." : auto ? "Data yang relevan diambil otomatis dari pertanyaanmu, misalnya kode emiten, makro, atau portofolio." : "Belum ada konteks. Buka halaman terkait atau nyalakan mode otomatis."}
          </p>
          {scope === "off" ? <button type="button" className="ai-link" onClick={() => void openAiSettings()}>Nyalakan akses</button> : autoBtn}
        </div>
      </div>
    );
  }
  return (
    <div className="ai-ctx">
      <div className="ai-ctx-row">
        <span className="ai-ctx-title">Konteks</span>
        <div className="ai-ctx-chips">
          {items.map((i) => {
            const lock = locked(i.kind);
            const on = activeIds.has(i.id);
            const over = !lock && !on && !skip.includes(i.id);
            return (
              <button
                key={i.id} type="button" aria-pressed={on} disabled={lock || over}
                className={`ai-ctx-chip${on ? " on" : ""}${over ? " over" : ""}`}
                title={
                  lock ? (scope === "off" ? "Akses data dimatikan" : "Akses data portofolio dimatikan")
                    : over ? `Batas ${MAX_SEND} konteks per pertanyaan. Matikan salah satu yang lain.`
                    : `Diperbarui ${ago(i.at)}`
                }
                onClick={() => toggle(i.id)}
              >
                {i.label}
              </button>
            );
          })}
        </div>
        {scope === "off"
          ? <button type="button" className="ai-link" onClick={() => void openAiSettings()}>Nyalakan akses</button>
          : (
            <>
              {autoBtn}
              {active.length > 0 && (
                <button type="button" className="ai-link" aria-expanded={show} onClick={() => setShow((v) => !v)}>
                  {show ? "Tutup" : "Lihat"}
                </button>
              )}
            </>
          )}
      </div>
      {show && active.length > 0 && <div className="ai-preview" role="region" aria-label="Data yang dikirim ke AI"><pre>{pretty}</pre></div>}
    </div>
  );
}

function AiChat() {
  const qc = useQueryClient();
  const models = useAiModels();
  const [model, setModel] = useState(() => store.get(MODEL_KEY) ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [used, setUsed] = useState<Record<number, string[]>>({});
  const [auto, setAutoState] = useState(() => store.get(AUTO_KEY) !== "0");
  const [fetching, setFetching] = useState(false);
  const tickers = useTickers();
  const items = useContextItems();
  const scope = useAiScope().data?.scope ?? "off";
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, busy]);

  const pickModel = (id: string) => { setModel(id); store.set(MODEL_KEY, id); };
  const setAuto = (v: boolean) => { setAutoState(v); store.set(AUTO_KEY, v ? "1" : "0"); };

  const send = async (text = draft) => {
    const content = text.trim();
    if (!content || !model || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setError(null);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      // Data yang relevan dengan pertanyaan diambil dulu (baca-saja), lalu digabung dengan snapshot dari halaman yang sudah dibuka.
      let fetched: Awaited<ReturnType<typeof resolveContext>> = [];
      if (auto && scope !== "off") {
        setFetching(true);
        fetched = await resolveContext(content, scope, qc, tickers.data ?? []).catch(() => []);
        setFetching(false);
        fetched.forEach((f) => shareContext(f.id, f.kind, f.label, f.data));
      }
      const merged = [...fetched, ...items.filter((i) => !fetched.some((f) => f.id === i.id))];
      const context = pickContext(merged, scope, skip).map(({ id, kind, label, data }) => ({ id, kind, label, data }));
      const res = await chat({ model, messages: next.slice(-HISTORY_LIMIT), context, signal: ac.signal });
      setMessages([...next, { role: "assistant", content: res.content || "(Model tidak mengembalikan jawaban.)" }]);
      if (res.used?.length) setUsed((u) => ({ ...u, [next.length]: res.used as string[] }));
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(
        e instanceof ApiError && (e.status === 422 || e.status === 413)
          ? "Konteks yang dilampirkan terlalu banyak atau terlalu besar. Matikan beberapa konteks lalu coba lagi."
          : e instanceof Error ? e.message : "Permintaan gagal.",
      );
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    } finally {
      setFetching(false);
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const ready = model !== "";

  return (
    <section className="ai-card" aria-label="Obrolan AI" onPointerMove={light}>
      <header className="ai-head">
        <div className="ai-title">
          <div className="ai-title-row">
            <h2>Obrolan</h2>
            {messages.length > 0 && (
              <button type="button" className="ai-new" onClick={() => { setMessages([]); setUsed({}); setError(null); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Obrolan baru
              </button>
            )}
          </div>
          <p className="ai-muted">
            {scope === "off" ? "AI tidak punya akses ke data atau hitungan di Nirflo." : "AI hanya melihat ringkasan yang kamu lampirkan."}
          </p>
        </div>
        <div className="ai-tools">
          <div className="ai-model" aria-label="Model">
            <ModelPicker value={model} models={models.data ?? []} loading={models.isPending} onChange={pickModel} />
          </div>
          <button type="button" className="ai-btn ghost" onClick={() => void openAiSettings()} title="Profil, lalu Koneksi AI">Akses data</button>
        </div>
      </header>
      {models.isError && <small className="ai-muted">Daftar model tidak dapat dimuat.</small>}

      <div className="ai-log" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-empty">
            <p className="ai-muted">{ready ? "Mulai dengan salah satu pertanyaan ini, atau tulis sendiri." : "Pilih model untuk mulai."}</p>
            <div className="ai-actions">
              {STARTERS.map((q) => (
                <button key={q} type="button" className="ai-chip" disabled={!ready || busy} onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.role === "assistant" ? (
              <>
                {used[i] && <span className="ai-used" title={used[i].join(", ")}>Memakai data: {used[i].join(", ")}</span>}
                <Reply text={m.content} />
              </>
            ) : m.content}
          </div>
        ))}
        {busy && <div className="ai-msg assistant pending" aria-label="Sedang menjawab"><i /><i /><i />{fetching && <span className="ai-fetching">Mengambil data…</span>}</div>}
        <div ref={end} />
      </div>

      {error && <div className="ai-notice err" role="alert">{error}</div>}

      <ContextPicker skip={skip} setSkip={setSkip} auto={auto} setAuto={setAuto} />

      <div className="ai-compose">
        <textarea
          value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
          rows={2} maxLength={4000} placeholder="Tulis pertanyaan… (Enter kirim, Shift+Enter baris baru)" aria-label="Pesan"
        />
        <button type="button" className="ai-btn primary" onClick={() => void send()} disabled={busy || !draft.trim() || !ready}>Kirim</button>
      </div>
      <p className="ai-muted ai-foot">Jawaban AI bisa keliru dan bukan nasihat investasi.</p>
    </section>
  );
}