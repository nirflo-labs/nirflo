import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const CALLBACK_PATH = "/auth/openrouter/callback";
export const AI_PATH = "/ai";

const AUTH_URL = "https://openrouter.ai/auth";
const FLOW_KEY = "openrouter.pkce";
const FLOW_MAX_AGE_MS = 10 * 60 * 1000;
const JSON_HEADERS = { "Content-Type": "application/json" };

export type AiStatus = { configured: boolean; connected: boolean; keyHash: string | null };
export type AiModel = { id: string; name: string; context: number | null; free: boolean };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ConnectResult = { ok: true } | { ok: false; message: string };

export const AI_STATUS_KEY = ["ai-status"] as const;

// ---------------------------------------------------------------- PKCE (verifier hanya hidup di tab ini, sampai kembali dari OpenRouter)
type Flow = { verifier: string; state: string; createdAt: number };

const session = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* dicek lewat get */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* diabaikan */ } },
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const randomString = (n: number) => base64Url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

function readFlow(): Flow | null {
  const raw = session.get(FLOW_KEY);
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<Flow>;
    if (typeof f.verifier === "string" && typeof f.state === "string" && typeof f.createdAt === "number") {
      return { verifier: f.verifier, state: f.state, createdAt: f.createdAt };
    }
  } catch { /* data rusak: anggap tidak ada */ }
  return null;
}

/** Mengalihkan browser ke OpenRouter. Selalu kembali ke CALLBACK_PATH. */
export async function startOpenRouterLogin(): Promise<void> {
  if (!window.crypto?.subtle) throw new Error("Browser ini tidak mendukung Web Crypto. Gunakan HTTPS atau localhost.");
  const verifier = randomString(32);
  const state = randomString(16);
  const challenge = base64Url(await sha256(verifier));

  const flow: Flow = { verifier, state, createdAt: Date.now() };
  session.set(FLOW_KEY, JSON.stringify(flow));
  if (!readFlow()) throw new Error("Penyimpanan sesi browser tidak tersedia, sambungan tidak bisa dimulai.");

  const url = new URL(AUTH_URL);
  url.searchParams.set("callback_url", `${window.location.origin}${CALLBACK_PATH}`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("key_label", "Nirflo");
  window.location.assign(url.toString());
}

async function finish(): Promise<ConnectResult> {
  const params = new URLSearchParams(window.location.search);
  const flow = readFlow();
  session.del(FLOW_KEY);
  const fail = (message: string): ConnectResult => ({ ok: false, message });

  const code = params.get("code");
  if (!code) return fail("Otorisasi dibatalkan atau OpenRouter tidak mengirim kode.");
  if (!flow) return fail("Sesi sambungan tidak ditemukan. Mulai lagi dari tombol Sambungkan.");
  if (params.get("state") !== flow.state) return fail("Parameter state tidak cocok. Sambungan dibatalkan.");
  if (Date.now() - flow.createdAt > FLOW_MAX_AGE_MS) return fail("Sambungan kedaluwarsa. Ulangi dari awal.");
  try {
    await api("/ai/connect", undefined, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ code, code_verifier: flow.verifier }),
    });
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Gagal menyelesaikan sambungan OpenRouter.");
  }
}

// Kode otorisasi hanya berlaku sekali, sedangkan React StrictMode menjalankan efek dua kali di mode dev.
// Satu promise dipakai bersama supaya penukaran kode tidak terjadi dua kali.
let inflight: Promise<ConnectResult> | null = null;
export function completeOpenRouterLogin(): Promise<ConnectResult> {
  inflight ??= finish();
  return inflight;
}

// ---------------------------------------------------------------- hooks
export const useAiStatus = () =>
  useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: ({ signal }) => api<AiStatus>("/ai/status", undefined, { signal }),
    staleTime: 30_000,
    retry: 0,
  });

export const useAiModels = () =>
  useQuery({
    queryKey: ["ai-models"],
    queryFn: ({ signal }) => api<AiModel[]>("/ai/models", undefined, { signal }),
    staleTime: 60 * 60_000,
    retry: 0,
  });

export function useDisconnectAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ removed: boolean }>("/ai/key", undefined, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: AI_STATUS_KEY }),
  });
}

export const settingsUrl = (keyHash: string | null) => (keyHash ? `https://openrouter.ai/keys/${keyHash}` : null);