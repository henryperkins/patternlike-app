import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { nativeImageBindings, nativePattern } from "../../preview/native-image-study.js";
import { createPortraitManifest } from "../../lib/pattern-portrait.js";
import { PortraitExplorer } from "./PortraitExplorer.js";
import type { PortraitMeshBundle } from "./types.js";

vi.mock("./PortraitScene.js", () => { throw new TypeError("Failed to fetch dynamically imported module"); });

it("offers a page reload for missing scene code while keeping the complete reading reachable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const manifest = createPortraitManifest(nativePattern, nativeImageBindings);
  const bundle: PortraitMeshBundle = {
    version: "portrait-mesh-1", authoring: "authored-fictional-fixtures", documentRevision: manifest.revision,
    assets: nativeImageBindings.map((binding, index) => ({ chapterId: binding.chapterId, url: `/fixture-${index}.glb`, sha256: "a".repeat(64), sourceImageSha256: binding.object.referenceSha256, sourceText: binding.sourceText })),
  };
  render(<PortraitExplorer source={{ status: "ready", document: nativePattern }} objectBindings={nativeImageBindings} meshBundle={bundle} />);
  expect(await screen.findByRole("button", { name: "Reload page for 3D" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Try 3D again" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Full reading" }));
  expect(screen.getByText(nativePattern.core_chapters[3].counter_expression.text)).toBeVisible();
});
