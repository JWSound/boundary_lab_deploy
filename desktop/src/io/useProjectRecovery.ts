import { useEffect, useRef, useState } from "react";

/** Debounced writes plus a maximum interval protect continuously edited scenes. */
export function useProjectRecovery(id: string, contents: string, dirty: boolean, ready: boolean) {
  const [status, setStatus] = useState("");
  const latest = useRef({ id, contents, dirty, ready });
  latest.current = { id, contents, dirty, ready };
  const written = useRef("");
  const flush = async () => {
    const snapshot = latest.current;
    const desktop = window.boundaryLabDesktop;
    if (!snapshot.ready || !desktop?.recoveryWrite || !desktop.recoveryRemove) return;
    const token = snapshot.id + (snapshot.dirty ? snapshot.contents : "clean");
    if (written.current === token) { setStatus(snapshot.dirty ? "Recovery copy saved" : ""); return; }
    try {
      if (snapshot.dirty) await desktop.recoveryWrite(snapshot.id, snapshot.contents);
      else await desktop.recoveryRemove(snapshot.id);
      written.current = token;
      if (latest.current.id === snapshot.id && latest.current.contents === snapshot.contents && latest.current.dirty === snapshot.dirty) setStatus(snapshot.dirty ? "Recovery copy saved" : "");
    } catch { setStatus("Autosave failed — save your project manually"); }
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    if (ready && window.boundaryLabDesktop?.recoveryWrite) setStatus(dirty ? "Saving recovery copy..." : "");
    const timer = window.setTimeout(() => void flushRef.current(), 1000);
    return () => window.clearTimeout(timer);
  }, [id, contents, dirty, ready]);
  useEffect(() => {
    const timer = window.setInterval(() => void flushRef.current(), 10000);
    const unload = () => { void flushRef.current(); };
    window.addEventListener("beforeunload", unload);
    return () => { window.clearInterval(timer); window.removeEventListener("beforeunload", unload); };
  }, []);
  return status;
}
