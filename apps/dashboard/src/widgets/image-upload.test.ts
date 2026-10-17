import { mediaTestReference, useMediaPresentations } from "@waitron/ui/src/test-helpers.js";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { dpiValue, safeWidthDots } from "@waitron/printing/src/layout.js";
import { LOGO_MAX_HEIGHT_DOTS } from "@waitron/printing/src/dither.js";
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
function select(picker: HTMLElement, filename = mediaTestReference("abc123.png")): void {
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
  it("heads the control with its own label when given one, and with Image otherwise", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    expect(el.shadowRoot!.querySelector("p")!.textContent).toBe(t("image.label"));
    el.label = "Logo";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("p")!.textContent).toBe("Logo");
  });
  it("opens the shared library and emits the stored reference on selection", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    const picker = await open(el);
    expect((picker as HTMLElement & { request: unknown }).request).toBe(api.imageLibraryRequest);
    select(picker);
    expect(changed.mock.calls[0]![0].detail).toEqual({ image: mediaTestReference("abc123.png") });
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
    await vi.waitFor(() =>
      expect(img.getAttribute("src")).toBe(
        `/media/renditions/v1/${mediaTestReference("abc123.png")}/square/7500-2500-200.webp`,
      ),
    );
    expect(img.alt).toBe("Bread");
  });
  it("shows a pre-set preview without requesting the library", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api,
      image: mediaTestReference("seed.webp"),
    });
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.getAttribute("src"),
      ).toBe(`/media/renditions/v1/${mediaTestReference("seed.webp")}/square/7500-2500-200.webp`),
    );
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.alt).toBeTruthy();
    expect(api.imageLibraryRequest).not.toHaveBeenCalled();
  });
  it("removes a product image without deleting the library asset", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api,
      image: mediaTestReference("seed.webp"),
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
      image: mediaTestReference("seed.webp"),
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
    expect(el.image).toBe(mediaTestReference("seed.webp"));
  });
  it("closes the library from its Cancel button without changing the image", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: mediaTestReference("seed.webp"),
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
    expect(el.image).toBe(mediaTestReference("seed.webp"));
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
  it.each(["en-GB", "es-ES"] as const)(
    "shows the inherited photo itself without a caption in %s",
    async (locale) => {
      setLocale(locale);
      const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
        api: stubApi(),
        inheritedImage: mediaTestReference("parent.png"),
      });
      const inherited = el.shadowRoot!.querySelector<HTMLImageElement>(
        "[data-test=inherited-preview]",
      )!;
      await vi.waitFor(() =>
        expect(inherited.getAttribute("src")).toBe(
          `/media/renditions/v1/${mediaTestReference("parent.png")}/square/7500-2500-200.webp`,
        ),
      );
      expect(inherited.alt).toBe(t("editor.inherited_image_alt"));
      expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "shows Remove disabled beside the inherited photo, with its reason for a screen reader, in %s",
    async (locale) => {
      setLocale(locale);
      const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
        api: stubApi(),
        inheritedImage: mediaTestReference("parent.png"),
      });
      const changed = vi.fn();
      el.addEventListener("image-changed", changed);
      const remove = el.shadowRoot!.querySelector<
        HTMLElement & { disabled: boolean; updateComplete: Promise<unknown> }
      >("[data-test=remove-image]")!;
      await remove.updateComplete;
      expect(remove.textContent!.trim()).toBe(t("image.remove"));
      expect(remove.disabled).toBe(true);
      expect(remove.shadowRoot!.querySelector("button")!.disabled).toBe(true);
      await expect
        .element(page.elementLocator(remove.shadowRoot!.querySelector("button")!))
        .toHaveAccessibleDescription(
          locale === "en-GB"
            ? "Uses the main product's photo"
            : "Usa la foto del producto principal",
        );
      expect(remove.hasAttribute("aria-description")).toBe(false);
      expect(el.shadowRoot!.querySelector("[data-test=remove-image-hint]")).toBeNull();
      remove.click();
      remove.shadowRoot!.querySelector("button")!.click();
      await el.updateComplete;
      expect(changed).not.toHaveBeenCalled();
      expect(el.image).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=inherited-preview]")).not.toBeNull();
    },
  );

  it("lays Remove for an inherited photo out where Remove sits for a photo of the variant's own", async () => {
    const place = async (props: Partial<ImageUpload>) => {
      const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
        api: stubApi(),
        ...props,
      });
      const box = el.shadowRoot!.querySelector("[data-test=remove-image]")!.getBoundingClientRect();
      cleanupWidgets();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    expect(await place({ inheritedImage: mediaTestReference("parent.png") })).toEqual(
      await place({ image: mediaTestReference("own.png") }),
    );
  });

  it("offers no Remove and no reason when there is no photo at all", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", { api: stubApi() });
    expect(el.shadowRoot!.querySelector("[data-test=remove-image]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=remove-image-hint]")).toBeNull();
  });

  it("drops the inherited photo once the variant has one of its own", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: mediaTestReference("own.png"),
      inheritedImage: mediaTestReference("parent.png"),
    });
    expect(el.shadowRoot!.querySelector("[data-test=inherited-preview]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")).toBeNull();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=preview]")!.getAttribute("src")).toBe(
        `/media/renditions/v1/${mediaTestReference("own.png")}/square/7500-2500-200.webp`,
      ),
    );
    const remove = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=remove-image]",
    )!;
    expect(remove.disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("[data-test=remove-image-hint]")).toBeNull();
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

