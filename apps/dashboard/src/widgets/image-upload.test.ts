import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ImageUpload, type ImageUploader } from "./image-upload.js";
import { focusFirstInvalid, setContentLanguages } from "@waitron/ui";
import { setLocale, t } from "../i18n/t.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));
function stubApi(): ImageUploader {
  return { imageLibraryRequest: vi.fn().mockResolvedValue({}) };
}
async function open(el: ImageUpload): Promise<HTMLElement> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
  await el.updateComplete;
  return el.shadowRoot!.querySelector("media-image-picker")!;
}
function select(picker: HTMLElement, filename = "abc123.png"): void {
  picker.dispatchEvent(
    new CustomEvent("select-image", {
      detail: { filename, names: { es: "Pan", en: "Bread" } },
      bubbles: true,
      composed: true,
    }),
  );
}

describe("image-upload", () => {
  it("uses the default-language name as the preview's alt text when the interface language is disabled for content", async () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    setLocale("en-GB");
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    select(await open(el));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.alt).toBe("Pan");
  });
  it("opens the shared library and emits the stored reference on selection", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    const picker = await open(el);
    expect((picker as HTMLElement & { request: unknown }).request).toBe(api.imageLibraryRequest);
    select(picker);
    expect(changed.mock.calls[0]![0].detail).toEqual({ image: "abc123.png" });
    expect(changed.mock.calls[0]![0].bubbles).toBe(true);
    expect(changed.mock.calls[0]![0].composed).toBe(true);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });
  it("renders the selected image preview from /media with its name in the viewer's language as alt text", async () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
    setLocale("en-GB");
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    select(await open(el));
    await el.updateComplete;
    const img = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!;
    expect(img.getAttribute("src")).toBe("/media/abc123.png");
    expect(img.alt).toBe("Bread");
  });
  it("shows a pre-set preview without requesting the library", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api,
      image: "seed.webp",
    });
    expect(
      el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.getAttribute("src"),
    ).toBe("/media/seed.webp");
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.alt).toBeTruthy();
    expect(api.imageLibraryRequest).not.toHaveBeenCalled();
  });
  it("removes a product image without deleting the library asset", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api,
      image: "seed.webp",
    });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-image]")!.click();
    await el.updateComplete;
    expect(changed.mock.calls[0]![0].detail).toEqual({ image: null });
    expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
    expect(api.imageLibraryRequest).not.toHaveBeenCalled();
  });
  it("announces pending selection and cancellation without changing an existing image", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: "seed.webp",
    });
    const pending = vi.fn();
    const changed = vi.fn();
    el.addEventListener("image-picker-state", pending);
    el.addEventListener("image-changed", changed);
    await open(el);
    expect(pending.mock.calls[0]![0].detail).toEqual({ open: true });
    el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(pending.mock.calls[1]![0].detail).toEqual({ open: false });
    expect(changed).not.toHaveBeenCalled();
    expect(el.image).toBe("seed.webp");
  });
  it("closes the library from its Cancel button without changing the image", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: "seed.webp",
    });
    const pending = vi.fn();
    const changed = vi.fn();
    el.addEventListener("image-picker-state", pending);
    el.addEventListener("image-changed", changed);
    await open(el);
    el.shadowRoot!.querySelector<HTMLElement>('wt-form-actions wt-button[slot="cancel"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    expect(pending.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      { open: true },
      { open: false },
    ]);
    expect(changed).not.toHaveBeenCalled();
    expect(el.image).toBe("seed.webp");
  });
  // The picker sits inside a host form whose own keydown handling (Enter submits, Escape closes)
  // must not act on keys typed into the library.
  it("keeps keys pressed inside the library from reaching the host form", async () => {
    const { el, host } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
    });
    const keys = vi.fn();
    host.addEventListener("keydown", keys);
    const picker = await open(el);
    picker.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(keys).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector("[data-test=choose-image]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(keys).toHaveBeenCalledOnce();
  });
  it("shows the main product's photo as a hint while a variant has none of its own", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      inheritedImage: "parent.png",
    });
    const hint = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=inherited-preview]")!;
    expect(hint.getAttribute("src")).toBe("/media/parent.png");
    expect(hint.alt).toBe(t("editor.inherited_image_alt"));
    expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")!.textContent!.trim()).toBe(
      t("editor.inherited_image"),
    );
    // The hint is not the variant's own photo, so there is nothing to remove.
    expect(el.shadowRoot!.querySelector("[data-test=remove-image]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
  });

  it("drops the hint once the variant has a photo of its own", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: "own.png",
      inheritedImage: "parent.png",
    });
    expect(el.shadowRoot!.querySelector("[data-test=inherited-preview]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=preview]")!.getAttribute("src")).toBe(
      "/media/own.png",
    );
  });

  it("marks Choose image invalid in the danger colour, where focusFirstInvalid finds it", async () => {
    const { el, host } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      invalid: true,
    });
    const choose = el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!;
    await (choose as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const danger = document.createElement("div");
    danger.style.borderTop = "1px solid var(--wt-color-danger)";
    host.appendChild(danger);

    expect(choose.getAttribute("aria-invalid")).toBe("true");
    expect(choose.shadowRoot!.querySelector("button")!.getAttribute("aria-invalid")).toBe("true");
    expect(getComputedStyle(choose.shadowRoot!.querySelector("button")!).borderTopColor).toBe(
      getComputedStyle(danger).borderTopColor,
    );
    expect(await focusFirstInvalid(el.shadowRoot!)).toBe(choose);
    expect(el.shadowRoot!.activeElement).toBe(choose);
  });

  it("leaves Choose image unmarked while valid", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    const choose = el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!;
    await (choose as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    expect(choose.hasAttribute("aria-invalid")).toBe(false);
    expect(choose.shadowRoot!.querySelector("button")!.hasAttribute("aria-invalid")).toBe(false);
    expect(await focusFirstInvalid(el.shadowRoot!)).toBeNull();
  });
});
