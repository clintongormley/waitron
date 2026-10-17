import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale, LiveData } from "@waitron/dashboard-kit";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";

const image: LibraryImage = {
  id: "photo",
  filename: "photo.png",
  sourceFilename: "photo.png",
  originalFilename: "patatas-bravas.jpg",
  names: { en: "Bravas", es: "Patatas" },
  framing: { x: 2500, y: 7500, zoom: 200 },
  revision: 3,
  usageCount: 2,
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
};
let el: ImageLibrary;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  el?.remove();
  setLocale(locale);
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  vi.restoreAllMocks();
});
async function mount(value = image) {
  const api = {
    liveData: new LiveData(),
    listImages: vi.fn().mockResolvedValue({ images: [value], total: 1 }),
    getImage: vi.fn().mockResolvedValue({ image: value, uses: [] }),
    updateImage: vi.fn().mockResolvedValue({ image: { ...value, revision: 4 } }),
    uploadImage: vi.fn(),
  };
  el = document.createElement("dashboard-image-library");
  el.api = api as unknown as ImageApi;
  applyTokens(el);
  document.body.append(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=edit-photo]")).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-photo]")!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return api;
}
function save() {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
}
async function adjust() {
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=adjust-framing]");
  expect(button).not.toBeNull();
  await userEvent.click(page.elementLocator(button!));
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("media-photo-framing-dialog")!;
  await dialog.updateComplete;
  await dialog.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return dialog;
}
async function done(dialog: HTMLElement) {
  await userEvent.click(page.elementLocator(dialog.shadowRoot!.querySelector("[data-test=done]")!));
  await expect.poll(() => el.shadowRoot!.querySelector("media-photo-framing-dialog")).toBeNull();
}
async function replace() {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = "blue";
  ctx.fillRect(400, 0, 400, 400);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((v) => resolve(v!), "image/png"));
  const file = new File([blob], "new-plate.png", { type: "image/png" });
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-file-input"]>(
    "wt-file-input[name=image-file]",
  );
  expect(field).not.toBeNull();
  await field!.updateComplete;
  const input = field!.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  return file;
}

it("Edit photo shows the human filename, with a stored-filename fallback and no write", async () => {
  const api = await mount();
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent).toContain(
    "patatas-bravas.jpg",
  );
  expect(el.shadowRoot!.querySelector("wt-file-input[name=image-file]")).not.toBeNull();
  expect(save().disabled).toBe(true);
  expect(api.updateImage).not.toHaveBeenCalled();
  el.remove();
  await mount({ ...image, originalFilename: null });
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent).toContain(
    "photo.png",
  );
});

it("a passive library snapshot does not replace an open file, names, framing or expected revision", async () => {
  const api = await mount();
  const selected = await replace();
  el.shadowRoot!.querySelector("[name=name-en]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "My draft" } }),
  );
  await el.updateComplete;
  api.listImages.mockResolvedValue({
    images: [{ ...image, names: { en: "Other tab" }, revision: 9 }],
    total: 1,
  });
  api.liveData.invalidate([{ type: "media_images" }]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("article h2")!.textContent).toContain("Other tab"),
  );
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")!.textContent).toBe(
    selected.name,
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!.value,
  ).toBe("My draft");
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(1));
  expect(api.updateImage).toHaveBeenCalledWith(
    "photo",
    {
      names: { en: "My draft", es: "Patatas" },
      framing: { x: 5000, y: 5000, zoom: 100 },
      expectedRevision: 3,
    },
    selected,
  );
});

it("an unreadable replacement remains retryable, and choosing another never renames the photo", async () => {
  const api = await mount();
  const first = await replace();
  api.updateImage.mockRejectedValueOnce({ code: "image.invalid_file" });
  save().click();
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector("wt-file-input[name=image-file]")!.getAttribute("error"),
    ).not.toBe(""),
  );
  expect(save().disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")!.textContent).toBe(first.name);
  const next = await replace();
  expect(
    el.shadowRoot!.querySelector("wt-file-input[name=image-file]")!.getAttribute("error"),
  ).toBe("");
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(2));
  expect(api.updateImage.mock.calls[1]).toEqual([
    "photo",
    {
      names: { en: "Bravas", es: "Patatas" },
      framing: { x: 5000, y: 5000, zoom: 100 },
      expectedRevision: 3,
    },
    next,
  ]);
});

