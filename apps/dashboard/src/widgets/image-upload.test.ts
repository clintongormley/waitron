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
  it.each(["en-GB", "es-ES"] as const)(
    "shows the inherited photo itself without a caption in %s",
    async (locale) => {
      setLocale(locale);
      const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
        api: stubApi(),
        inheritedImage: "parent.png",
      });
      const inherited = el.shadowRoot!.querySelector<HTMLImageElement>(
        "[data-test=inherited-preview]",
      )!;
      expect(inherited.getAttribute("src")).toBe("/media/parent.png");
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
        inheritedImage: "parent.png",
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
      const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-image-hint]")!;
      expect(hint.textContent!.trim()).toBe(t("image.remove_inherited_hint"));
      expect(hint.textContent!.trim()).toBe(
        locale === "en-GB" ? "Uses the product's image" : "Usa la imagen del producto",
      );
      // Read straight after the button, and drawn nowhere: the inherited photo carries no caption.
      expect(remove.nextElementSibling).toBe(hint);
      expect(hint.getBoundingClientRect().width).toBeLessThanOrEqual(1);
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
    expect(await place({ inheritedImage: "parent.png" })).toEqual(
      await place({ image: "own.png" }),
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
      image: "own.png",
      inheritedImage: "parent.png",
    });
    expect(el.shadowRoot!.querySelector("[data-test=inherited-preview]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=inherited-hint]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=preview]")!.getAttribute("src")).toBe(
      "/media/own.png",
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
      image: "own.png",
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
    expect(el.image).toBe("own.png");
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  });

  it("disables the thumbnail's photo button, which then opens nothing", async () => {
    const { el } = await mountWidget<ImageUpload>("dashboard-image-upload", {
      api: stubApi(),
      thumbnail: true,
      image: "own.png",
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
      image: "own.png",
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
    expect(el.image).toBe("own.png");
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
    const { el, host } = await thumbnail({ image: "own.png" });
    host.style.setProperty("--wt-tap-min", "47px");
    expect(el.shadowRoot!.querySelectorAll("button, wt-button")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=preview]")).toBeNull();
    expect(el.shadowRoot!.textContent!.trim()).toBe("");
    expect(picture(el)!.getAttribute("src")).toBe("/media/own.png");
    const box = button(el).getBoundingClientRect();
    expect([box.width, box.height]).toEqual([47, 47]);
    const img = picture(el)!.getBoundingClientRect();
    expect(img.width).toBeGreaterThan(40);
    expect(img.height).toBeGreaterThan(40);
    expect(getComputedStyle(picture(el)!).objectFit).toBe("cover");
  });

  it.each([
    ["en-GB", "own.png", "Change photo"],
    ["en-GB", null, "Add photo"],
    ["es-ES", "own.png", "Cambiar foto"],
    ["es-ES", null, "Añadir foto"],
  ] as const)("in %s, a photo %s is named %s", async (locale, image, name) => {
    setLocale(locale);
    const { el } = await thumbnail({ image });
    expect(button(el).getAttribute("aria-label")).toBe(name);
    // The name is the button's; the photo inside it adds nothing to it.
    if (picture(el)) expect(picture(el)!.alt).toBe("");
  });

  it("opens the library from the photo, and shows the photo chosen there", async () => {
    const { el } = await thumbnail({ image: "own.png" });
    const changed = vi.fn();
    el.addEventListener("image-changed", changed);
    button(el).click();
    await el.updateComplete;
    select(el.shadowRoot!.querySelector("media-image-picker")!, "new.png");
    await el.updateComplete;
    expect(changed.mock.calls[0]![0].detail).toEqual({ image: "new.png" });
    expect(el.shadowRoot!.querySelector("media-image-picker")).toBeNull();
    expect(picture(el)!.getAttribute("src")).toBe("/media/new.png");
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
      const { el, host } = await thumbnail({ inheritedImage: "parent.png" });
      host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
      expect(picture(el)!.getAttribute("src")).toBe("/media/parent.png");
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
    const { el } = await thumbnail({ image: "own.png", inheritedImage: "parent.png" });
    expect(picture(el)!.getAttribute("src")).toBe("/media/own.png");
    expect(el.shadowRoot!.querySelector("[data-test=inherited-caption]")).toBeNull();
    expect(button(el).hasAttribute("aria-describedby")).toBe(false);
    expect(getComputedStyle(button(el)).borderTopStyle).toBe("solid");
  });

  it("removes the photo from the library window's footer, and closes it", async () => {
    const { el } = await thumbnail({ image: "own.png" });
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
    for (const props of [{}, { inheritedImage: "parent.png" }]) {
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
    const { el, host } = await thumbnail({ inheritedImage: "parent.png" });
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
