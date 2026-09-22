import { useEffect, useMemo, useRef, useState } from "react";
import { equalizerResponse } from "../model/filters";
import { filterSlots, updateFilterSlot } from "../model/filterSlots";
import type { EqualizerConfiguration, EqualizerFilter } from "../model/types";
import { usePlotDimensions } from "./usePlotDimensions";

function NumericParameter({ label, value, minimum, maximum, step, disabled, onChange }: {
  label: string; value: number; minimum: number; maximum: number; step: number; disabled?: boolean; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return <input aria-label={label} type="number" min={minimum} max={maximum} step={step} disabled={disabled}
    value={draft ?? Number(value.toFixed(4))}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      if (!cancelled.current && draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(Math.min(maximum, Math.max(minimum, Number(draft))));
      cancelled.current = false;
      setDraft(null);
    }}
    onKeyDown={event => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; setDraft(null); event.currentTarget.blur(); }
    }} />;
}

function ResponsePreview({ bank }: { bank: EqualizerConfiguration }) {
  const { ref, width, height } = usePlotDimensions({ width: 1050, height: 280 });
  const [hover, setHover] = useState<number | null>(null);
  const samples = useMemo(() => Array.from({ length: 601 }, (_, i) => {
    const frequency = 20 * 1000 ** (i / 600);
    const [real, imag] = equalizerResponse(bank, frequency);
    return { frequency, db: 20 * Math.log10(Math.max(1e-30, Math.hypot(real, imag))), phase: Math.atan2(imag, real) * 180 / Math.PI };
  }), [bank]);
  const left = 54, right = width - 24, top = 26, magnitudeBottom = height * 0.60, phaseTop = height * 0.69, bottom = height - 28;
  const minimum = Math.min(-24, Math.floor(Math.min(...samples.map(s => s.db)) / 12) * 12);
  const maximum = Math.max(12, Math.ceil(Math.max(...samples.map(s => s.db)) / 12) * 12);
  const x = (frequency: number) => left + Math.log10(frequency / 20) / 3 * (right - left);
  const magnitudeY = (db: number) => magnitudeBottom - (db - minimum) / (maximum - minimum) * (magnitudeBottom - top);
  const phaseY = (phase: number) => bottom - (phase + 180) / 360 * (bottom - phaseTop);
  const magnitudePath = samples.map((s, i) => `${i ? "L" : "M"}${x(s.frequency)},${magnitudeY(s.db)}`).join(" ");
  const phasePath = samples.map((s, i) => `${!i || Math.abs(s.phase - samples[i-1].phase) > 180 ? "M" : "L"}${x(s.frequency)},${phaseY(s.phase)}`).join(" ");
  const selected = hover === null ? null : samples[hover];
  return <div className="eq-preview">
    <div className="eq-preview-caption"><span>Bank response {bank.bypassed ? "(bypassed)" : ""}</span><span>{selected ? `${selected.frequency.toFixed(0)} Hz / ${selected.db.toFixed(1)} dB / ${selected.phase.toFixed(1)}°` : "Magnitude + phase · 20 Hz–20 kHz"}</span></div>
    <svg ref={ref} role="img" aria-label="Filter bank magnitude and phase response" viewBox={`0 0 ${width} ${height}`}
      onPointerLeave={() => setHover(null)} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setHover(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left - left)/(right-left))) * 600));
      }}>
      {[20,50,100,200,500,1000,2000,5000,10000,20000].map(f => <g key={f}>
        <line className="eq-grid-line" x1={x(f)} x2={x(f)} y1={top} y2={bottom} />
        <text x={x(f)} y={height-8} textAnchor="middle">{f >= 1000 ? `${f/1000}k` : f}</text>
      </g>)}
      {Array.from(new Set([minimum, (minimum+maximum)/2, 0, maximum])).map(db => <g key={db}>
        <line className="eq-grid-line" x1={left} x2={right} y1={magnitudeY(db)} y2={magnitudeY(db)} />
        <text x={left-8} y={magnitudeY(db)+4} textAnchor="end">{db}</text>
      </g>)}
      <line className="eq-zero-line" x1={left} x2={right} y1={magnitudeY(0)} y2={magnitudeY(0)} />
      {[-180,0,180].map(phase => <g key={phase}><line className="eq-grid-line" x1={left} x2={right} y1={phaseY(phase)} y2={phaseY(phase)} /><text x={left-8} y={phaseY(phase)+4} textAnchor="end">{phase}°</text></g>)}
      <text x={left} y={14}>Magnitude (dB)</text><text x={left} y={phaseTop-7}>Phase</text>
      <path data-eq-magnitude d={magnitudePath} className="eq-magnitude" />
      <path data-eq-phase d={phasePath} className="eq-phase" />
      {selected && <line className="eq-cursor" x1={x(selected.frequency)} x2={x(selected.frequency)} y1={top} y2={bottom} />}
    </svg>
  </div>;
}