describe("image-upload while disabled", () => {
  const inner = (el: ImageUpload, test: string) =>
    el.shadowRoot!.querySelector(`[data-test=${test}]`)!.shadowRoot!.querySelector("button")!;

  it("disables Choose image and Remove, and a click on either changes nothing", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: mediaTestReference("own.png"),
      disabled: true,
    });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    expect(inner(el, "choose-image").disabled).toBe(true);
    expect(inner(el, "remove-image").disabled).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-image]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
    await el.updateComplete;
    expect(changed).not.toHaveBeenCalled();
    expect(el.image).toBe(mediaTestReference("own.png"));
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });

  it("disables the thumbnail's photo button, which then opens nothing", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      thumbnail: true,
      image: mediaTestReference("own.png"),
      disabled: true,
    });
    const photo = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "button[data-test=choose-image]",
    )!;
    expect(photo.disabled).toBe(true);
    expect(getComputedStyle(photo).cursor).toBe("not-allowed");
    photo.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });

  it("closes a library left open, saying so, and takes nothing chosen there", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: mediaTestReference("own.png"),
    });
    const states = vi.fn();
    const changed = vi.fn();
    el.addEventListener("image-picker-state", (event) => states((event as CustomEvent).detail));
    el.addEventListener("image-changed", changed);
    const picker = await open(el);
    el.disabled = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    expect(states.mock.calls.map(([detail]) => detail)).toEqual([{ open: true }, { open: false }]);
    select(picker);
    expect(changed).not.toHaveBeenCalled();
    expect(el.image).toBe(mediaTestReference("own.png"));
    el.disabled = false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });
});

