import { html, render, nothing } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { mediaTestReference, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import { productMedia, productMediaFrame } from "./product-media.js";

const replacements = useMediaPresentations();
let host: HTMLDivElement;
afterEach(() => {
  render(nothing, host);
  host.remove();
});
it("refreshes product, variant and inherited colour-ring images without changing their edit action", async () => {
  const reference = mediaTestReference("parent.png");
  const replacement = mediaTestReference("replacement.webp");
  host = document.createElement("div");
  document.body.append(host);
  const open = vi.fn();
  render(
    html`${productMedia({ key: "parent", name: "Staff dish", image: reference, color: "#256bb1", busy: false, open })}
    ${productMediaFrame(reference, "#256bb1", true)}`,
    host,
  );
  const images = [...host.querySelectorAll("img")];
  await vi.waitFor(() =>
    expect(images.map((i) => i.getAttribute("src"))).toEqual([
      `/media/renditions/v1/${reference}/square/7500-2500-200.webp`,
      `/media/renditions/v1/${reference}/square/7500-2500-200.webp`,
    ]),
  );
  replacements.set(reference, replacement);
  invalidateMediaImages();
  await vi.waitFor(() =>
    expect(images.map((i) => i.getAttribute("src"))).toEqual([
      `/media/renditions/v1/${replacement}/square/7500-2500-200.webp`,
      `/media/renditions/v1/${replacement}/square/7500-2500-200.webp`,
    ]),
  );
  expect(images[0]!.parentElement!.part.contains("photo-ring")).toBe(true);
  expect(images[1]!.parentElement!.part.contains("inherited")).toBe(true);
  expect(images.every((i) => i.alt === "" && !i.draggable)).toBe(true);
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/manage/catalogue/product/parent?field=image");
  link.click();
  expect(open).toHaveBeenCalledOnce();
});
