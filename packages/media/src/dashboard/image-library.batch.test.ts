import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";
const image = (id: string, name: string): LibraryImage => ({
  id,
  filename: `${id}.png`,
  names: { es: name, en: name },
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:00Z",
  usageCount: 0,
});
const file = (name: string) => new File(["photo"], name, { type: "image/png" });
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (v: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
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
async function mount(picker = false) {
  const api = {
    listImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
    uploadImage:
      vi.fn<
        (
          f: File,
          m: { names: Record<string, string> },
        ) => Promise<{ image: LibraryImage; created: boolean }>
      >(),
    updateImage: vi.fn(),
    liveData: new LiveData(),
  };
  el = document.createElement("dashboard-image-library");
  el.api = api as unknown as ImageApi;
  el.picker = picker;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  await vi.waitFor(() => expect(api.listImages).toHaveBeenCalledOnce());
  return api;
}
function drag(type: string, files: File[], target: Element = el) {
  const d = new DataTransfer();
  files.forEach((f) => d.items.add(f));
  const e = new DragEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    dataTransfer: d,
  });
  target.dispatchEvent(e);
  return e;
}
const text = () => el.shadowRoot!.textContent!;
it("uploads a mixed batch sequentially, preserves default-language names and keeps duplicate metadata", async () => {
  const api = await mount();
  const one = deferred<{ image: LibraryImage; created: boolean }>();
  const two = deferred<{ image: LibraryImage; created: boolean }>();
  const three = deferred<{ image: LibraryImage; created: boolean }>();
  api.uploadImage
    .mockReturnValueOnce(one.promise)
    .mockReturnValueOnce(two.promise)
    .mockReturnValueOnce(three.promise);
  const files = [file("patatas-bravas.jpg"), file("damaged.png"), file("same.webp")];
  expect(drag("drop", files).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(1));
  expect(api.uploadImage).toHaveBeenLastCalledWith(files[0], { names: { es: "Patatas bravas" } });
  drag("drop", [file("intruder.png")]);
  expect(api.uploadImage).toHaveBeenCalledTimes(1);
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(text()).toContain("0 of 3 photos uploaded.");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  one.resolve({ image: image("new", "Patatas bravas"), created: true });
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(2));
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  two.reject({ code: "image.invalid_file" });
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(3));
  expect(api.uploadImage).toHaveBeenLastCalledWith(files[2], { names: { es: "Same" } });
  three.resolve({ image: image("old", "Original name"), created: false });
  await vi.waitFor(() => expect(text()).toContain("2 of 3 photos uploaded."));
  expect(text()).toContain("damaged.png");
  expect(text()).toContain("The photo could not be read");
  expect(text()).toContain("Original name");
  expect(text()).not.toContain("No images found.");
  expect(text()).toContain("Its name is unchanged.");
  expect(api.updateImage).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelectorAll("[data-new]")).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("[data-image=new] [data-new]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-image=old] [data-new]")).toBeNull();
});
it("shows a counted drag overlay across nested enters, ignores text drags and clears on the final leave", async () => {
  await mount();
  const files = [file("a.png"), file("b.png"), file("c.png")];
  drag("dragenter", files);
  drag("dragenter", files);
  drag("dragleave", files);
  await el.updateComplete;
  expect(text()).toContain("Drop 3 photos to upload them");
  drag("dragleave", files);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=drop-overlay]")).toBeNull();
  const d = new DataTransfer();
  d.setData("text/plain", "bread");
  const e = new DragEvent("drop", { cancelable: true, bubbles: true, dataTransfer: d });
  el.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
});
it("file dragover prevents navigation while an open editor suppresses the page overlay", async () => {
  const api = await mount();
  const files = [file("bread.png")];
  const ready = drag("dragover", files);
  expect(ready.defaultPrevented).toBe(true);
  expect(api.uploadImage).not.toHaveBeenCalled();

  el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  await el.updateComplete;
  const blocked = drag("dragover", files);
  expect(blocked.defaultPrevented).toBe(true);
  drag("dragenter", files);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=drop-overlay]")).toBeNull();
  expect(api.uploadImage).not.toHaveBeenCalled();

  const textTransfer = new DataTransfer();
  textTransfer.setData("text/plain", "bread");
  const textDrag = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: textTransfer,
  });
  el.dispatchEvent(textDrag);
  expect(textDrag.defaultPrevented).toBe(false);
});
it.each(["dragenter", "dragover", "drop"])("ignores %s without transfer data", async (type) => {
  const api = await mount();
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  await el.updateComplete;
  expect(event.defaultPrevented).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=drop-overlay]")).toBeNull();
  expect(api.uploadImage).not.toHaveBeenCalled();
});
it.each(["picker", "editor", "viewer", "delete"])(
  "prevents file navigation without a batch through %s",
  async (mode) => {
    const api = await mount(mode === "picker");
    if (mode === "editor") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
      await el.updateComplete;
    }
    if (mode === "viewer" || mode === "delete") {
      api.listImages.mockResolvedValue({ images: [image("one", "Pan")], total: 1 });
      Object.assign(api, {
        getImage: vi.fn().mockResolvedValue({ image: image("one", "Pan"), uses: [] }),
      });
      api.liveData.invalidate([{ type: "media_images" }]);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-image=one]")).not.toBeNull(),
      );
      el.shadowRoot!.querySelector<HTMLElement>(
        `[data-test=${mode === "viewer" ? "preview" : "delete"}-one]`,
      )!.click();
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull());
    }
    expect(drag("drop", [file("a.png")]).defaultPrevented).toBe(true);
    expect(api.uploadImage).not.toHaveBeenCalled();
  },
);
it("the multiple chooser uploads, accepts another batch after completion, and deduplicates repeated returned IDs", async () => {
  const api = await mount();
  api.uploadImage.mockResolvedValue({ image: image("same", "Pan"), created: true });
  const chooser =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-file-input"]>("wt-file-input[multiple]");
  expect(chooser).not.toBeNull();
  await chooser!.updateComplete;
  const native = chooser!.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.multiple).toBe(true);
  const d = new DataTransfer();
  d.items.add(file("same.png"));
  d.items.add(file("same.png"));
  native.files = d.files;
  native.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await vi.waitFor(() => expect(text()).toContain("2 of 2 photos uploaded."));
  expect(api.uploadImage).toHaveBeenCalledTimes(2);
  expect(el.shadowRoot!.querySelectorAll("[data-image=same]")).toHaveLength(1);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=upload]")!
        .disabled,
    ).toBe(false),
  );
  drag("drop", [file("again.png")]);
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(3));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelectorAll("[data-image=same]")).toHaveLength(1),
  );
});
it("continues all failed uploads and keeps their filenames and errors when a live read recovers", async () => {
  const api = await mount();
  api.uploadImage.mockRejectedValue({ code: "image.invalid_file" });
  drag("drop", [file("a.png"), file("b.png")]);
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelectorAll("[data-upload-error]")).toHaveLength(2),
  );
  expect(text()).toContain("0 of 2 photos uploaded.");
  api.liveData.invalidate([{ type: "media_images" }]);
  await vi.waitFor(() => expect(api.listImages).toHaveBeenCalledTimes(2));
  expect(el.shadowRoot!.querySelectorAll("[data-upload-error]")).toHaveLength(2);
});
it("a failed refresh leaves the saved image visible with a load failure and never resends it", async () => {
  const api = await mount();
  api.uploadImage.mockResolvedValue({ image: image("new", "Pan"), created: true });
  api.listImages.mockRejectedValueOnce(new Error("offline"));
  drag("drop", [file("bread.png")]);
  await vi.waitFor(() => expect(text()).toContain("The image library could not be loaded."));
  expect(el.shadowRoot!.querySelector("[data-image=new]")).not.toBeNull();
  expect(api.uploadImage).toHaveBeenCalledOnce();
});
it("disconnect ignores an old response and stops the remaining queue after reconnect", async () => {
  const api = await mount();
  const pending = deferred<{ image: LibraryImage; created: boolean }>();
  api.uploadImage.mockReturnValueOnce(pending.promise);
  drag("drop", [file("a.png"), file("b.png")]);
  expect(api.uploadImage).toHaveBeenCalledOnce();
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  pending.resolve({ image: image("late", "Old"), created: true });
  await pending.promise;
  await el.updateComplete;
  expect(api.uploadImage).toHaveBeenCalledOnce();
  expect(el.shadowRoot!.querySelector("[data-image=late]")).toBeNull();
});

