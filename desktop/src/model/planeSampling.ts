import type { ObservationPlane } from "./types";

export const MIN_POINTS_PER_METER = 0.5;
export const MAX_POINTS_PER_METER = 10;
export const DEFAULT_POINTS_PER_METER = 2;
export const MAX_PLANE_POINTS = 250_000;

export function validateGrid(columns: number, rows: number): void {
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 2 || rows < 2) throw new Error("Plane grid must have at least two integer rows and columns.");
  if (columns * rows > MAX_PLANE_POINTS) throw new Error("Plane exceeds the 250,000-point limit. Reduce its size or points/m.");
}

export function densityGrid(widthM: number, depthM: number, pointsPerMeter: number): [number, number] {
  if (!Number.isFinite(widthM) || !Number.isFinite(depthM) || widthM <= 0 || depthM <= 0) throw new Error("Plane dimensions must be positive and finite.");
  if (!Number.isFinite(pointsPerMeter) || pointsPerMeter < MIN_POINTS_PER_METER || pointsPerMeter > MAX_POINTS_PER_METER) throw new Error("Plane resolution must be between 0.5 and 10 points/m.");
  const columns = Math.max(2, Math.ceil(widthM * pointsPerMeter) + 1);
  const rows = Math.max(2, Math.ceil(depthM * pointsPerMeter) + 1);
  validateGrid(columns, rows);
  return [columns, rows];
}

export function validatePlaneSampling(plane: ObservationPlane): void {
  validateGrid(plane.columns, plane.rows);
  if (plane.pointsPerMeter !== undefined) {
    const [columns, rows] = densityGrid(plane.widthM, plane.depthM, plane.pointsPerMeter);
    if (columns !== plane.columns || rows !== plane.rows) throw new Error("Plane grid does not match its points/m and dimensions.");
  }
}

export function withPlaneDensity(plane: ObservationPlane, pointsPerMeter: number): ObservationPlane {
  const [columns, rows] = densityGrid(plane.widthM, plane.depthM, pointsPerMeter);
  return { ...plane, pointsPerMeter, columns, rows };
}

export function resizedPlaneGrid(plane: ObservationPlane, widthM: number, depthM: number): [number, number] {
  if (plane.pointsPerMeter !== undefined) return densityGrid(widthM, depthM, plane.pointsPerMeter);
  // Legacy planes retain the previous fixed-major-axis resize behavior until edited.
  const major = Math.max(plane.columns, plane.rows);
  const result: [number, number] = widthM >= depthM
    ? [major, Math.max(2, Math.round((major - 1) * depthM / widthM) + 1)]
    : [Math.max(2, Math.round((major - 1) * widthM / depthM) + 1), major];
  validateGrid(...result);
  return result;
}