export function FilterBankEditor({ name, scope, bank, onChange, onClose }: {
  name: string; scope: "channel" | "speaker"; bank: EqualizerConfiguration;
  onChange: (bank: EqualizerConfiguration) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const { slots, indices, extraCount } = filterSlots(bank);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const change = (slot: number, patch: Partial<EqualizerFilter>) => onChange(updateFilterSlot(bank, slot, patch));
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="equalizer-popup filter-bank-editor" role="dialog" aria-modal="true" aria-label={`${name} equalizer`} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); closeRef.current(); }
        if (event.key === "Tab") {
          const elements = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
          const first = elements[0], last = elements.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><small>{scope === "channel" ? "CHANNEL PROCESSING" : "SPEAKER PROCESSING"}</small><strong>{name} EQ</strong></div>
        <label className="eq-bypass"><input type="checkbox" aria-label="Bypass filter bank" checked={bank.bypassed ?? false} onChange={event => onChange({ ...bank, bypassed: event.target.checked })} /> Bypass bank</label>
        <button className="icon-button quiet" aria-label="Close equalizer" onClick={onClose}>×</button></header>
      <div className="eq-editor-body">
        <ResponsePreview bank={bank} />
        <div className="eq-bank-scroll"><div className="eq-bank-grid" role="group" aria-label="Eight filter slots">
          {slots.map((filter, slot) => {
            const crossover = slot === 0 || slot === 7;
            const label = slot === 0 ? "High-pass" : slot === 7 ? "Low-pass" : `Filter ${slot+1}`;
            const full = indices[slot] === -1 && bank.filters.length >= 64;
            const orders = filter.family === "linkwitz-riley" ? [2,4,6,8] : [1,2,3,4,5,6,7,8];
            return <div className={`eq-slot ${filter.enabled ? "enabled" : "disabled"}`} key={filter.id} data-eq-slot={slot}>
              <label className="eq-slot-heading"><input type="checkbox" aria-label={`${label} enabled`} checked={filter.enabled} disabled={full} onChange={event => change(slot,{ enabled:event.target.checked })} /><span>{label}</span></label>
              <label className="eq-parameter"><span>{crossover ? "Family" : "Type"}</span>
                {crossover ? <select aria-label={`${label} family`} disabled={full} value={filter.family ?? "butterworth"} onChange={event => {
                  const family = event.target.value as "butterworth" | "linkwitz-riley";
                  const order = filter.order ?? 2;
                  change(slot,{family,order: family === "linkwitz-riley" && order % 2 ? order+1 : order});
                }}><option value="butterworth">Butterworth</option><option value="linkwitz-riley">Linkwitz–Riley</option></select>
                  : <select aria-label={`${label} type`} disabled={full} value={filter.type} onChange={event => change(slot,{ type:event.target.value as EqualizerFilter["type"] })}>
                    <option value="peq">PEQ</option><option value="low-shelf">Low shelf</option><option value="high-shelf">High shelf</option><option value="allpass">Allpass</option>
                  </select>}
              </label>
              <label className="eq-parameter"><span>{crossover ? "Cutoff (Hz)" : "Frequency (Hz)"}</span><NumericParameter label={`${label} frequency`} value={filter.frequencyHz} minimum={1} maximum={100000} step={1} disabled={full} onChange={frequencyHz => change(slot,{frequencyHz})} /></label>
              <label className="eq-parameter"><span>{crossover ? "Slope (dB/oct)" : "Gain (dB)"}</span>{crossover
                ? <select aria-label={`${label} slope`} value={filter.order ?? 2} disabled={full} onChange={event => change(slot,{order:Number(event.target.value)})}>{orders.map(order => <option key={order} value={order}>{order*6}</option>)}</select>
                : filter.type === "allpass" ? <input aria-label={`${label} gain (not used)`} value="—" disabled /> : <NumericParameter label={`${label} gain`} value={filter.gainDb} minimum={-60} maximum={60} step={0.5} disabled={full} onChange={gainDb => change(slot,{gainDb})} />}</label>
              <label className="eq-parameter"><span>Q</span>{crossover ? <input aria-label={`${label} Q (set by family)`} value="—" disabled />
                : <NumericParameter label={`${label} Q`} value={filter.q} minimum={0.05} maximum={100} step={0.05} disabled={full} onChange={q => change(slot,{q})} />}</label>
            </div>;
          })}
        </div></div>
        {extraCount > 0 && <p className="eq-extra-note">{extraCount} additional imported filter{extraCount === 1 ? " is" : "s are"} preserved and included in the preview. This editor shows eight slots.</p>}
      </div>
      <footer><span>Changes apply to this {scope === "speaker" ? "speaker object" : "channel"}. Preview excludes level and delay.</span><button className="processing-button" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}