describe("image-upload as a thumbnail", () => {
  async function thumbnail(props: Partial<ImageUpload> = {}) {
    return mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      thumbnail: true,
      ...props,
    });
  }
  const button = (el: ImageUpload) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>("button[data-test=choose-image]")!;
  const picture = (el: ImageUpload) => button(el).querySelector<HTMLImageElement>("img");

  it("is one button showing the product's own photo, at the size of the product list's thumbnail", async () => {
    const { el, host } = await thumbnail({ image: mediaTestReference("own.png") });
    host.style.setProperty("--wt-tap-min", "47px");
    expect(el.shadowRoot!.querySelectorAll("button, wt-button")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
    expect(el.shadowRoot!.textContent!.trim()).toBe("");
    await vi.waitFor(() =>
      expect(picture(el)!.getAttribute("src")).toBe(
        `/media/renditions/v1/${mediaTestReference("own.png")}/square/7500-2500-200.webp`,
      ),
    );
    const box = button(el).getBoundingClientRect();
    expect([box.width, box.height]).toEqual([47, 47]);
    const img = picture(el)!.getBoundingClientRect();
    expect(img.width).toBeGreaterThan(40);
    expect(img.height).toBeGreaterThan(40);
    expect(getComputedStyle(picture(el)!).objectFit).toBe("cover");
  });

  it.each([
    ["en-GB", mediaTestReference("own.png"), "Change photo"],
    ["en-GB", null, "Add photo"],
    ["es-ES", mediaTestReference("own.png"), "Cambiar foto"],
    ["es-ES", null, "Añadir foto"],
  ] as const)("in %s, a photo %s is named %s", async (locale, image, name) => {
    setLocale(locale);
    const { el } = await thumbnail({ image });
    expect(button(el).getAttribute("aria-label")).toBe(name);
    // The name is the button's; the photo inside it adds nothing to it.
    if (picture(el)) expect(picture(el)!.alt).toBe("");
  });

  it("opens the library from the photo, and shows the photo chosen there", async () => {
    const { el } = await thumbnail({ image: mediaTestReference("own.png") });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    button(el).click();
    await el.updateComplete;
    select(el.shadowRoot!.querySelector("media-image-picker")!, mediaTestReference("new.png"));
    await el.updateComplete;
    expect(changed.mock.calls[0]![0].detail).toEqual({ image: mediaTestReference("new.png") });
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    await vi.waitFor(() =>
      expect(picture(el)!.getAttribute("src")).toBe(
        `/media/renditions/v1/${mediaTestReference("new.png")}/square/7500-2500-200.webp`,
      ),
    );
  });

  it("draws an empty placeholder like the product list's when there is no photo, and it opens the library too", async () => {
    const { el, host } = await thumbnail();
    host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
    host.style.setProperty("--wt-radius-md", "7px");
    expect(picture(el)).toBeNull();
    const style = getComputedStyle(button(el));
    expect([style.borderTopStyle, style.borderTopColor]).toEqual(["solid", "rgb(1, 2, 3)"]);
    expect(style.backgroundColor).toBe("rgb(4, 5, 6)");
    expect(style.borderTopLeftRadius).toBe("7px");
    const pending = vi.fn();
    el.addEventListener("image-picker-state", pending);
    button(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
    expect(pending.mock.calls[0]![0].detail).toEqual({ open: true });
  });

  it("is a tap target with a visible focus ring", async () => {
    const { el } = await thumbnail();
    const box = button(el).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    button(el).focus();
    expect(el.shadowRoot!.activeElement).toBe(button(el));
    expect(getComputedStyle(button(el)).outlineStyle).not.toBe("none");
  });

  it.each(["en-GB", "es-ES"] as const)(
    "marks a variant's inherited photo with a dashed border, and names it the main product's for a screen reader only, in %s",
    async (locale) => {
      setLocale(locale);
      const { el, host } = await thumbnail({ inheritedImage: mediaTestReference("parent.png") });
      host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
      await vi.waitFor(() =>
        expect(picture(el)!.getAttribute("src")).toBe(
          `/media/renditions/v1/${mediaTestReference("parent.png")}/square/7500-2500-200.webp`,
        ),
      );
      expect(button(el).getAttribute("aria-label")).toBe(t("image.add_photo"));
      const style = getComputedStyle(button(el));
      expect([style.borderTopStyle, style.borderTopColor]).toEqual(["dashed", "rgb(7, 8, 9)"]);
      const caption = el.shadowRoot!.querySelector<HTMLElement>("[data-test=inherited-caption]")!;
      expect(caption.textContent!.trim()).toBe(t("editor.inherited_image_alt"));
      expect(button(el).contains(caption)).toBe(false);
      expect(button(el).getAttribute("aria-describedby")).toBe(caption.id);
      expect(el.shadowRoot!.getElementById(caption.id)).toBe(caption);
      const hidden = getComputedStyle(caption);
      expect([hidden.position, hidden.width, hidden.height, hidden.overflow, hidden.clip]).toEqual([
        "absolute",
        "1px",
        "1px",
        "hidden",
        "rect(0px, 0px, 0px, 0px)",
      ]);
    },
  );

  it("drops the inherited marking once the variant has a photo of its own", async () => {
    const { el } = await thumbnail({
      image: mediaTestReference("own.png"),
      inheritedImage: mediaTestReference("parent.png"),
    });
    await vi.waitFor(() =>
      expect(picture(el)!.getAttribute("src")).toBe(
        `/media/renditions/v1/${mediaTestReference("own.png")}/square/7500-2500-200.webp`,
      ),
    );
    expect(el.shadowRoot!.querySelector("[data-test=inherited-caption]")).toBeNull();
    expect(button(el).hasAttribute("aria-describedby")).toBe(false);
    expect(getComputedStyle(button(el)).borderTopStyle).toBe("solid");
  });

  it("removes the photo from the library window's footer, and closes it", async () => {
    const { el } = await thumbnail({ image: mediaTestReference("own.png") });
    const changed = vi.fn();
    const pending = vi.fn();
    el.addEventListener("image-changed", changed);
    el.addEventListener("image-picker-state", pending);
    await open(el);
    const remove = el.shadowRoot!.querySelector<HTMLElement>(
      'wt-modal wt-form-actions wt-button[data-test="remove-image"]',
    )!;
    expect(remove.textContent!.trim()).toBe(t("image.remove"));
    remove.click();
    await el.updateComplete;
    expect(changed.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      { image: null },
    ]);
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    expect(pending.mock.calls.at(-1)![0].detail).toEqual({ open: false });
    expect(picture(el)).toBeNull();
    expect(button(el).getAttribute("aria-label")).toBe(t("image.add_photo"));
  });

  it("offers no Remove in the library window when there is no photo of its own", async () => {
    for (const props of [{}, { inheritedImage: mediaTestReference("parent.png") }]) {
      const { el } = await thumbnail(props);
      expect(await open(el)).not.toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=remove-image]")).toBeNull();
      cleanupWidgets();
    }
  });

  it("marks the photo invalid in the danger colour, where focusFirstInvalid finds it", async () => {
    const { el, host } = await thumbnail({ invalid: true });
    host.style.setProperty("--wt-color-danger", "rgb(200, 1, 2)");
    expect(button(el).getAttribute("aria-invalid")).toBe("true");
    expect(getComputedStyle(button(el)).borderTopColor).toBe("rgb(200, 1, 2)");
    expect(await focusFirstInvalid(el.shadowRoot!)).toBe(button(el));
    el.invalid = false;
    await el.updateComplete;
    expect(button(el).hasAttribute("aria-invalid")).toBe(false);
  });

  it("lays what it holds beside the photo, taking the rest of the row, with nothing under them for an inherited photo", async () => {
    const { el, host } = await thumbnail({ inheritedImage: mediaTestReference("parent.png") });
    host.style.width = "390px";
    const field = document.createElement("div");
    field.style.height = "56px";
    el.appendChild(field);
    await el.updateComplete;
    const photo = button(el).getBoundingClientRect();
    const beside = field.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    expect(beside.left).toBeGreaterThan(photo.right);
    expect(beside.right).toBe(row.right);
    // Centred on each other, so the photo lines up with the field's box.
    expect(Math.abs(beside.top + beside.height / 2 - (photo.top + photo.height / 2))).toBeLessThan(
      1,
    );
    expect(row.height).toBe(Math.max(photo.height, beside.height));
  });
});

