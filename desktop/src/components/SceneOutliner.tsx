import { useRef, useState, type ReactNode } from "react";
import { Box, ChevronDown, ChevronRight, Folder, FolderPlus, Grid3X3, Mic2, Speaker, Trash2 } from "lucide-react";
import { emptyOrganization, moveToGroup, rangeSelection, type SceneOrganization } from "../model/sceneOrganization";
export interface OutlinerObject { id: string; name: string; kind: "speaker" | "rigid" | "microphone" | "plane"; detail: string }
interface Props {
  objects: OutlinerObject[]; selected: string[]; active: string | null; organization: SceneOrganization;
  onOrganization: (value: SceneOrganization) => void; onSelection: (ids: string[]) => void;
  onRename: (id: string, name: string) => void; onDuplicate: () => void; onDelete: () => void;
  onFrame: (ids: string[]) => void; channels: { id: string; name: string }[];
  onAssignChannel: (ids: string[], channelId: string) => void; actions: ReactNode;
}
const icons = { speaker: Speaker, rigid: Box, microphone: Mic2, plane: Grid3X3 };
export function SceneOutliner(props: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<string | null>(null);
  const org = props.organization ?? emptyOrganization();
  const assigned = new Set(org.groups.flatMap(g => g.members));
  const matches = (o: OutlinerObject) => (filter === "all" || o.kind === filter) && `${o.name} ${o.detail}`.toLowerCase().includes(search.toLowerCase());
  const sections = [...org.groups.map(group => ({ ...group, objects: props.objects.filter(o => group.members.includes(o.id) && matches(o)) })),
    { id: "", name: org.groups.length ? "Ungrouped" : "Objects", collapsed: false, members: [], objects: props.objects.filter(o => !assigned.has(o.id) && matches(o)) }];
  const visible = sections.flatMap(g => g.collapsed && !search ? [] : g.objects).map(o => o.id);
  const finishRename = () => {
    if (!rename) return;
    const name = rename.name.trim();
    if (name) {
      if (org.groups.some(g => g.id === rename.id)) props.onOrganization({ ...org, groups: org.groups.map(g => g.id === rename.id ? { ...g, name } : g) });
      else props.onRename(rename.id, name);
    }
    setRename(null);
  };
  const label = (id: string, name: string) => rename?.id === id ? <input autoFocus aria-label="Object name" value={rename.name}
    onFocus={e => e.currentTarget.select()} onChange={e => setRename({ id, name: e.target.value })}
    onBlur={finishRename} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") finishRename(); if (e.key === "Escape") setRename(null); }} /> : <span>{name}</span>;
  const drop = (e: React.DragEvent, groupId: string | null) => {
    const data = e.dataTransfer.getData("application/x-deploy-objects");
    if (!data) return;
    e.preventDefault(); e.stopPropagation();
    try { const ids: unknown = JSON.parse(data); if (Array.isArray(ids)) props.onOrganization(moveToGroup(org, ids.filter(id => props.objects.some(o => o.id === id)), groupId)); } catch { /* Ignore foreign drag data. */ }
  };
  return <div className="scene-outliner">
    <div className="navigator-heading"><strong>Scene <small>{props.objects.length}</small></strong>{props.actions}
      <button className="icon-button quiet" title="Group selected objects" aria-label="Create scene group" onClick={() => {
        const id = crypto.randomUUID();
        const next = moveToGroup(org, props.selected, null);
        props.onOrganization({ ...next, groups: [...next.groups, { id, name: `Group ${org.groups.length + 1}`, members: props.selected, collapsed: false }] });
        setRename({ id, name: `Group ${org.groups.length + 1}` });
      }}><FolderPlus size={15} /></button>
    </div>
    <div className="navigator-search"><input aria-label="Search scene" placeholder="Search scene…" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter scene objects" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All types</option><option value="speaker">Speakers</option><option value="rigid">Rigid objects</option><option value="microphone">Microphones</option><option value="plane">Audience planes</option></select></div>
    <div className="outliner-scroll scene-tree" role="tree" aria-label="Scene objects">
      {sections.map(section => <div key={section.id} onDragOver={e => { if (e.dataTransfer.types.includes("application/x-deploy-objects")) e.preventDefault(); }} onDrop={e => drop(e, section.id || null)}>
        {(section.id || org.groups.length > 0) && <div className="outliner-group">
          <button className="tree-label" onClick={() => section.id && props.onOrganization({ ...org, groups: org.groups.map(g => g.id === section.id ? { ...g, collapsed: !g.collapsed } : g) })}
            onDoubleClick={() => section.id && setRename({ id: section.id, name: section.name })} aria-expanded={!section.collapsed}>
            {section.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={13} />{rename?.id !== section.id && <span>{section.name}</span>}<small>{section.objects.length}</small></button>
          {rename?.id === section.id && label(section.id, section.name)}
          {section.id && <><button title="Select group members" aria-label={`Select ${section.name}`} onClick={() => props.onSelection(section.objects.map(o => o.id))}>All</button>
          <button title="Remove group; keep objects" aria-label={`Ungroup ${section.name}`} onClick={() => props.onOrganization({ ...org, groups: org.groups.filter(g => g.id !== section.id) })}>×</button></>}
        </div>}
        {(!section.collapsed || search) && section.objects.map(o => {
          const Icon = icons[o.kind];
          return <div key={o.id} className={`outliner-row ${props.selected.includes(o.id) ? "selected" : ""}`}
            role="treeitem" aria-selected={props.selected.includes(o.id)} data-object-id={o.id}
            draggable={!rename} onDragStart={e => e.dataTransfer.setData("application/x-deploy-objects", JSON.stringify(props.selected.includes(o.id) ? props.selected : [o.id]))}
            onContextMenu={e => { e.preventDefault(); if (!props.selected.includes(o.id)) props.onSelection([o.id]); setMenu(true); }}>
            {rename?.id === o.id ? label(o.id, o.name) : <button data-object-id={o.id} aria-selected={props.selected.includes(o.id)} className={`tree-label tree-button ${props.active === o.id ? "active-selection" : ""}`}
              onDoubleClick={() => setRename({ id: o.id, name: o.name })} title={`${o.name} · ${o.detail}`}
              onKeyDown={e => { if (e.key === "F2") { e.preventDefault(); setRename({ id: o.id, name: o.name }); } }}
              onClick={e => {
                const additive = e.ctrlKey || e.metaKey;
                if (e.shiftKey) { const ids = rangeSelection(visible, anchor.current, o.id); props.onSelection(additive ? [...new Set([...props.selected, ...ids])] : ids); }
                else { props.onSelection(additive ? props.selected.includes(o.id) ? props.selected.filter(id => id !== o.id) : [...props.selected, o.id] : [o.id]); anchor.current = o.id; }
              }}><Icon size={14} /><span>{o.name}</span><em>{o.detail}</em></button>}
          </div>;
        })}
      </div>)}
      {!props.objects.length && <p className="navigator-empty">Add a speaker from Assets below, or create a microphone or audience plane using the buttons above.</p>}
      {props.objects.length > 0 && !sections.some(s => s.objects.length) && <p className="navigator-empty">No matching objects.</p>}
    </div>
    <div className="selection-actions"><span>{props.selected.length ? `${props.selected.length} selected` : "Select objects to edit"}</span>
      <button className="row-control" aria-label="Remove selected objects" title="Delete selected objects" disabled={!props.selected.length} onClick={props.onDelete}><Trash2 size={13} /></button>
      <button disabled={!props.selected.length} aria-expanded={menu} onClick={() => setMenu(!menu)}>Actions ▾</button></div>
    {menu && props.selected.length > 0 && <div className="selection-menu">
      <button onClick={() => { props.onDuplicate(); setMenu(false); }}>Duplicate</button><button onClick={() => { props.onFrame(props.selected); setMenu(false); }}>Frame selection</button>
      <button onClick={() => { const o = props.objects.find(o => o.id === props.selected[0]); if (o) setRename({ id: o.id, name: o.name }); setMenu(false); }}>Rename</button>
      <select aria-label="Move selection to group" value="" onChange={e => { props.onOrganization(moveToGroup(org, props.selected, e.target.value === "ungrouped" ? null : e.target.value)); setMenu(false); }}><option value="" disabled>Move to group…</option><option value="ungrouped">Ungrouped</option>{org.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <select aria-label="Assign selected speakers to channel" value="" onChange={e => { props.onAssignChannel(props.selected, e.target.value); setMenu(false); }}><option value="" disabled>Assign channel…</option>{props.channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button onClick={() => { props.onDelete(); setMenu(false); }}>Delete selected</button><button onClick={() => setMenu(false)}>Close</button>
    </div>}
  </div>;
}
