import { useEffect, useRef } from "react";

export function SolverPreferencesDialog({ backend, busy, interfaceScale, scaleBusy, onScaleChange, onChange, onClose }: {
  backend: "cpu" | "cuda" | "metal" | null;
  busy: boolean;
  interfaceScale: number;
  scaleBusy: boolean;
  onScaleChange?: (scale: number) => void;
  onChange: (backend: "cpu" | "cuda" | "metal") => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="solver-preferences" aria-labelledby="solver-preferences-title"
    onCancel={onClose} onClose={onClose}>
    <h2 id="solver-preferences-title">Preferences</h2>
    <section aria-labelledby="appearance-title">
      <h3 id="appearance-title">Appearance</h3>
      <label htmlFor="interface-scale">Interface scale</label>
      <select id="interface-scale" value={interfaceScale} disabled={scaleBusy || !onScaleChange}
        onChange={event => onScaleChange?.(Number(event.target.value))}>
        {[0.85, 0.9, 0.95, 1, 1.1].map(scale => <option key={scale} value={scale}>{Math.round(scale * 100)}%{scale === 0.9 ? " (default)" : ""}</option>)}
      </select>
    </section>
    <h3>Solver</h3>
    <label htmlFor="solver-backend">Solver backend</label>
    <select id="solver-backend" value={backend ?? ""} disabled={busy || backend === null}
      onChange={event => onChange(event.target.value as "cpu" | "cuda" | "metal")}>
      {backend === null && <option value="">Checking availability...</option>}
      <option value="cuda">CUDA (NVIDIA GPU)</option>
      <option value="metal">Metal (Apple Silicon GPU)</option>
      <option value="cpu">CPU</option>
    </select>
    <p>Used for Boundary and Coupled solves.</p>
    <button className="processing-button" onClick={onClose}>Close</button>
  </dialog>;
}
