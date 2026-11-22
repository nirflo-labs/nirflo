import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, useTickers } from "../lib/api";
import { AI_STATUS_KEY, useAiModels, useAiStatus, type AiModel, type ChatMessage } from "../lib/ai";
import type { CtxItem } from "../lib/aiContext";
import { resolveContext } from "../lib/aiRetrieve";
import { useAiScope } from "../lib/aiScope";
import { store } from "../lib/hooks";
import { OpenRouterConnect } from "../components/OpenRouterConnect";
import "../ai.css";

type Flash = { kind: "ok" } | { kind: "err"; message: string };

const MODEL_KEY = "aiModel";
const HISTORY_LIMIT = 12;
// Tiga model "populer": potongan id yang dicocokkan ke daftar model OpenRouter yang sedang aktif.
// Hint yang tidak ada di daftar otomatis dilewati. Ubah di sini bila peringkat OpenRouter berubah.
const POPULAR_HINTS = ["deepseek/deepseek-v4", "anthropic/claude-opus-5", "z-ai/glm-5"];
const FREE_LIMIT = 5;
const SEARCH_LIMIT = 8;
const CUSTOM_ID = /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]+$/;
const GENERIC_STARTERS = [
  "Jelaskan Sharpe ratio dengan bahasa sederhana.",
  "Apa arti z-score pada sinyal pertumbuhan laba?",
  "Bagaimana cara membaca kontribusi risiko di sebuah portofolio?",
];
const DATA_STARTERS = [
  "Bagaimana laba bersih dan ROE BBRI dalam beberapa tahun terakhir?",
  "Bagaimana kondisi IHSG dan kurs rupiah belakangan ini?",
];
const PORTFOLIO_STARTER = "Bagaimana Sharpe dan kontribusi risiko portofolioku?";
const SIGNAL_STARTER = "Emiten mana yang punya sinyal pemindaian terkuat saat ini?";
const MAX_INPUT_PX = 168;

const isTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// Riwayat obrolan disimpan sampai "Obrolan baru" ditekan, jadi tetap ada setelah refresh atau pindah halaman.
const CHAT_KEY = "aiChat";
const STORED_LIMIT = 100; // batas jumlah pesan yang disimpan, supaya penyimpanan tidak membengkak
type SavedChat = { messages: ChatMessage[]; used: Record<number, string[]>; pending: string };

const EMPTY_CHAT: SavedChat = { messages: [], used: {}, pending: "" };

function loadChat(): SavedChat {
  try {
    const raw = store.get(CHAT_KEY);
    if (!raw) return EMPTY_CHAT;
    const d = JSON.parse(raw) as { messages?: unknown; used?: unknown };
    if (!Array.isArray(d.messages)) return EMPTY_CHAT;
    const valid = d.messages.every(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    if (!valid) return EMPTY_CHAT;
    const messages = d.messages as ChatMessage[];
    const used = d.used && typeof d.used === "object" ? (d.used as Record<number, string[]>) : {};
    // Pertanyaan terakhir yang belum sempat dijawab (halaman ditutup saat menunggu) dikembalikan ke kolom tulis.
    const last = messages[messages.length - 1];
    if (last?.role === "user") return { messages: messages.slice(0, -1), used, pending: last.content };
    return { messages, used, pending: "" };
  } catch {
    return EMPTY_CHAT;
  }
}

function saveChat(messages: ChatMessage[], used: Record<number, string[]>) {
  try {
    if (!messages.length) { store.set(CHAT_KEY, ""); return; }
    // Bila terlalu panjang, simpan pesan terbaru saja. Indeks "used" digeser ikut.
    const drop = Math.max(0, messages.length - STORED_LIMIT);
    const kept: Record<number, string[]> = {};
    for (const [k, v] of Object.entries(used)) {
      const i = Number(k) - drop;
      if (i >= 0) kept[i] = v;
    }
    store.set(CHAT_KEY, JSON.stringify({ messages: messages.slice(drop), used: kept }));
  } catch {
    // Penyimpanan penuh atau diblokir: obrolan tetap berjalan, hanya tidak tersimpan.
  }
}

type ChatReply = { content: string; model?: string; scope?: "on" | "off"; used?: string[] };
type CtxPayload = Pick<CtxItem, "id" | "kind" | "label" | "data">;

// Pengiriman memakai api() langsung agar ringkasan data ikut terkirim.
const chat = (body: { model: string; messages: ChatMessage[]; context: CtxPayload[]; signal: AbortSignal }) =>
  api<ChatReply>("/ai/chat", undefined, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: body.signal,
    body: JSON.stringify({ model: body.model, messages: body.messages, context: body.context }),
  });

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

