import { useRef, useState, type PointerEvent } from "react";

export function SidePanelResizeHandle({ side, value, minimum, maximum, onChange }: {
  side: "left" | "right";
  value: number;
  minimum: number;
  maximum: number;
  onChange: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = side === "left" ? 1 : -1;
  const resize = (width: number) => onChange(Math.round(Math.max(minimum, Math.min(maximum, width))));
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={`side-panel-resizer ${side}-resizer ${dragging ? "dragging" : ""}`}
    role="separator" tabIndex={0} aria-label={side === "left" ? "Resize scene panel" : "Resize inspector panel"}
    aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={value}
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, width: value };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      if (drag.current) resize(drag.current.width + direction * (event.clientX - drag.current.x));
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => resize(side === "left" ? 280 : 330)}
    onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        resize(value + direction * (event.key === "ArrowRight" ? 10 : -10));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        resize(event.key === "Home" ? minimum : maximum);
      }
    }} />;
}
