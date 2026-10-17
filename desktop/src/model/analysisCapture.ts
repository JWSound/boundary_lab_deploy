import type { BemResponseData, MicrophoneOverlay } from "../components/MicrophoneResponsePlot";
import type { DriverExcursionData } from "../components/DriverExcursionPlot";
import type { ElectricalData } from "../components/ElectricalPlot";
import type { MicrophoneResponseSet, MicrophoneSweepResult } from "./types";

export interface AnalysisCapture {
  id: string;
  name: string;
  createdAt: string;
  project: string;
  pattern: MicrophoneResponseSet;
  boundary: BemResponseData | null;
  coupled: BemResponseData | null;
  excursion: DriverExcursionData | null;
  electrical: ElectricalData | null;
  raw: Partial<Record<"boundary" | "coupled", MicrophoneSweepResult>>;
}

/** Copy arrays and maps so subsequent streaming updates cannot mutate a capture. */
export function captureAnalysis(value: AnalysisCapture): AnalysisCapture {
  return structuredClone(value);
}

export function microphoneOverlays(captures: AnalysisCapture[]): MicrophoneOverlay[] {
  return captures.flatMap((capture) => {
    const names = new Map(capture.pattern.traces.map((trace) => [trace.microphoneId, trace.microphoneName]));
    const traces: MicrophoneOverlay[] = capture.pattern.traces.map((trace) => ({
      id: `${capture.id}:pattern:${trace.microphoneId}`,
      name: `${capture.name} / ${trace.microphoneName} / Pattern`,
      method: "pattern",
      frequenciesHz: capture.pattern.frequenciesHz,
      values: trace.splDb,
    }));
    for (const method of ["boundary", "coupled"] as const) {
      const response = capture[method];
      if (response) for (const [id, values] of response.traces) traces.push({
        id: `${capture.id}:${method}:${id}`,
        name: `${capture.name} / ${names.get(id) ?? id} / ${method}`,
        method,
        frequenciesHz: response.frequenciesHz,
        values,
      });
    }
    return traces;
  });
}

export function serializeCapture(capture: AnalysisCapture): string {
  return JSON.stringify({ schema: "boundary-lab-deploy-analysis", schema_version: 1, ...capture }, (_key, value) => {
    if (value instanceof Map) return Object.fromEntries(value);
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
    return value;
  }, 2);
}

/** Restore JSON samples without turning missing (null) values into false zeroes. */
export function parseCapture(value: unknown): AnalysisCapture {
  const arrays = new Set(["splDb", "excursionMm", "impedanceMagnitudeOhm", "impedancePhaseDeg", "rmsCurrentA", "realPowerW", "acousticResistance", "acousticReactance", "differentialPressurePa"]);
  const capture = JSON.parse(JSON.stringify(value), (key, item) => {
    if (key === "frequenciesHz" || arrays.has(key)) {
      if (!Array.isArray(item) || item.some(v => v !== null && (typeof v !== "number" || !Number.isFinite(v)))) throw new Error("Invalid capture samples.");
      if (key === "frequenciesHz" && item.some(v => v === null || v <= 0)) throw new Error("Invalid capture frequencies.");
      const samples = item.map(v => v === null ? NaN : v);
      return key === "frequenciesHz" ? new Float64Array(samples) : new Float32Array(samples);
    }
    if (key === "traces" && item && !Array.isArray(item)) return new Map(Object.entries(item).map(([id, trace]) => [id, Array.isArray(trace) ? new Float32Array(trace.map(v => v === null ? NaN : v)) : trace]));
    return item;
  }) as AnalysisCapture;
  if (!capture || [capture.id, capture.name, capture.createdAt, capture.project].some(v => typeof v !== "string") || !capture.id || !capture.pattern || !(capture.pattern.frequenciesHz instanceof Float64Array) || !Array.isArray(capture.pattern.traces) || !capture.raw) throw new Error("Invalid analysis capture.");
  const check = (samples: Float32Array, length: number) => {
    if (!(samples instanceof Float32Array) || samples.length !== length) throw new Error("Capture sample count does not match its frequencies.");
  };
  for (const trace of capture.pattern.traces) {
    if (typeof trace.microphoneId !== "string" || typeof trace.microphoneName !== "string") throw new Error("Invalid capture microphone.");
    check(trace.splDb, capture.pattern.frequenciesHz.length);
  }
  for (const response of [capture.boundary, capture.coupled, capture.excursion, capture.electrical]) {
    if (!response) continue;
    if (!(response.frequenciesHz instanceof Float64Array) || !(response.traces instanceof Map)) throw new Error("Invalid capture response.");
    for (const trace of response.traces.values()) {
      if (trace instanceof Float32Array) check(trace, response.frequenciesHz.length);
      else for (const [key, samples] of Object.entries(trace)) if (arrays.has(key)) check(samples as Float32Array, trace.frequenciesHz?.length ?? response.frequenciesHz.length);
    }
  }
  for (const sweep of Object.values(capture.raw)) {
    if (!sweep || !Array.isArray(sweep.frequencies_hz) || !Array.isArray(sweep.transducer_ids) || !Array.isArray(sweep.transducer_names)) throw new Error("Invalid captured sweep.");
    if (sweep.acoustic_loading && (!Array.isArray(sweep.acoustic_loading.resistance) || !Array.isArray(sweep.acoustic_loading.reactance))) throw new Error("Invalid captured acoustic loading.");
  }
  const { id, name, createdAt, project, pattern, boundary, coupled, excursion, electrical, raw } = capture;
  return { id, name, createdAt, project, pattern, boundary, coupled, excursion, electrical, raw };
}