it("a drop on the page outside the library's content uploads once and removes its listeners on disconnect", async () => {
  const api = await mount();
  api.uploadImage.mockResolvedValue({ image: image("body", "Pan"), created: true });
  expect(drag("drop", [file("bread.png")], document.body).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(api.uploadImage).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=body]")).not.toBeNull());
  el.remove();
  expect(drag("drop", [file("second.png")], document.body).defaultPrevented).toBe(false);
  expect(api.uploadImage).toHaveBeenCalledOnce();
});

it("an old batch response cannot overwrite a newly mounted batch", async () => {
  const api = await mount();
  const old = deferred<{ image: LibraryImage; created: boolean }>();
  const current = deferred<{ image: LibraryImage; created: boolean }>();
  api.uploadImage.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  drag("drop", [file("old.png")]);
  expect(api.uploadImage).toHaveBeenCalledOnce();
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  await vi.waitFor(() => expect(api.listImages).toHaveBeenCalledTimes(2));
  drag("drop", [file("current.png")]);
  expect(api.uploadImage).toHaveBeenCalledTimes(2);
  old.resolve({ image: image("stale", "Old batch"), created: true });
  await old.promise;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-image=stale]")).toBeNull();
  expect(text()).toContain("0 of 1 photo uploaded.");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=upload]")!
      .disabled,
  ).toBe(true);
  drag("drop", [file("intruder.png")]);
  expect(api.uploadImage).toHaveBeenCalledTimes(2);
  current.resolve({ image: image("current", "Current batch"), created: true });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-image=current]")).not.toBeNull(),
  );
  expect(api.uploadImage).toHaveBeenCalledTimes(2);
});

