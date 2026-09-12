import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ImageUpload, type ImageUploader } from "./image-upload.js";
import { setContentLanguages } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";

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
      detail: { filename, altText: { es: "Pan recién hecho" } },
      bubbles: true,
      composed: true,
    }),
  );
}

describe("image-upload", () => {
  it("uses default-language alt text when the interface language is disabled for content", async () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    setLocale("en-GB");
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    const picker = await open(el);
    picker.dispatchEvent(
      new CustomEvent("select-image", {
        detail: {
          filename: "bread.png",
          altText: { es: "Pan recién hecho", en: "English description" },
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.alt).toBe(
      "Pan recién hecho",
    );
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
  it("renders the selected image preview from /media with its translated alt text", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    select(await open(el));
    await el.updateComplete;
    const img = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!;
    expect(img.getAttribute("src")).toBe("/media/abc123.png");
    expect(img.alt).toBe("Pan recién hecho");
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
});