describe("image-upload as a receipt logo", () => {
  async function logo(props: Partial<ImageUpload> = {}) {
    return mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      logo: true,
      ...props,
    });
  }
  const choose = (el: ImageUpload) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=choose-image]")!;
  const remove = (el: ImageUpload) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=remove-image]");
  const picture = (el: ImageUpload) => choose(el).querySelector<HTMLImageElement>("img")!;
  function png(width: number, height: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillRect(0, 0, width, height);
    return canvas.toDataURL("image/png");
  }
  const cssPx = (dots: number) => (dots / dpiValue("203dpi")) * 96;

  it.each([
    ["en-GB", "Add a logo"],
    ["es-ES", "Añadir un logotipo"],
  ] as const)(
    "without a logo, in %s, is one dashed button named %s that opens the library",
    async (locale, name) => {
      setLocale(locale);
      const { el } = await logo();
      expect(el.shadowRoot!.querySelectorAll("button, wt-button")).toHaveLength(1);
      expect(remove(el)).toBeNull();
      expect(choose(el).textContent!.replace(/\s+/g, " ").trim()).toBe(`+ ${name}`);
      await expect.element(page.elementLocator(choose(el))).toHaveAccessibleName(name);
      expect(getComputedStyle(choose(el)).borderTopStyle).toBe("dashed");
      await userEvent.click(page.elementLocator(choose(el)));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
    },
  );

  it.each([
    ["en-GB", "Change logo", "Remove", "Remove logo"],
    ["es-ES", "Cambiar el logotipo", "Quitar", "Quitar el logotipo"],
  ] as const)(
    "with a logo, in %s, the picture is named %s and Remove sits beside it",
    async (locale, change, text, removeName) => {
      setLocale(locale);
      const before = { width: innerWidth, height: innerHeight };
      await page.viewport(1280, 900);
      try {
        const api = stubApi();
        const { el } = await logo({ api, image: mediaTestReference("own.png") });
        await vi.waitFor(() =>
          expect(picture(el).getAttribute("src")).toBe(
            `/media/renditions/v1/${mediaTestReference("own.png")}/display/7500-2500-200.webp`,
          ),
        );
        expect(picture(el).alt).toBe("");
        await expect.element(page.elementLocator(choose(el))).toHaveAccessibleName(change);
        const button = remove(el)!;
        expect(button.textContent!.trim()).toBe(text);
        expect(button.variant).toBe("ghost");
        await expect
          .element(page.elementLocator(button.shadowRoot!.querySelector("button")!))
          .toHaveAccessibleName(removeName);
        const photo = choose(el).getBoundingClientRect();
        const beside = button.getBoundingClientRect();
        expect(beside.left).toBeGreaterThan(photo.right);
        expect(beside.top).toBeLessThan(photo.bottom);
        expect(beside.bottom).toBeGreaterThan(photo.top);
        await userEvent.click(page.elementLocator(choose(el)));
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
        expect(el.shadowRoot!.querySelector("wt-modal [data-test=remove-image]")).toBeNull();
        expect(api.imageLibraryRequest).not.toHaveBeenCalled();
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  it("removes the logo from beside the picture, asking nothing of the image library, and moves focus to the empty box", async () => {
    const api = stubApi();
    const { el } = await logo({ api, image: mediaTestReference("own.png") });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    await userEvent.click(page.elementLocator(remove(el)!));
    await el.updateComplete;
    expect(changed.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      { image: null },
    ]);
    expect(api.imageLibraryRequest).not.toHaveBeenCalled();
    expect(remove(el)).toBeNull();
    expect(choose(el).querySelector("img")).toBeNull();
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(choose(el));
  });

  it.each([
    ["choosing an image", "select"],
    ["cancelling the library", "cancel"],
  ] as const)("hands focus back to the logo after %s", async (_, how) => {
    for (const image of [mediaTestReference("own.png"), null]) {
      const { el } = await logo({ image });
      await userEvent.click(page.elementLocator(choose(el)));
      await el.updateComplete;
      const picker = el.shadowRoot!.querySelector<HTMLElement>("media-image-picker")!;
      if (how === "select") select(picker, mediaTestReference("new.png"));
      else
        await userEvent.click(
          page.elementLocator(
            el.shadowRoot!.querySelector('wt-form-actions wt-button[slot="cancel"]')!,
          ),
        );
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
      await expect.poll(() => el.shadowRoot!.activeElement).toBe(choose(el));
      cleanupWidgets();
    }
  });

  it.each([
    ["small", 100, 30],
    ["large", 2000, 600],
  ] as const)(
    "draws a %s logo in the box it prints in, enlarged or shrunk as printing does",
    async (_, width, height) => {
      const { el } = await logo({ image: mediaTestReference("own.png") });
      const img = picture(el);
      const loaded = new Promise((resolve) =>
        img.addEventListener("load", resolve, { once: true }),
      );
      await vi.waitFor(() =>
        expect(img.getAttribute("src")).toBe(
          `/media/renditions/v1/${mediaTestReference("own.png")}/display/7500-2500-200.webp`,
        ),
      );
      img.src = png(width, height);
      await loaded;
      const box = img.getBoundingClientRect();
      expect(Math.abs(box.width - cssPx(safeWidthDots("80mm")))).toBeLessThan(1);
      expect(Math.abs(box.height - cssPx(LOGO_MAX_HEIGHT_DOTS))).toBeLessThan(1);
      expect(getComputedStyle(img).objectFit).toBe("contain");
      const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
      // 504 × 151 dots, what both sizes print at (measured with the server's resize, 2026-10-16).
      expect(Math.abs(img.naturalWidth * scale - cssPx(504))).toBeLessThan(1);
      expect(Math.abs(img.naturalHeight * scale - cssPx(151))).toBeLessThan(1);
    },
  );

  it.each([
    ["the picture", mediaTestReference("own.png")],
    ["the Add a logo box", null],
  ] as const)(
    "marks %s invalid in the danger colour, where focusFirstInvalid finds it",
    async (_, image) => {
      const { el, host } = await logo({ image, invalid: true });
      host.style.setProperty("--wt-color-danger", "rgb(200, 1, 2)");
      expect(choose(el).getAttribute("aria-invalid")).toBe("true");
      expect(getComputedStyle(choose(el)).borderTopColor).toBe("rgb(200, 1, 2)");
      expect(await focusFirstInvalid(el.shadowRoot!)).toBe(choose(el));
      el.invalid = false;
      await el.updateComplete;
      expect(choose(el).hasAttribute("aria-invalid")).toBe(false);
    },
  );

  it.each([
    ["the picture", mediaTestReference("own.png")],
    ["the Add a logo box", null],
  ] as const)("is a tap target with a visible focus ring, as %s", async (_, image) => {
    const { el } = await logo({ image });
    const box = choose(el).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // By keyboard: run after this block's earlier cases, `.focus()` drew no ring.
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(choose(el));
    expect(getComputedStyle(choose(el)).outlineStyle).not.toBe("none");
  });

  it("draws the logo on white paper in the dark theme", async () => {
    const { el } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), logo: true, image: mediaTestReference("own.png") },
      "dark",
    );
    expect(getComputedStyle(choose(el)).backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("disables both buttons, and closes a library left open", async () => {
    const { el } = await logo({ image: mediaTestReference("own.png") });
    await userEvent.click(page.elementLocator(choose(el)));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
    el.disabled = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    expect(choose(el).disabled).toBe(true);
    expect(remove(el)!.disabled).toBe(true);
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    remove(el)!.click();
    choose(el).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(changed).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });
});

