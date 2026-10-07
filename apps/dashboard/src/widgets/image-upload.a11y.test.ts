import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { page, userEvent } from "vitest/browser";
import "./image-upload.js";
// The app registers `media-image-picker` through the module registry, as dashboard-app.ts does.
import "@waitron/dashboard-modules";
import type { ImageUpload } from "./image-upload.js";
import type { DashboardApi } from "../api/client.js";

function stubApi(): DashboardApi {
  return {
    imageLibraryRequest: vi.fn().mockResolvedValue({ image: "abc.png" }),
  } as unknown as DashboardApi;
}

function stubLibraryApi(): DashboardApi {
  const image = {
    id: "bread",
    filename: "bread.png",
    names: { es: "Pan", en: "Bread" },
    createdAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-12T10:00:00Z",
    usageCount: 1,
  };
  return {
    imageLibraryRequest: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
  } as unknown as DashboardApi;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("image-upload a11y (%s theme)", (theme) => {
  it("an invalid image choice keeps visible, accessible hover feedback", async () => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), invalid: true },
      theme,
    );
    const inner = el
      .shadowRoot!.querySelector("[data-test=choose-image]")!
      .shadowRoot!.querySelector("button")!;
    const shadow = getComputedStyle(inner).boxShadow;
    await userEvent.hover(inner);
    expect(inner.matches(":hover")).toBe(true);
    expect(getComputedStyle(inner).opacity).toBe("1");
    expect(getComputedStyle(inner).boxShadow).not.toBe(shadow);
    await expectNoA11yViolations(host);
    await page.screenshot({ element: host, path: `__screenshots__/look/a319-image-${theme}.png` });
  });

  it("renders accessibly with Remove disabled beside an inherited photo", async () => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), inheritedImage: "parent.png" },
      theme,
    );
    const remove = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=remove-image]",
    )!;
    // Without this the scan could pass on a widget that drew no disabled Remove.
    expect(remove.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=remove-image-hint]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a preview", async () => {
    const { host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), image: "abc.png" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("renders accessibly while marked invalid", async () => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), invalid: true },
      theme,
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=choose-image]")!.getAttribute("aria-invalid"),
    ).toBe("true");
    await expectNoA11yViolations(host);
  });

  it.each([
    ["in full", {}],
    ["as a thumbnail", { thumbnail: true }],
  ] as const)("renders accessibly while disabled %s", async (_, props) => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), image: "abc.png", disabled: true, ...props },
      theme,
    );
    // Without this the scan could pass on a control that drew nothing disabled.
    expect(el.shadowRoot!.querySelector("[data-test=choose-image]")!.hasAttribute("disabled")).toBe(
      true,
    );
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the inherited photo", async () => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), inheritedImage: "parent.png" },
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-test=inherited-preview]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")).toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each([
    ["with its own photo", { image: "abc.png" }],
    ["with no photo", {}],
    ["with the inherited photo", { inheritedImage: "parent.png" }],
    ["marked invalid", { invalid: true }],
  ] as const)("renders accessibly as a thumbnail %s", async (_, props) => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), thumbnail: true, ...props },
      theme,
    );
    // Without this the scan could pass on a thumbnail that drew no button.
    expect(el.shadowRoot!.querySelector("button[data-test=choose-image]")).not.toBeNull();
    if ("inheritedImage" in props)
      expect(el.shadowRoot!.querySelector("[data-test=inherited-caption]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly as a thumbnail with its library open", async () => {
    const { el, host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubLibraryApi(), thumbnail: true, image: "abc.png" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remove-image]")).not.toBeNull();
    // Without these the scan could pass on a closed window, or one whose library never rendered.
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
      ).toBe(true),
    );
    expect(customElements.get("media-image-picker")).toBeDefined();
    const picker = el.shadowRoot!.querySelector("media-image-picker")!;
    await vi.waitFor(() =>
      expect(
        picker.shadowRoot
          ?.querySelector("dashboard-image-library")
          ?.shadowRoot?.querySelector("[data-image=bread]"),
      ).toBeTruthy(),
    );
    await expectNoA11yViolations(host);
  });
});
