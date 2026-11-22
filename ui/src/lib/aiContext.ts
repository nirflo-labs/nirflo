export type CtxKind = "market" | "portfolio";
export type CtxItem = { id: string; kind: CtxKind; label: string; data: unknown };

/** Jumlah ringkasan maksimum yang dikirim per pertanyaan (server menerima sedikit lebih banyak sebagai cadangan). */
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