it("A651 chooses the full-size photo through the real nested picker and closes the outer window", async () => {
  await import("@waitron/dashboard-modules");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  setLocale("en-GB");
  const image = {
    id: "bread",
    filename: mediaTestReference("bread.png"),
    names: { en: "Bread", es: "Pan" },
    createdAt: "2026-10-17T00:00:00Z",
    updatedAt: "2026-10-17T00:00:00Z",
    usageCount: 0,
  };
  const request = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path.includes("?") ? { images: [image], total: 1 } : { image, uses: [] },
    );
  const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
    api: { imageLibraryRequest: request },
  });
  const changed = vi.fn();
  el.addEventListener("image-changed", changed);
  const picker = await open(el);
  await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library")!;
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-test=preview-bread]")).not.toBeNull(),
  );
  await userEvent.click(library.shadowRoot!.querySelector("[data-test=preview-bread]")!);
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-test=select-preview]")).not.toBeNull(),
  );
  await userEvent.click(library.shadowRoot!.querySelector("[data-test=select-preview]")!);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull());
  expect(el.image).toBe(mediaTestReference("bread.png"));
  expect(changed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: { image: mediaTestReference("bread.png") } }),
  );
  expect(request.mock.calls.every((call) => call[1] === "GET")).toBe(true);
});

const mediaReplacements = useMediaPresentations();

it.each([
  { thumbnail: false, logo: false, shape: "square" },
  { thumbnail: true, logo: false, shape: "square" },
  { thumbnail: false, logo: true, shape: "display" },
])(
  "refreshes a mounted $shape image without changing its stored selection",
  async ({ thumbnail, logo, shape }) => {
    const reference = mediaTestReference("parent.png");
    const replacement = mediaTestReference("replacement.webp");
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      image: reference,
      thumbnail,
      logo,
    });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    const img = el.shadowRoot!.querySelector("img")!;
    await vi.waitFor(() =>
      expect(img.getAttribute("src")).toBe(
        `/media/renditions/v1/${reference}/${shape}/7500-2500-200.webp`,
      ),
    );
    mediaReplacements.set(reference, replacement);
    invalidateMediaImages();
    await vi.waitFor(() =>
      expect(img.getAttribute("src")).toBe(
        `/media/renditions/v1/${replacement}/${shape}/7500-2500-200.webp`,
      ),
    );
    expect(el.image).toBe(reference);
    expect(changed).not.toHaveBeenCalled();
  },
);
