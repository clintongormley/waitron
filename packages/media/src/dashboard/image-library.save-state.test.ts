import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";

const image: LibraryImage = {
  id: "bread",
  filename: "bread.png",
  names: { en: "Bread", es: "Pan" },
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
  usageCount: 0,
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
});

async function mount(upload = false) {
  const api = {
    listImages: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
    uploadImage: vi.fn().mockResolvedValue({ image, created: true }),
    updateImage: vi.fn().mockResolvedValue({ image }),
  };
  el = document.createElement("dashboard-image-library");
  el.api = api as unknown as ImageApi;
  applyTokens(el);
  document.body.append(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=edit-bread]")).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>(
    upload ? "[data-test=upload]" : "[data-test=edit-bread]",
  )!.click();
  await el.updateComplete;
  return api;
}

async function name(value: string) {
  el.shadowRoot!.querySelector("[name=name-en]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function state(disabled: boolean, variant: string) {
  const button =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
  await button.updateComplete;
  expect(button.disabled).toBe(disabled);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(disabled);
  expect(button.variant).toBe(variant);
}

it.each([false, true])(
  "image metadata opens quiet, enables on edit and quiets on undo (upload=%s)",
  async (upload) => {
    await mount(upload);
    await state(true, "secondary");
    await name("Edited bread");
    await state(false, "primary");
    await name(upload ? "" : " Bread ");
    await state(true, "secondary");
  },
);

it("an untouched edit sends no metadata write, and Cancel works without a coordinator", async () => {
  const api = await mount();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await el.updateComplete;
  expect(api.updateImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("a changed refused edit stays primary and can retry without another edit", async () => {
  const api = await mount();
  await name("Edited bread");
  api.updateImage.mockRejectedValueOnce({ code: "connection.failed" });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
  );
  await state(false, "primary");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull());
  expect(api.updateImage).toHaveBeenCalledTimes(2);
  expect(api.updateImage).toHaveBeenLastCalledWith("bread", {
    names: { en: "Edited bread", es: "Pan" },
  });
});

it("file selection enables upload and clearing it restores the blank baseline", async () => {
  await mount(true);
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  const selected = new DataTransfer();
  selected.items.add(new File(["bytes"], "bread.png", { type: "image/png" }));
  input.files = selected.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  await state(false, "primary");
  input.files = new DataTransfer().files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  await state(true, "secondary");
});