it("unchanged Done stays quiet, Escape discards subdraft, and Reset only stages the outer draft", async () => {
  const api = await mount();
  let dialog = await adjust();
  await done(dialog);
  expect(save().disabled).toBe(true);
  dialog = await adjust();
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => el.shadowRoot!.querySelector("media-photo-framing-dialog")).toBeNull();
  expect(save().disabled).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(
    el.shadowRoot!.querySelector("[data-test=adjust-framing]"),
  );
  dialog = await adjust();
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
  await done(dialog);
  expect(save().disabled).toBe(false);
  expect(save().variant).toBe("primary");
  expect(api.updateImage).not.toHaveBeenCalled();
  save().click();
  await vi.waitFor(() =>
    expect(api.updateImage).toHaveBeenCalledWith("photo", {
      names: { en: "Bravas", es: "Patatas" },
      framing: { x: 5000, y: 5000, zoom: 100 },
      expectedRevision: 3,
    }),
  );
});

it("replacement resets framing, retains every name and submits the accepted frame with one file PATCH", async () => {
  const api = await mount();
  const file = await replace();
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent).toContain(
    file.name,
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!.value,
  ).toBe("Bravas");
  const dialog = await adjust();
  expect(dialog.framing).toEqual({ x: 5000, y: 5000, zoom: 100 });
  await vi.waitFor(() =>
    expect(
      dialog
        .shadowRoot!.querySelector("[data-test=frame-image]")!
        .shadowRoot!.querySelector("canvas")!
        .getAttribute("data-loaded"),
    ).toBe("true"),
  );
  const frame = dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=frame]")!;
  frame.focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await done(dialog);
  expect(api.updateImage).not.toHaveBeenCalled();
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(1));
  expect(api.updateImage).toHaveBeenCalledWith(
    "photo",
    {
      names: { en: "Bravas", es: "Patatas" },
      framing: { x: 6000, y: 5000, zoom: 100 },
      expectedRevision: 3,
    },
    file,
  );
});

it("replacing a photo preserves a deliberately cleared name instead of suggesting a filename", async () => {
  await mount();
  el.shadowRoot!.querySelector("[name=name-en]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" } }),
  );
  await el.updateComplete;
  await replace();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!.value,
  ).toBe("");
});

it("nested Enter cannot submit the outer editor while framing is open", async () => {
  const api = await mount();
  await replace();
  const dialog = await adjust();
  expect(save().disabled).toBe(true);
  const slider = dialog.shadowRoot!.querySelector("wt-slider")!;
  await slider.updateComplete;
  slider.shadowRoot!.querySelector<HTMLInputElement>("input")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(api.updateImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("media-photo-framing-dialog")).toBe(dialog);
  await done(dialog);
  expect(save().disabled).toBe(false);
});

it("conflict keeps the exact draft until explicit reload, which reads the new revision", async () => {
  const api = await mount();
  const file = await replace();
  api.updateImage.mockRejectedValueOnce({ code: "image.changed" });
  save().click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=reload-photo]")).not.toBeNull(),
  );
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent).toContain(
    file.name,
  );
  expect(save().disabled).toBe(false);
  api.getImage.mockResolvedValue({
    image: { ...image, names: { en: "Newer" }, revision: 7 },
    uses: [],
  });
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=reload-photo]")!),
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!.value,
    ).toBe("Newer"),
  );
  expect(save().disabled).toBe(true);
  expect(api.updateImage).toHaveBeenCalledTimes(1);
});

it("replacement URLs are revoked on replacement and disconnect, and reconnect makes a fresh URL", async () => {
  const create = vi.spyOn(URL, "createObjectURL");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const api = await mount();
  await replace();
  const first = await adjust();
  expect(first.source).toMatch(/^blob:/);
  const old = first.source;
  await done(first);
  await replace();
  expect(revoke).toHaveBeenCalledWith(old);
  const second = await adjust();
  const recent = second.source;
  expect(recent).not.toBe(old);
  await done(second);
  el.remove();
  expect(revoke).toHaveBeenCalledWith(recent);
  document.body.append(el);
  await el.updateComplete;
  const third = await adjust();
  expect(third.source).toMatch(/^blob:/);
  expect(third.source).not.toBe(recent);
  expect(create).toHaveBeenCalled();
  expect(api.updateImage).not.toHaveBeenCalled();
});
