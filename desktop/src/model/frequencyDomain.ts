import type { Fidelity, LoadedSpeakerPackage } from "./types";

export type Band = [number, number];
type Domain = { band: Band | null; grid: number[] };
export const sweepDensities = [1, 3, 6, 12, 24, 48, 96];
export const defaultDensity = 12;

export function hasCoupledROM(pkg: LoadedSpeakerPackage) {
  const representation = pkg.manifest.files.coupled_model?.representation;
  return representation === "continuous_speaker_rom" || representation === "parity_petrov_galerkin_rom";
}

export function frequencyDomain(packages: readonly LoadedSpeakerPackage[], fidelity: Fidelity): Domain {
  let low = 0, high = Infinity;
  const grids: ArrayLike<number>[] = [];
  for (const pkg of packages) {
    const { files, frequencies_hz } = pkg.manifest;
    const model = files.coupled_model;
    if (fidelity === "coupled" && model?.representation === "continuous_speaker_rom") {
      const band = model.frequency_band_hz;
      if (!Array.isArray(band) || band.length !== 2 || !band.every(f => Number.isFinite(f) && f > 0)) return { band: null, grid: [] };
      low = Math.max(low, band[0]);
      high = Math.min(high, band[1]);
    } else if (fidelity === "pattern" && files.patterns?.evaluator === "delay_compensated_linear_v1") {
      low = Math.max(low, pkg.frequenciesHz[0]);
      high = Math.min(high, pkg.frequenciesHz[pkg.frequenciesHz.length - 1]);
    } else {
      grids.push(fidelity === "pattern" ? pkg.frequenciesHz : frequencies_hz);
    }
    if (model?.representation === "parity_petrov_galerkin_rom" && fidelity === "pattern") grids.push(frequencies_hz);
  }
  if (!packages.length || low > high) return { band: null, grid: [] };
  if (!grids.length) return low < high ? { band: [low, high], grid: [] } : { band: null, grid: [low] };
  const candidates = [...new Set(Array.from(grids[0]))].sort((a, b) => a - b);
  const grid = candidates.filter(f => f >= low && f <= high && grids.slice(1).every(g =>
    Array.from(g).some(x => Math.abs(f - x) <= Math.max(1e-4, f * 1e-6))));
  return { band: null, grid };
}

export function effectiveRange(band: Band, range?: Band): Band {
  if (!range) return band;
  const low = Math.max(band[0], range[0]), high = Math.min(band[1], range[1]);
  return low < high ? [low, high] : band;
}

export function sweepGrid([low, high]: Band, density: number) {
  const intervals = Math.max(1, Math.ceil(Math.log2(high / low) * density));
  return Array.from({ length: intervals + 1 }, (_, i) => i === intervals ? high : low * (high / low) ** (i / intervals));
}

export function selectFrequency(domain: Domain, requested: number) {
  if (domain.band) return Math.max(domain.band[0], Math.min(domain.band[1], requested));
  return domain.grid.length ? domain.grid.reduce((a, b) => Math.abs(a - requested) <= Math.abs(b - requested) ? a : b) : requested;
}
