import { useAiScope, useSetAiScope, type Scope } from "../lib/aiScope";
import "../ai.css";

function Row({ title, note, checked, disabled, onChange }: {
  title: string; note: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <div className={`ai-row${disabled ? " off" : ""}`}>
      <div>
        <strong>{title}</strong>
        <p className="ai-muted">{note}</p>
      </div>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={title}
        className="ai-sw" disabled={disabled} onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

/** Dua saklar izin: data pasar (publik) dan data portofolio (pribadi). Disimpan di server. */
export function AiAccessToggle({ flat = false }: { flat?: boolean }) {
  const q = useAiScope();
  const set = useSetAiScope();
  const scope: Scope = q.data?.scope ?? "off";
  const busy = q.isPending || set.isPending;
  return (
    <section className={`ai-card ai-access${flat ? " flat" : ""}`} aria-label="Akses data Nirflo untuk AI">
      <header className="ai-head">
        <div>
          <h2>Akses data Nirflo</h2>
          <p className="ai-muted">
            AI tidak membaca database. Saat kamu bertanya, Nirflo hanya mengambil ringkasan angka yang relevan dengan pertanyaan itu, lalu mengirimnya bersama pertanyaanmu.
          </p>
        </div>
      </header>
      <Row
        title="Data pasar" checked={scope !== "off"} disabled={busy}
        note="Harga, laporan keuangan, sinyal, dan makro. Data pasar, bukan data pribadi."
        onChange={(on) => set.mutate(on ? "public" : "off")}
      />
      <Row
        title="Data portofolio" checked={scope === "portfolio"} disabled={busy || scope === "off"}
        note="Posisi, bobot, Sharpe, dan cash. Ini data pribadi dan ikut terkirim ke OpenRouter serta penyedia model."
        onChange={(on) => set.mutate(on ? "portfolio" : "public")}
      />
      {set.isError && <p className="ai-muted ai-err" role="alert">{set.error instanceof Error ? set.error.message : "Pengaturan gagal disimpan."}</p>}
    </section>
  );
}