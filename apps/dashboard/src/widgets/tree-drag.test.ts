import { render, nothing } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { mediaTestReference, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import { dragGhost, placeDragGhost } from "./tree-drag.js";

const replacements = useMediaPresentations();
let host: HTMLDivElement;
afterEach(() => {
  render(nothing, host);
  host.remove();
});
it("keeps the dragged row's name and pointer position as its square photo follows replacement", async () => {
  const reference = mediaTestReference("folder.png");
  const replacement = mediaTestReference("replacement.webp");
  host = document.createElement("div");
  document.body.append(host);
  render(dragGhost({ label: "Included lunch", image: reference, folder: true }), host);
  const img = host.querySelector("img")!;
  await vi.waitFor(() =>
    expect(img.getAttribute("src")).toBe(
      `/media/renditions/v1/${reference}/square/7500-2500-200.webp`,
    ),
  );
  placeDragGhost(host, { x: 20, y: 70 });
  replacements.set(reference, replacement);
  invalidateMediaImages();
  await vi.waitFor(() =>
    expect(img.getAttribute("src")).toBe(
      `/media/renditions/v1/${replacement}/square/7500-2500-200.webp`,
    ),
  );
  expect(host.textContent).toContain("Included lunch");
  expect(host.querySelector<HTMLElement>(".drag-ghost")!.style.transform).toBe(
    "translate(20px, 70px)",
  );
  expect(img.alt).toBe("");
  expect(img.draggable).toBe(false);
});
