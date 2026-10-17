import { useRef, useState } from "react";

export function ProjectName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = useRef(false);
  const begin = () => { editing.current = true; setDraft(name); };
  const finish = (cancelled = false) => {
    if (!editing.current) return;
    editing.current = false;
    const next = draft?.trim();
    setDraft(null);
    if (!cancelled && next && next !== name) onRename(next);
  };
  if (draft !== null) return <input className="project-name-input" aria-label="Project name"
    value={draft} autoFocus onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => finish()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        finish(event.key === "Escape");
        event.currentTarget.blur();
      }
    }} />;
  return <button type="button" className="project-name" aria-label={`Rename project: ${name}`}
    title={`${name} — double-click to rename`} onDoubleClick={begin}
    onKeyDown={event => {
      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); begin(); }
    }}>{name}</button>;
}
