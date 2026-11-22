import type { Band } from "../model/frequencyDomain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type DiscreteProps = {
  currentFrequencyHz: number;
  frequencyValues: readonly number[];
  frequencyPosition: number;
  frequencyCount: number;
  onFrequencyPositionChange: (position: number) => void;
};

export interface ContinuousControl {
  band: Band;
  range: Band;
  onRange: (value: Band) => void;
  onPlane: (value: number) => void;
}

function ContinuousSlider({ control, plane }: { control: ContinuousControl; plane: number }) {
  const { band, range } = control;
  const [draft, setDraft] = useState<{ index: number; hz: number } | null>(null);
  const values = [range[0], range[1], plane];
  if (draft) values[draft.index] = draft.hz;
  const logSpan = Math.log(band[1] / band[0]);
  const position = (hz: number) => Math.log(hz / band[0]) / logSpan;
  const pending = useRef<typeof draft>(null);
  const update = (index: number, requestedHz: number) => {
    const min = Math.ceil(band[0]), max = Math.floor(band[1]);
    const hz = min <= max
      ? Math.max(min, Math.min(max, Math.round(requestedHz)))
      : Math.max(band[0], Math.min(band[1], requestedHz));
    if ((index === 0 && hz >= range[1]) || (index === 1 && hz <= range[0])) return;
    pending.current = { index, hz };
    setDraft(pending.current);
  };
  const frequencyAt = (fraction: number) => band[0] * Math.exp(logSpan * Math.max(0, Math.min(1, fraction)));
  const cancel = () => { pending.current = null; setDraft(null); };
  const commit = () => {
    const next = pending.current;
    if (!next) return;
    if (next.index === 2) control.onPlane(next.hz);
    else control.onRange(next.index === 0 ? [next.hz, range[1]] : [range[0], next.hz]);
    cancel();
  };
  const hzLabel = (hz: number) => Math.round(hz).toString();
  return <div className="response-frequency continuous-frequency">
    <div className="frequency-readout"><span>Plane {hzLabel(values[2])} Hz</span>
      <span>{hzLabel(values[0])}&ndash;{hzLabel(values[1])} Hz</span></div>
    <div className="frequency-track">
      <i style={{ left: `${100 * position(values[0])}%`, right: `${100 * (1 - position(values[1]))}%` }} />
      {["Sweep lower limit", "Sweep upper limit", "Observation plane frequency"].map((label, i) =>
        <input key={label} className={i === 2 ? "plane-thumb" : "limit-thumb"} type="range"
          aria-label={label} aria-valuetext={`${hzLabel(values[i])} Hz`} title={`${label}: ${hzLabel(values[i])} Hz`}
          min={0} max={10000} step={1} value={Math.round(position(values[i]) * 10000)}
          onChange={event => update(i, frequencyAt(Number(event.target.value) / 10000))}
          onKeyDown={event => {
            const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
            if (direction === undefined) return;
            event.preventDefault();
            update(i, Math.round(values[i]) + direction);
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const track = event.currentTarget.parentElement!.getBoundingClientRect();
            update(i, frequencyAt((event.clientX - track.left) / track.width));
          }}
          onPointerUp={commit} onPointerCancel={cancel} onKeyUp={commit} onBlur={commit} />)}
    </div>
  </div>;
}

export function FrequencySlider({ continuous, ...props }: DiscreteProps & { continuous?: ContinuousControl }) {
  return continuous ? <ContinuousSlider control={continuous} plane={props.currentFrequencyHz} /> : <DiscreteSlider {...props} />;
}

/** Defer the scene update while dragging across discrete samples. */
function DiscreteSlider({ currentFrequencyHz, frequencyValues, frequencyPosition, frequencyCount, onFrequencyPositionChange }: DiscreteProps) {
  const [position, setPosition] = useState(frequencyPosition);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useRef(onFrequencyPositionChange);
  useLayoutEffect(() => { onChange.current = onFrequencyPositionChange; });
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  };
  useEffect(() => {
    cancel();
    setPosition(frequencyPosition);
  }, [frequencyPosition, frequencyCount]);
  useEffect(() => cancel, []);
  const flush = () => {
    const next = pending.current;
    cancel();
    if (next !== null) onChange.current(next);
  };
  const displayedFrequencyHz = frequencyValues[position] ?? currentFrequencyHz;
  return <label className="response-frequency">
    <span>{Number.isFinite(displayedFrequencyHz) ? `${Math.round(displayedFrequencyHz)} Hz` : "— Hz"}</span>
    <input aria-label="Frequency" type="range" min={0} max={Math.max(0, frequencyCount - 1)} step={1}
      disabled={frequencyCount < 2} value={position} aria-valuetext={`${Math.round(displayedFrequencyHz)} Hz`}
      onChange={(event) => {
        const next = Number(event.target.value);
        setPosition(next);
        cancel();
        pending.current = next;
        timer.current = setTimeout(flush, 120);
      }}
      onPointerUp={flush} onKeyUp={flush} onBlur={flush}
    />
  </label>;
}