it("deleting an uploaded photo removes its cached tile and New badge after a confirmed refreshed row", async () => {
  const api = await mount();
  const uploaded = image("x", "Uploaded");
  api.uploadImage.mockResolvedValue({ image: uploaded, created: true });
  api.listImages.mockResolvedValue({ images: [uploaded, image("y", "Other")], total: 2 });
  Object.assign(api, {
    getImage: vi.fn().mockResolvedValue({ image: uploaded, uses: [] }),
    deleteImage: vi.fn().mockImplementation(async () => {
      api.listImages.mockResolvedValue({ images: [image("y", "Renamed other")], total: 1 });
      return { deleted: true, uses: [] };
    }),
  });
  drag("drop", [file("x.png")]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-image=x]")).not.toBeNull());
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=upload]")!
        .disabled,
    ).toBe(false),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-x]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=confirm-delete]")).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-image=y] h2")!.textContent).toBe("Renamed other"),
  );
  expect(el.shadowRoot!.querySelector("[data-image=x]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-new]")).toBeNull();
});
it("renaming a batch photo outside the query displays the saved name without losing its badge", async () => {
  const api = await mount();
  const uploaded = image("outside", "Before");
  api.uploadImage.mockResolvedValue({ image: uploaded, created: true });
  api.updateImage.mockResolvedValue({
    image: { ...uploaded, names: { en: "Saved name", es: "Before" } },
  });
  drag("drop", [file("outside.png")]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-image=outside]")).not.toBeNull(),
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=upload]")!
        .disabled,
    ).toBe(false),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-outside]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector("[name=name-en]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Saved name" } }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-image=outside] h2")!.textContent).toBe("Saved name");
  expect(el.shadowRoot!.querySelector("[data-image=outside] [data-new]")).not.toBeNull();
});
it("Edit and Delete are natively disabled while another photo uploads", async () => {
  const api = await mount();
  const existing = image("existing", "Existing");
  api.listImages.mockResolvedValue({ images: [existing], total: 1 });
  api.liveData.invalidate([{ type: "media_images" }]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-image=existing]")).not.toBeNull(),
  );
  const pending = deferred<{ image: LibraryImage; created: boolean }>();
  api.uploadImage.mockReturnValueOnce(pending.promise);
  drag("drop", [file("new.png")]);
  await el.updateComplete;
  for (const action of ["edit", "delete"]) {
    const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${action}-existing]`,
    )!;
    await button.updateComplete;
    expect(button.disabled).toBe(true);
    expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  }
  pending.resolve({ image: image("new", "New"), created: true });
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=edit-existing]")!
        .disabled,
    ).toBe(false),
  );
});
it.each([
  ["en", "1 of 1 photo uploaded."],
  ["es", "1 de 1 foto subida."],
])("uses singular progress for one photo (%s)", async (locale, wanted) => {
  setLocale(locale);
  const api = await mount();
  setLocale(locale);
  api.uploadImage.mockResolvedValue({ image: image("one", "Pan"), created: true });
  drag("drop", [file("one.png")]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".batch-progress")!.textContent!.trim()).toBe(wanted),
  );
});
