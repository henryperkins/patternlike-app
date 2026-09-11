import type { PortraitManifest } from "../../lib/pattern-portrait.js";
import type { ZodiacSignName } from "@patternlike/shared";
import type { PortraitSky, PortraitSkyBody } from "../../lib/portrait-sky.js";

export type Facet = "overview" | "tensions" | "resources" | "alternative";
export const facets: ReadonlyArray<{ id: Facet; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tensions", label: "Tensions" },
  { id: "resources", label: "Resources" },
  { id: "alternative", label: "Another expression" },
];
export type Point3 = [number, number, number];
export interface CameraBookmark { position: Point3; target: Point3; frameDistance?: number; }
export interface PortraitMeshAsset {
  chapterId: string;
  url: string;
  sha256: string;
  sourceImageSha256: string;
  sourceText: string;
  provenance?: {
    authoring: "codex-parametric/v1" | "codex-parametric/v2";
    documentRevision: string;
    sourceTextSha256: string;
    programSha256: string;
    compilerVersion: "portrait-mesh-compiler/v1" | "portrait-mesh-compiler/v2";
    chapterCount?: 3 | 4 | 5 | 6;
  };
}
export interface PortraitMeshBundle {
  version: "portrait-mesh-1";
  documentRevision: string;
  authoring: "authored-fictional-fixtures" | "codex-parametric/v1" | "codex-parametric/v2";
  assets: readonly PortraitMeshAsset[];
}
export type SceneStatus = "loading" | "ready" | "unavailable";
export interface ObservatoryExperience {
  roofOpen: boolean;
  lighting: "day" | "dusk";
  inspect: boolean;
  openDesks: Readonly<Record<string, boolean>>;
  turns: Readonly<Record<string, number>>;
}
export type CameraCommand = {
  kind: "left" | "right" | "up" | "down" | "closer" | "farther" | "reset" | "frame";
  serial: number;
};
export interface PortraitSceneProps {
  sky?: PortraitSky | null;
  sunSign?: ZodiacSignName | null;
  skyView?: boolean;
  selectedSkyBody?: PortraitSkyBody | null;
  onSelectSkyBody?: (body: PortraitSkyBody) => void;
  experience?: ObservatoryExperience;
  onOperate?: (chapterId: string) => void;
  assets: readonly PortraitMeshAsset[];
  chapters: ReadonlyArray<Pick<PortraitManifest["chapters"][number], "id" | "title" | "ordinal">>;
  selectedIds: readonly string[];
  facet: Facet;
  activePassages: Readonly<Record<string, number>>;
  unfolded: boolean;
  reducedMotion: boolean;
  expanded: boolean;
  quality: "standard" | "low";
  viewKey: string;
  bookmark?: CameraBookmark;
  command: CameraCommand;
  onBookmark: (viewKey: string, bookmark: CameraBookmark) => void;
  onSelect: (chapterId: string) => void;
  onAnnotation: (chapterId: string) => void;
  onStatus: (status: SceneStatus) => void;
  onArtworkFallback?: (fallback: boolean) => void;
}
