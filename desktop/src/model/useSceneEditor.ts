import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EditorHistory } from "./editorHistory";
import { initialScene, equalScene, type EditableScene } from "./sceneEditor";

export function useSceneEditor() {
  const [editor] = useState(() => new EditorHistory(initialScene(), equalScene));
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const setters = useMemo(() => {
    const field = <K extends keyof EditableScene>(key: K, label: string, record = true) =>
      (value: EditableScene[K] | ((current: EditableScene[K]) => EditableScene[K])) => editor.set(key, value, record, label);
    return {
      setPackages: field("packages", "Import speaker package"), setRigidMeshes: field("rigidMeshes", "Import rigid mesh"),
      setSourceConfigs: field("sourceConfigs", "Edit speakers"), setRigidObjects: field("rigidObjects", "Edit rigid objects"),
      setMicrophones: field("microphones", "Edit microphones"), setChannels: field("channels", "Edit channels"),
      setObservation: field("observation", "Edit audience plane"), setProjectName: field("projectName", "Rename project"),
      setFrequencyIndex: field("frequencyIndex", "Change frequency"), setFidelity: field("fidelity", "Change fidelity"),
      setSelectedInstances: field("selectedInstances", "", false), setActivePackageId: field("activePackageId", "", false),
      setActiveRigidMeshId: field("activeRigidMeshId", "", false), setActiveChannelId: field("activeChannelId", "", false),
    };
  }, [editor]);
  useEffect(() => {
    let dragging = false;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("canvas, input[type=range]")) {
        dragging = true;
        editor.begin(event.target.closest("canvas") ? "Transform objects" : "Adjust slider");
      }
    };
    const finish = () => {
      const transaction = editor.transactionId;
      queueMicrotask(() => { if (editor.transactionId === transaction) editor.end(); });
    };
    const release = () => { if (dragging) { dragging = false; finish(); } };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches("input:not([type=range]),textarea")) {
        editor.begin(`Edit ${event.target.getAttribute("aria-label") || "property"}`);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input[type=range]") &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key) && !event.repeat) editor.begin("Adjust slider");
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input[type=range]")) finish();
    };
    const blur = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches("input:not([type=range]),textarea")) finish();
    };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("focusin", focus);
    window.addEventListener("focusout", blur);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("focusout", blur);
      window.removeEventListener("blur", finish);
    };
  }, [editor]);
  return { editor, ...snapshot, ...setters };
}
