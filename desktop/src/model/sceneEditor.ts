import { planeScale, type PlaneScale } from "./planeScale";
import type { DeployChannel, Fidelity, LoadedSpeakerPackage, MicrophoneConfiguration, AudiencePlane, RigidMeshAsset, RigidMeshConfiguration, SourceConfiguration } from "./types";
import { createDemoPackage } from "./demoPackage";
import { createDefaultChannel, DEFAULT_CHANNEL_ID } from "./channels";
import { defaultSources, defaultObservation } from "./sceneState";
import { nearestFrequencyIndex } from "./field";

export interface EditableScene {
  packages: LoadedSpeakerPackage[];
  rigidMeshes: RigidMeshAsset[];
  sourceConfigs: SourceConfiguration[];
  rigidObjects: RigidMeshConfiguration[];
  microphones: MicrophoneConfiguration[];
  channels: DeployChannel[];
  audiencePlanes: AudiencePlane[];
  heatmapScale: PlaneScale;
  activePlaneId: string | null;
  projectName: string;
  frequencyIndex: number;
  fidelity: Fidelity;
  selectedInstances: string[];
  activePackageId: string;
  activeRigidMeshId: string | null;
  activeChannelId: string;
}
export function exampleScene(): EditableScene {
  const pkg = createDemoPackage();
  return { packages: [pkg], rigidMeshes: [], sourceConfigs: defaultSources(pkg), rigidObjects: [], microphones: [],
    channels: [createDefaultChannel()], heatmapScale: planeScale(), audiencePlanes: [{ ...defaultObservation, id: "audience-plane", name: "Audience plane" }], activePlaneId: "audience-plane", projectName: "S218BP Subwoofer Study",
    frequencyIndex: nearestFrequencyIndex(pkg, 80), fidelity: "pattern", selectedInstances: ["subwoofer-1"],
    activePackageId: pkg.id, activeRigidMeshId: null, activeChannelId: DEFAULT_CHANNEL_ID };
}
export function equalScene(a: EditableScene, b: EditableScene): boolean {
  // Keep loaded geometry/typed arrays by reference; serialize only small editable values.
  const assetEqual = (x: unknown[], y: unknown[]) => x.length === y.length && x.every((item, i) => item === y[i]);
  if (!assetEqual(a.packages, b.packages) || !assetEqual(a.rigidMeshes, b.rigidMeshes)) return false;
  const document = (s: EditableScene) => [s.sourceConfigs, s.rigidObjects, s.microphones, s.channels,
    s.audiencePlanes, s.heatmapScale, s.projectName, s.frequencyIndex, s.fidelity];
  return JSON.stringify(document(a)) === JSON.stringify(document(b));
}

export function initialScene(): EditableScene {
  return { packages: [], rigidMeshes: [], sourceConfigs: [], rigidObjects: [], microphones: [],
    channels: [createDefaultChannel()], heatmapScale: planeScale(), audiencePlanes: [], activePlaneId: null, projectName: "Untitled project",
    frequencyIndex: 0, fidelity: "pattern", selectedInstances: [], activePackageId: "", activeRigidMeshId: null,
    activeChannelId: DEFAULT_CHANNEL_ID };
}
