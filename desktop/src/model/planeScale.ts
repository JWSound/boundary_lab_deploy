import type { ObservationPlane } from "./types";
import { defaultObservation } from "./sceneState";

export type PlaneScale = Pick<ObservationPlane, "heatmapMinimumDb" | "heatmapMaximumDb" | "heatmapBandingDb" | "pressureScalePa">;
export function planeScale(plane: ObservationPlane = defaultObservation): PlaneScale {
  const { heatmapMinimumDb, heatmapMaximumDb, heatmapBandingDb, pressureScalePa } = plane;
  return { heatmapMinimumDb, heatmapMaximumDb, heatmapBandingDb, pressureScalePa };
}
