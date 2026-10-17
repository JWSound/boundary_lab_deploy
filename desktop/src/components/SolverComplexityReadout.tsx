import { useMemo } from "react";
import { estimateSolverComplexity, formatMemoryRange, type SolverBackend } from "../model/solverComplexity";
import type { Fidelity, LoadedSpeakerPackage, RigidMeshAsset, SourceConfiguration, RigidMeshConfiguration } from "../model/types";

export function SolverComplexityReadout({ packages, sources, meshes, objects, fidelity, backend, evaluationPoints }: {
  packages: LoadedSpeakerPackage[]; sources: SourceConfiguration[]; meshes: RigidMeshAsset[];
  objects: RigidMeshConfiguration[]; fidelity: Fidelity; backend: SolverBackend | null; evaluationPoints: number;
}) {
  const stats = useMemo(() => estimateSolverComplexity(packages, sources, meshes, objects, fidelity, backend, evaluationPoints),
    [packages, sources, meshes, objects, fidelity, backend, evaluationPoints]);
  if (fidelity === "pattern") return null;
  const count = (value: number | null) => value === null ? "unavailable" : value.toLocaleString();
  const memory = stats.memory;
  return <div className="solver-complexity" aria-label="Solver complexity estimate">
    <div>Boundary unknowns: {count(stats.boundaryUnknowns)}{fidelity === "coupled" && <> · Reduced states: {count(stats.reducedStates)}</>}</div>
    <div>Est. solver memory: {memory ? <>{memory.unified ? "Unified" : "RAM"} {formatMemoryRange(memory.system)}
      {memory.gpu && <> · GPU {formatMemoryRange(memory.gpu)}</>}</> : "unavailable"}</div>
  </div>;
}
