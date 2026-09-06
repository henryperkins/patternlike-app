import type { PortraitManifest } from "../../lib/pattern-portrait.js";

export type Facet = "overview" | "tensions" | "resources" | "alternative";
export const facets: ReadonlyArray<{ id: Facet; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tensions", label: "Tensions" },
  { id: "resources", label: "Resources" },
  { id: "alternative", label: "Another expression" },
];
export type Point3 = [number, number, number];
export interface CameraBookmark { position: Point3; target: Point3; }
export interface PortraitMeshAsset {
  chapterId: string;
  url: string;
  sha256: string;
  sourceImageSha256: string;
  sourceText: string;
}
export interface PortraitMeshBundle {
  version: "portrait-mesh-1";
  documentRevision: string;
  authoring: "authored-fictional-fixtures";
  assets: readonly PortraitMeshAsset[];
}
export type SceneStatus = "loading" | "ready" | "unavailable";
export type CameraCommand = {
  kind: "left" | "right" | "up" | "down" | "closer" | "farther" | "reset" | "frame";
  serial: number;
};
export interface PortraitSceneProps {
  assets: readonly PortraitMeshAsset[];
  chapters: ReadonlyArray<Pick<PortraitManifest["chapters"][number], "id" | "title" | "ordinal">>;
  selectedIds: readonly string[];
  facet: Facet;
  activePassage: number | null;
  unfolded: boolean;
  reducedMotion: boolean;
  expanded: boolean;
  quality: "standard" | "low";
  viewKey: string;
  bookmark?: CameraBookmark;
  command: CameraCommand;
  onBookmark: (viewKey: string, bookmark: CameraBookmark) => void;
  onSelect: (chapterId: string) => void;
  onAnnotation: () => void;
  onStatus: (status: SceneStatus) => void;
}
