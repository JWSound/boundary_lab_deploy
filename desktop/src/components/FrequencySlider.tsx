import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Keep the thumb local while deferring the expensive scene/plot frequency update. */
export function FrequencySlider({ currentFrequencyHz, frequencyValues, frequencyPosition, frequencyCount, onFrequencyPositionChange }: {
  currentFrequencyHz: number;
  frequencyValues: readonly number[];
  frequencyPosition: number;
  frequencyCount: number;
  onFrequencyPositionChange: (position: number) => void;
}) {
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
