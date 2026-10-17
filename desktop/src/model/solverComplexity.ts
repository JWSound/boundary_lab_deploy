import type { Fidelity, LoadedSpeakerPackage, RigidMeshAsset, SourceConfiguration, RigidMeshConfiguration } from "./types";

export type SolverBackend = "cpu" | "cuda" | "metal";
export interface MemoryRange { minimum: number; maximum: number }
export interface SolverComplexity {
  boundaryUnknowns: number | null;
  reducedStates: number | null;
  memory: { system: MemoryRange; gpu?: MemoryRange; unified: boolean } | null;
}
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Geometry counts use the exported solver mesh, never the viewport OBJ.
 * ROM states are eliminated internally; they are not added to the boundary system order.
 * Memory is an uncalibrated working-set range for one frequency, not total process RSS.
 */
export function estimateSolverComplexity(packages: LoadedSpeakerPackage[], sources: Pick<SourceConfiguration, "packageId">[],
  meshes: RigidMeshAsset[], objects: Pick<RigidMeshConfiguration, "assetId">[], fidelity: Fidelity,
  backend: SolverBackend | null, evaluationPoints = 0): SolverComplexity {
  let nodes = 0, faces = 0, reducedStates = 0, romBytes = 0;
  let geometryKnown = true, romKnown = true;
  const byPackage = new Map(packages.map(p => [p.id, p]));
  const byMesh = new Map(meshes.map(m => [m.id, m]));
  for (const source of sources) {
    const pkg = byPackage.get(source.packageId);
    const fixed = pkg?.manifest.files.fixed_sources;
    const n = pkg?.mesh ? pkg.mesh.positions.length / 3 : fixed?.exported_node_count;
    const f = pkg?.mesh ? pkg.mesh.indices.length / 3 : fixed?.exported_face_count;
    if (!positiveInteger(n) || !positiveInteger(f)) geometryKnown = false;
    else { nodes += n; faces += f; }
    if (fidelity === "coupled") {
      const rom = pkg?.manifest.files.coupled_model;
      const rank = rom?.rank_per_sector;
      const sectors = Array.isArray(rom?.sector_signs) ? rom.sector_signs.length : 0;
      if (rom?.representation !== "parity_petrov_galerkin_rom" || !positiveInteger(rank) || !positiveInteger(sectors)) romKnown = false;
      else {
        reducedStates += rank * sectors;
        // Allow for reduced K/factors and boundary input/output maps per instance.
        if (positiveInteger(n) && positiveInteger(f)) romBytes += 8 * sectors * (2 * rank * rank + rank * (n + f));
      }
    }
  }
  for (const object of objects) {
    const mesh = byMesh.get(object.assetId);
    if (!mesh || !positiveInteger(mesh.vertexCount) || !positiveInteger(mesh.triangleCount)) geometryKnown = false;
    else { nodes += mesh.vertexCount; faces += mesh.triangleCount; }
  }
  const result: SolverComplexity = { boundaryUnknowns: geometryKnown ? nodes : null,
    reducedStates: fidelity === "coupled" && !romKnown ? null : reducedStates, memory: null };
  if (!geometryKnown || !romKnown || !backend) return result;
  if (nodes === 0) { result.memory = { system: { minimum: 0, maximum: 0 }, unified: backend === "metal" }; return result; }
  const matrix = 8 * nodes * nodes, mixedOperator = 8 * nodes * faces;
  const vectors = 8 * nodes * (fidelity === "coupled" ? 40 : 8);
  const geometry = 256 * (nodes + faces);
  const samples = 64 * Math.max(0, evaluationPoints);
  const auxiliary = romBytes + vectors + geometry + samples;
  const range = (minimum: number, maximum: number) => ({ minimum, maximum });
  if (backend === "cuda") {
    // Direct-system assembly plus LU workspace. Coupled feedback may retain an N×F map.
    result.memory = { system: range(auxiliary, 2 * auxiliary + matrix),
      gpu: range(1.5 * matrix + auxiliary, 3 * matrix + 2 * auxiliary + (fidelity === "coupled" ? mixedOperator : 0)), unified: false };
  } else {
    // CPU/Metal retain boundary operators, the assembled system and factorization.
    const base = 4 * matrix + 2 * mixedOperator + auxiliary;
    result.memory = { system: range(base, 2 * base), unified: backend === "metal" };
  }
  return result;
}

export function formatMemoryRange(range: MemoryRange): string {
  if (range.maximum === 0) return "0 MiB";
  const unit = range.maximum >= 1024 ** 3 ? "GiB" : "MiB";
  const divisor = unit === "GiB" ? 1024 ** 3 : 1024 ** 2;
  const format = (bytes: number) => Math.max(0.1, bytes / divisor).toFixed(1);
  return `~${format(range.minimum)}–${format(range.maximum)} ${unit}`;
}
