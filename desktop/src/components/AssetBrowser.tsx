import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Box, ChevronDown, ChevronRight, FolderOpen, Plus, RefreshCw, Speaker, Star } from "lucide-react";
export interface AssetRow {
  key: string; name: string; fileName: string; kind: "speaker" | "rigid";
  location: "project" | "library" | "builtin"; path: string | null; fingerprint?: string;
  level?: number; error?: string; projectId?: string; originalPath?: string;
}
interface Props {
  projectAssets: AssetRow[]; onAdd: (asset: AssetRow) => Promise<void>;
  onImportFile: (kind: "speaker" | "rigid") => void;
  onDropFiles: (files: File[]) => Promise<string[]>;
  onUpdate: (asset: AssetRow, replacement: AssetRow) => Promise<void>;
}
function savedList(key: string): string[] { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter(v => typeof v === "string") : []; } catch { return []; } }
export function AssetBrowser(props: Props) {
  const desktop = window.boundaryLabDesktop;
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>({ root: "", entries: [], errors: [] });
  const [collapsed, setCollapsed] = useState(false);
  const [kind, setKind] = useState<"speaker" | "rigid">("speaker");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [sort, setSort] = useState("name");
  const [favorites, setFavorites] = useState(() => savedList("deploy.assetFavorites"));
  const [recent, setRecent] = useState(() => savedList("deploy.assetRecent"));
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => { try { localStorage.setItem("deploy.assetFavorites", JSON.stringify(favorites)); } catch {} }, [favorites]);
  useEffect(() => { try { localStorage.setItem("deploy.assetRecent", JSON.stringify(recent)); } catch {} }, [recent]);
  useEffect(() => {
    if (!desktop?.scanLibrary) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const scan = async () => {
      try { const next = await desktop.scanLibrary(); if (!disposed) setSnapshot(next); }
      catch (error) { if (!disposed) setMessages([String(error)]); }
      finally { if (!disposed) timer = setTimeout(scan, 4000); }
    };
    void scan();
    return () => { disposed = true; clearTimeout(timer); };
  }, [desktop]);
  useEffect(() => setScrollTop(0), [search, kind, location, onlyFavorites, sort]);
  const assetKey = (asset: AssetRow) => asset.originalPath ?? asset.path ?? asset.key;
  const assets: AssetRow[] = useMemo(() => [
    ...props.projectAssets,
    ...snapshot.entries,
  ], [props.projectAssets, snapshot]);
  const rows = assets.filter(a => (location !== "all" || a.location === "project" || !props.projectAssets.some(p => p.fingerprint === a.fingerprint && p.originalPath === a.path)) && a.kind === kind && (location === "all" || a.location === location) &&
    (!onlyFavorites || favorites.includes(a.originalPath ?? a.path ?? a.key)) && `${a.name} ${a.fileName}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "recent" ? (recent.indexOf(assetKey(a)) < 0 ? Infinity : recent.indexOf(assetKey(a))) - (recent.indexOf(assetKey(b)) < 0 ? Infinity : recent.indexOf(assetKey(b))) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  const firstRow = rows.length > 100 ? Math.max(0, Math.floor(scrollTop / 46) - 10) : 0;
  const visibleRows = rows.length > 100 ? rows.slice(firstRow, firstRow + 50) : rows;
  const detail = assets.find(a => a.key === selected);
  const replacement = detail?.location === "project" ? snapshot.entries.find(e => e.path === detail.originalPath && e.fingerprint !== detail.fingerprint) : undefined;
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setMessages([]); try { await action(); } catch (error) { setMessages([error instanceof Error ? error.message : String(error)]); } finally { setBusy(false); } };
  const add = (asset: AssetRow) => run(async () => { await props.onAdd(asset); setRecent(r => [assetKey(asset), ...r.filter(k => k !== assetKey(asset))].slice(0, 100)); });
  const importAssets = () => run(async () => {
    if (!desktop) return;
    const result = await desktop.importLibraryAssets(); setSnapshot(result.snapshot);
    setMessages(result.results.map(r => r.error ? `${r.path.split(/[\\/]/).pop()}: ${r.error}` : `${r.path.split(/[\\/]/).pop()}: imported`));
  });
  const drop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    void run(async () => { setMessages(await props.onDropFiles(files)); if (desktop) setSnapshot(await desktop.scanLibrary()); });
  };
  return <div className={`asset-browser ${collapsed ? "collapsed" : ""} ${dragging ? "drop-active" : ""}`} aria-busy={busy}
    onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
    <div className="navigator-heading"><button className="tree-label" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<strong>Assets</strong><small>{assets.length}</small></button>
      <button disabled={busy} aria-expanded={menu} onClick={() => { setMenu(!menu); setCollapsed(false); }}>Import ▾</button></div>
    {!collapsed && <>
      {menu && <div className="asset-import-menu">
        {desktop && <button disabled={busy} onClick={() => { setMenu(false); void importAssets(); }}>Import to library…</button>}
        {!desktop && <button onClick={() => { setMenu(false); props.onImportFile("speaker"); }}>Import speaker package…</button>}
        {!desktop && <button onClick={() => { setMenu(false); props.onImportFile("rigid"); }}>Import rigid mesh…</button>}
        {desktop && <><button disabled={busy} onClick={() => { setMenu(false); void run(async () => setSnapshot(await desktop.libraryFolder("choose"))); }}>Choose library folder…</button>
        <button onClick={() => { setMenu(false); void run(async () => setSnapshot(await desktop.libraryFolder("open"))); }}>Open library folder</button></>}
      </div>}
      <div className="asset-type-tabs" role="tablist" aria-label="Asset type"><button role="tab" aria-selected={kind === "speaker"} className={kind === "speaker" ? "active" : ""} onClick={() => setKind("speaker")}>Speakers</button><button role="tab" aria-selected={kind === "rigid"} className={kind === "rigid" ? "active" : ""} onClick={() => setKind("rigid")}>Rigid meshes</button></div>
      <div className="navigator-search"><input aria-label="Search assets" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets…" /><button title="Show favorites" aria-label="Show favorites" aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={14} fill={onlyFavorites ? "currentColor" : "none"} /></button></div>
      <div className="asset-filters"><select aria-label="Asset location" value={location} onChange={e => setLocation(e.target.value)}><option value="all">All locations</option><option value="library">My library</option><option value="project">Project assets</option><option value="builtin">Built-in</option></select><select aria-label="Sort assets" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name</option><option value="recent">Recently used</option></select></div>
      <div key={`${kind}:${location}:${search}:${onlyFavorites}:${sort}`} className="asset-list" onScroll={e => setScrollTop(e.currentTarget.scrollTop)} role="list" aria-label={kind === "speaker" ? "Speaker library" : "Rigid mesh library"}>
        {firstRow > 0 && <div aria-hidden="true" style={{ height: firstRow * 46 }} />}
        {visibleRows.map(asset => {
          const Icon = asset.kind === "speaker" ? Speaker : Box;
          const favoriteKey = asset.originalPath ?? asset.path ?? asset.key;
          return <div className={`asset-row package-card ${selected === asset.key ? "active" : ""}`} key={asset.key} role="listitem"
            data-package-id={asset.kind === "speaker" ? asset.projectId ?? asset.key : undefined} data-rigid-mesh-id={asset.kind === "rigid" ? asset.projectId ?? asset.key : undefined}
            aria-setsize={rows.length} aria-posinset={firstRow + visibleRows.indexOf(asset) + 1}
            draggable={!asset.error} onDragStart={e => { e.dataTransfer.setData("application/x-deploy-asset", JSON.stringify(asset)); e.dataTransfer.effectAllowed = "copy"; }}>
            <button className="asset-select" title={asset.error ?? asset.name} onClick={() => setSelected(asset.key)} aria-pressed={selected === asset.key}><Icon size={17} /><span><strong className="package-name">{asset.name}</strong><small className="package-subtitle">{asset.error ? "Needs attention" : asset.location === "project" ? "In project" : asset.location === "builtin" ? "Built-in" : "My library"}{asset.level ? ` · L${asset.level}` : ""}{asset.location === "project" && snapshot.entries.some(e => e.path === asset.originalPath && e.fingerprint !== asset.fingerprint) ? " · Update" : ""}</small></span></button>
            <button className="row-control" title="Favorite" aria-label={`Favorite ${asset.name}`} aria-pressed={favorites.includes(favoriteKey)} onClick={() => setFavorites(f => f.includes(favoriteKey) ? f.filter(k => k !== favoriteKey) : [...f, favoriteKey])}><Star size={12} fill={favorites.includes(favoriteKey) ? "currentColor" : "none"} /></button>
            <button className="row-control" disabled={busy || Boolean(asset.error)} title={`Add ${asset.name} to scene`} aria-label={`Add ${asset.name} to scene`} onClick={() => void add(asset)}><Plus size={15} /></button>
          </div>;
        })}
        {rows.length > firstRow + visibleRows.length && <div aria-hidden="true" style={{ height: (rows.length - firstRow - visibleRows.length) * 46 }} />}
        {!rows.length && <p className="navigator-empty">{search || onlyFavorites ? "No matching assets." : desktop ? "Drop .blabsp packages or .msh meshes here, or import files to your library." : "Add a speaker package or rigid mesh from a file. Folder libraries are available in the desktop app."}</p>}
      </div>
      {detail && <details className="asset-details" open><summary>{detail.name}</summary><p>{detail.fileName}</p><p title={detail.originalPath ?? detail.path ?? "Browser file"}>{detail.originalPath ?? detail.path ?? "Browser file"}</p>
        {detail.error && <p role="alert">{detail.error}</p>}
        {detail.fingerprint && <p>Version {detail.fingerprint.slice(0, 12)}</p>}
        {replacement && <p>Update available. <button disabled={busy || Boolean(replacement.error)} onClick={() => void run(() => props.onUpdate(detail, replacement))}>Apply to project</button></p>}
        {detail.location === "project" && desktop && detail.path && <button disabled={busy} onClick={() => void run(async () => { const result = await desktop.importLibraryAssets([detail.path!]); setSnapshot(result.snapshot); setMessages(result.results.map(r => r.error ?? "Copied to library")); })}>Copy to library</button>}
        <button onClick={() => setSelected(null)}>Close details</button>
      </details>}
      {(messages.length > 0 || snapshot.errors.length > 0) && <div className="asset-messages" role="status">{[...messages, ...snapshot.errors].map((message, i) => <p key={i}>{message}</p>)}{messages.length > 0 && <button onClick={() => setMessages([])}>Dismiss</button>}</div>}
      <div className="asset-footer">{desktop ? <><button title={snapshot.root || "Choose library folder"} onClick={() => void run(async () => setSnapshot(await desktop.libraryFolder("choose")))}><FolderOpen size={13} /><span>{snapshot.root.split(/[\\/]/).pop() || "Library folder…"}</span></button><small>Auto-refresh</small><button disabled={busy} aria-label="Refresh library" onClick={() => void run(async () => setSnapshot(await desktop.scanLibrary()))}><RefreshCw size={13} /></button></> : <small>Project assets · Browser session</small>}</div>
    </>}
  </div>;
}
