import { mediaTestReference, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./product-editor.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

it("opens one image-and-colour panel and returns focus to the pencil thumbnail on Escape", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { color: "#256bb1" },
  );
  const control = document.createElement("button");
  control.slot = "controls";
  control.textContent = "Choose image";
  el.append(control);
  const thumb = el.shadowRoot?.querySelector<HTMLButtonElement>(".thumb");
  expect(thumb).not.toBeNull();
  expect(thumb).not.toBeUndefined();
  expect(thumb!.querySelector("wt-icon")).not.toBeNull();
  expect(thumb!.getAttribute("aria-haspopup")).toBe("dialog");
  await userEvent.click(thumb!);
  expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  expect(control.checkVisibility()).toBe(true);
  const escaped = vi.fn();
  el.addEventListener("keydown", escaped);
  await userEvent.keyboard("{Escape}");
  expect(escaped).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(thumb);
});

it("previews a changed draft colour immediately, with a photo taking precedence", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { color: "#256bb1" },
  );
  const thumb = el.shadowRoot?.querySelector(".thumb");
  expect(thumb).not.toBeNull();
  expect(thumb).not.toBeUndefined();
  expect(getComputedStyle(thumb!).backgroundColor).toBe("rgb(37, 107, 177)");
  el.color = "#25b125";
  await el.updateComplete;
  expect(getComputedStyle(thumb!).backgroundColor).toBe("rgb(37, 177, 37)");
  el.image = mediaTestReference("dish.png");
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(thumb!.querySelector("img")!.getAttribute("src")).toBe(
      `/media/renditions/v1/${mediaTestReference("dish.png")}/square/7500-2500-200.webp`,
    ),
  );
});

it("a disabled thumbnail cannot open the panel", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { disabled: true },
  );
  const thumb = el.shadowRoot?.querySelector<HTMLButtonElement>(".thumb");
  expect(thumb).not.toBeNull();
  expect(thumb).not.toBeUndefined();
  thumb!.click();
  expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
});

it("reveals invalid controls once the thumbnail is enabled", async () => {
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { invalid: true, disabled: true },
  );
  const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  expect(panel.matches(":popover-open")).toBe(false);
  el.disabled = false;
  await el.updateComplete;
  expect(panel.matches(":popover-open")).toBe(true);
});

const mediaReplacements = useMediaPresentations();

it("an inherited variant follows its parent's replacement while its own picture stays independent", async () => {
  const parent = mediaTestReference("parent.png");
  const own = mediaTestReference("variant.webp");
  const replacement = mediaTestReference("replacement.webp");
  const inherited = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { inheritedImage: parent },
  );
  const explicit = await mountWidget<HTMLElementTagNameMap["dashboard-product-appearance"]>(
    "dashboard-product-appearance",
    { image: own, inheritedImage: parent },
  );
  const inheritedImg = inherited.el.shadowRoot!.querySelector("img")!;
  const ownImg = explicit.el.shadowRoot!.querySelector("img")!;
  await vi.waitFor(() =>
    expect(inheritedImg.getAttribute("src")).toBe(
      `/media/renditions/v1/${parent}/square/7500-2500-200.webp`,
    ),
  );
  await vi.waitFor(() =>
    expect(ownImg.getAttribute("src")).toBe(
      `/media/renditions/v1/${own}/square/7500-2500-200.webp`,
    ),
  );
  mediaReplacements.set(parent, replacement);
  invalidateMediaImages();
  await vi.waitFor(() =>
    expect(inheritedImg.getAttribute("src")).toBe(
      `/media/renditions/v1/${replacement}/square/7500-2500-200.webp`,
    ),
  );
  expect(ownImg.getAttribute("src")).toBe(`/media/renditions/v1/${own}/square/7500-2500-200.webp`);
  expect(inherited.el.shadowRoot!.querySelector(".thumb")!.classList.contains("inherited")).toBe(
    true,
  );
  expect(explicit.el.shadowRoot!.querySelector(".thumb")!.classList.contains("inherited")).toBe(
    false,
  );
});
