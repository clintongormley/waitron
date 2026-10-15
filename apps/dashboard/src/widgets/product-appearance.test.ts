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
  el.image = "dish.png";
  await el.updateComplete;
  expect(thumb!.querySelector("img")!.getAttribute("src")).toBe("/media/dish.png");
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
