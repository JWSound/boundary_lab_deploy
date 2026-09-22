import { useEffect, useState } from "react";
import { FolderOpen, Plus, Waves, ArrowUpRight } from "lucide-react";
import { parseDeployProject } from "../io/deployProject";

export type ProjectStart = { kind: "new" | "example" } | { kind: "project"; selection: DesktopProjectSelection };
export function ProjectsScreen({ onStart }: { onStart: (start: ProjectStart) => void }) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try { const items = await window.boundaryLabDesktop?.recentProjects() ?? []; if (active) setRecent(items); }
      catch (caught) { if (active) setError(`Could not read recent projects: ${String(caught)}`); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  const open = async (path?: string) => {
    setOpening(true); setError(null);
    try {
      const selection = await window.boundaryLabDesktop?.openProject(path);
      if (selection) {
        const project = parseDeployProject(selection.contents);
        if (project.packages.length !== selection.packages.length || project.rigid_meshes.length !== selection.rigidMeshes.length) throw new Error("Required project assets were not located.");
        onStart({ kind: "project", selection });
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setOpening(false); }
  };
  return <main className="projects-screen">
    <header className="projects-brand"><div className="brand-mark"><Waves size={24} /></div><div><strong>Boundary Lab</strong><span>DEPLOY</span></div></header>
    <section className="projects-content">
      <div className="projects-heading"><div><p className="projects-eyebrow">YOUR WORKSPACE</p><h1>Projects</h1><p>Start a new scene or continue where you left off.</p></div>
        <div className="projects-actions"><button className="secondary-button" disabled={opening || !window.boundaryLabDesktop} onClick={() => void open()}><FolderOpen size={16} />Open project</button>
          <button className="primary-button" disabled={opening} onClick={() => onStart({ kind: "new" })}><Plus size={16} />New</button></div>
      </div>
      {error && <p className="projects-error" role="alert">{error}</p>}
      <section className="recent-projects" aria-label="Recent projects"><div className="projects-section-title"><h2>Recent projects</h2><span>{recent.length}</span></div>
        {loading ? <p className="projects-empty">Loading recent projects...</p> : recent.length === 0 ? <div className="projects-empty"><FolderOpen size={28}/><p>No recent projects yet.</p><span>Projects you open or save will appear here.</span></div> :
          <table><thead><tr><th>Project / file path</th><th>Last modified</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{recent.map(project => <tr key={project.path}>
            <td><button className="recent-project-link" disabled={opening || !project.available} onClick={() => void open(project.path)} title={project.path}><strong>{project.name}</strong><span>{project.path}</span></button>{!project.available && <small className="project-unavailable">File unavailable: reconnect its drive or use Open project to locate it.</small>}</td>
            <td>{project.modifiedAt ? new Date(project.modifiedAt).toLocaleString() : "Unavailable"}</td><td><ArrowUpRight size={16}/></td>
          </tr>)}</tbody></table>}
      </section>
      <section className="projects-examples"><div><p className="projects-eyebrow">EXAMPLE PROJECT</p><h2>S218BP subwoofer study</h2><p>Explore speaker placement and audience coverage with the bundled study.</p></div><button className="secondary-button" disabled={opening} onClick={() => onStart({ kind: "example" })}>Open example<ArrowUpRight size={16}/></button></section>
      {!window.boundaryLabDesktop && <p className="projects-browser-note">Recent files are available in the desktop app. In this preview, create a scene or open the example, then use the workspace to import files.</p>}
    </section>
  </main>;
}
