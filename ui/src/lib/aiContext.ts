import { useSyncExternalStore, useEffect } from "react";

export type CtxKind = "market" | "portfolio";
export type CtxItem = { id: string; kind: CtxKind; label: string; data: unknown; at: number };

/** Snapshot yang disimpan di memori (yang terlama dibuang) dan batas yang dikirim per pertanyaan. */
export const MAX_KEEP = 12;
export const MAX_SEND = 6;
const MAX_DEPTH = 5;
const MAX_ARRAY = 40;

/** Membulatkan angka, membuang nilai kosong, dan membatasi ukuran supaya ringkas. */
export function slim(value: unknown, depth = 0): unknown {
  if (value == null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : undefined;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => slim(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = slim(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}

// Snapshot disimpan di memori tab ini saja. Tidak ada yang dikirim sebelum pengguna mengirim pertanyaan di Asisten AI.
let items: CtxItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function shareContext(id: string, kind: CtxKind, label: string, data: unknown) {
  const clean = slim(data);
  if (clean === undefined) return;
  items = [...items.filter((i) => i.id !== id), { id, kind, label, data: clean, at: Date.now() }].slice(-MAX_KEEP);
  emit();
}

export function clearContext() {
  if (!items.length) return;
  items = [];
  emit();
}

/** Konteks yang benar-benar dikirim: sesuai izin, tidak dimatikan pengguna, dan paling baru lebih dulu sampai batas MAX_SEND. */
export function pickContext(all: CtxItem[], scope: "off" | "public" | "portfolio", skip: string[]): CtxItem[] {
  return all
    .filter((i) => scope !== "off" && (i.kind !== "portfolio" || scope === "portfolio") && !skip.includes(i.id))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SEND);
}

export const useContextItems = () =>
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => items,
  );

/** Daftarkan apa yang sedang tampil di halaman. `data` sebaiknya dibungkus useMemo; null berarti belum ada. */
export function useShareContext(id: string, kind: CtxKind, label: string, data: unknown) {
  useEffect(() => {
    if (data != null) shareContext(id, kind, label, data);
  }, [id, kind, label, data]);
}

export function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} mnt lalu` : `${Math.round(m / 60)} jam lalu`;
}