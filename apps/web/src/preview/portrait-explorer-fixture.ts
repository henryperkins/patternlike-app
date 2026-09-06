import metadata from "../../public/portrait-explorer/fixtures.json";
import type { PortraitMeshBundle } from "../components/portrait-explorer/types.js";
import { nativeImageBindings } from "./native-image-study.js";

/** These authored study assets are intentionally confined to the fictional preview entry. */
export const portraitExplorerFixture: PortraitMeshBundle = {
  version: "portrait-mesh-1",
  authoring: "authored-fictional-fixtures",
  documentRevision: nativeImageBindings[0].documentRevision,
  assets: metadata.assets.map((asset) => ({
    chapterId: asset.chapterId,
    url: `/portrait-explorer/${asset.file}`,
    sha256: asset.sha256,
    sourceImageSha256: asset.sourceImageSha256,
    sourceText: nativeImageBindings.find((binding) => binding.chapterId === asset.chapterId)!.sourceText,
  })),
};
