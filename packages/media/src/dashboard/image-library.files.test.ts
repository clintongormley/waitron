import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { ImageApi } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";
let el: ImageLibrary;
beforeEach(() => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
});
afterEach(() => {
  el?.remove();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});
async function setup() {
  const api = {
    listImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
    uploadImage: vi.fn().mockResolvedValue({
      image: { id: "one", filename: "one.png", names: { es: "Spicy potatoes" } },
      created: true,
    }),
  };
  el = document.createElement("dashboard-image-library");
  el.api = api as unknown as ImageApi;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  await el.updateComplete;
  return api;
}
const name = () =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!;
async function choose(filename: string | null) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-file-input"]>(
    "wt-file-input[name=image-file]",
  );
  const input = field!.shadowRoot!.querySelector<HTMLInputElement>("input[name=image-file]")!;
  const data = new DataTransfer();
  if (filename !== null) data.items.add(new File(["photo"], filename, { type: "image/png" }));
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await el.updateComplete;
  if (field) await field.updateComplete;
}
it.each([
  ["spicy-potatoes.jpg", "Spicy potatoes"],
  ["fried__squid.PNG", "Fried squid"],
  ["cake.v2-final.jpg", "Cake.v2 final"],
  ["árroz_negro.webp", "Árroz negro"],
  ["---.png", "---.png"],
  ["", "Photo"],
])(
  "suggests %s as %s in the content default language without uploading",
  async (filename, want) => {
    const api = await setup();
    await choose(filename);
    expect(name().value).toBe(want);
    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!.value,
    ).toBe("");
  },
);
it("replaces only an untouched suggestion and clears it back to the clean draft", async () => {
  await setup();
  await choose("bread.png");
  expect(name().value).toBe("Bread");
  await choose("croquettes.png");
  expect(name().value).toBe("Croquettes");
  await choose(null);
  expect(name().value).toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!.disabled,
  ).toBe(true);
  await choose("bread.png");
  name().dispatchEvent(new CustomEvent("wt-change", { detail: { value: "My bread" } }));
  await el.updateComplete;
  await choose("toast.png");
  expect(name().value).toBe("My bread");
  await choose(null);
  expect(name().value).toBe("My bread");
});
it("a dropped photo stages one file, shows its size and saves the suggested metadata only on Save", async () => {
  const api = await setup();
  const f = new File(["photo"], "spicy-potatoes.jpg", { type: "image/jpeg" });
  const data = new DataTransfer();
  data.items.add(f);
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-file-input"]>(
    "wt-file-input[name=image-file]",
  );
  expect(field).not.toBeNull();
  field!.shadowRoot!.querySelector("input")!.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      composed: true,
      cancelable: true,
      dataTransfer: data,
    }),
  );
  await el.updateComplete;
  await field!.updateComplete;
  expect(api.uploadImage).not.toHaveBeenCalled();
  expect(name().value).toBe("Spicy potatoes");
  expect(field!.shadowRoot!.textContent).toContain("5 B");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() =>
    expect(api.uploadImage).toHaveBeenCalledExactlyOnceWith(f, { names: { es: "Spicy potatoes" } }),
  );
});