function AiChat() {
  const qc = useQueryClient();
  const models = useAiModels();
  const tickers = useTickers();
  const scope = useAiScope().data?.scope ?? "off";
  const [model, setModel] = useState(() => store.get(MODEL_KEY) ?? "");
  const [saved] = useState(loadChat);
  const [messages, setMessages] = useState<ChatMessage[]>(saved.messages);
  const [draft, setDraft] = useState(saved.pending);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<number, string[]>>(saved.used);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // Simpan setiap kali obrolan berubah. "Obrolan baru" mengosongkan pesan, sehingga riwayat ikut terhapus.
  useEffect(() => { saveChat(messages, used); }, [messages, used]);

  // Gulir ke pesan terbaru di dalam area obrolan saja, bukan seluruh halaman.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Kolom tulis tumbuh mengikuti isi sampai batas tinggi tertentu.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [draft]);

  const pickModel = (id: string) => { setModel(id); store.set(MODEL_KEY, id); };
  const reset = () => { abort.current?.abort(); setBusy(false); setFetching(false); setMessages([]); setUsed({}); setError(null); };
  const stop = () => { abort.current?.abort(); setBusy(false); setFetching(false); };

  const send = async (text = draft) => {
    const content = text.trim();
    if (!content || !model || busy) return;
    const recent = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setError(null);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      // Hanya data yang relevan dengan pertanyaan ini yang diambil (baca-saja), tanpa perlu membuka halamannya.
      let context: CtxItem[] = [];
      if (scope !== "off") {
        setFetching(true);
        context = await resolveContext(content, scope, qc, tickers.data ?? [], recent).catch(() => []);
        setFetching(false);
        if (ac.signal.aborted) return;
      }
      const payload = context.map(({ id, kind, label, data }) => ({ id, kind, label, data }));
      const res = await chat({ model, messages: next.slice(-HISTORY_LIMIT), context: payload, signal: ac.signal });
      setMessages([...next, { role: "assistant", content: res.content || "(Model tidak mengembalikan jawaban.)" }]);
      if (res.used?.length) setUsed((u) => ({ ...u, [next.length]: res.used as string[] }));
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(
        e instanceof ApiError && (e.status === 422 || e.status === 413)
          ? "Pertanyaan atau data yang dilampirkan terlalu besar. Persingkat pertanyaan atau mulai obrolan baru."
          : e instanceof Error ? e.message : "Permintaan gagal.",
      );
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: AI_STATUS_KEY });
    } finally {
      if (abort.current === ac) setFetching(false);
      if (!ac.signal.aborted) setBusy(false);
    }
  };

  // Di layar sentuh Enter membuat baris baru (tombol kirim yang mengirim); di desktop Enter mengirim.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
      e.preventDefault();
      void send();
    }
  };

  const ready = model !== "";
  const empty = messages.length === 0;
  const starters = scope === "off" ? GENERIC_STARTERS : [...DATA_STARTERS, scope === "portfolio" ? PORTFOLIO_STARTER : SIGNAL_STARTER];

  return (
    <section className="ai-card ai-chat" aria-label="Obrolan AI">
      <header className="ai-head">
        <div className="ai-model" aria-label="Model">
          <ModelPicker value={model} models={models.data ?? []} loading={models.isPending} onChange={pickModel} />
        </div>
        <div className="ai-tools">
          {!empty && (
            <button type="button" className="ai-new" onClick={reset} aria-label="Obrolan baru">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="ai-lg">Obrolan baru</span>
              <span className="ai-sm">Baru</span>
            </button>
          )}
          <button
            type="button" className="ai-btn ghost ai-access-btn" onClick={() => void openAiSettings()}
            title={scope === "off" ? "Akses data dimatikan. Buka Profil, lalu Koneksi AI." : "Akses data menyala. Buka Profil, lalu Koneksi AI."}
          >
            <i className={`ai-state${scope === "off" ? "" : " on"}`} aria-hidden />
            <span>Akses<span className="ai-lg"> data</span></span>
          </button>
        </div>
      </header>
      {models.isError && <small className="ai-muted ai-pad">Daftar model tidak dapat dimuat.</small>}

      <div className="ai-log" ref={log} role="log" aria-live="polite">
        <div className={`ai-thread${empty ? " empty" : ""}`}>
          {empty && (
            <div className="ai-empty">
              <h3>Mau bahas apa hari ini?</h3>
              <p className="ai-muted">
                {!ready ? "Pilih model untuk mulai."
                  : scope === "off" ? "Akses data dimatikan, jadi AI menjawab tanpa data Nirflo."
                  : scope === "public" ? "Sebut kode emiten atau topik makro, dan data yang relevan diambil otomatis. Data portofolio belum diizinkan."
                  : "Sebut kode emiten, topik makro, atau portofoliomu, dan data yang relevan diambil otomatis."}
                {ready && scope === "off" && (
                  <> <button type="button" className="ai-link" onClick={() => void openAiSettings()}>Nyalakan akses</button></>
                )}
              </p>
              <div className="ai-actions">
                {starters.map((q) => (
                  <button key={q} type="button" className="ai-chip" disabled={!ready || busy} onClick={() => void send(q)}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role}`}>
              {m.role === "assistant" ? (
                <>
                  {used[i] && <span className="ai-used" title={used[i].join(", ")}>Data: {used[i].join(", ")}</span>}
                  <Reply text={m.content} />
                </>
              ) : m.content}
            </div>
          ))}
          {busy && (
            <div className="ai-msg assistant pending" aria-label="Sedang menjawab">
              <i /><i /><i />
              {fetching && <span className="ai-fetching">Mengambil data…</span>}
            </div>
          )}
        </div>
      </div>

      {error && <div className="ai-notice err ai-pad" role="alert">{error}</div>}

      <div className="ai-compose">
        <div className="ai-box">
          <textarea
            ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
            rows={1} maxLength={4000} placeholder={ready ? "Tulis pertanyaan" : "Pilih model dulu"}
            aria-label="Pesan" enterKeyHint="send"
          />
          {busy ? (
            <button type="button" className="ai-send stop" onClick={stop} aria-label="Hentikan">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
            </button>
          ) : (
            <button type="button" className="ai-send" onClick={() => void send()} disabled={!draft.trim() || !ready} aria-label="Kirim">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="ai-muted ai-foot">Jawaban AI bisa keliru dan bukan nasihat investasi.</p>
      </div>
    </section>
  );
}