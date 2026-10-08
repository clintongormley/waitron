import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, setContentLanguages } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { ImageApi, LibraryImage } from "./client.js";
import "./image-library.js";

const image: LibraryImage = {
  id: "one",
  filename: "one.jpg",
  names: { es: "Pan", en: "Bread" },
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  usageCount: 0,
};
class ImageLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  client = {
    listImages: vi.fn().mockResolvedValue({ images: [image], total: 1 }),
    uploadImage: vi.fn().mockResolvedValue({ image, created: true }),
    updateImage: vi.fn().mockResolvedValue({ image }),
    deleteImage: vi.fn().mockResolvedValue({ deleted: true, uses: [] }),
    getImage: vi.fn().mockResolvedValue({ image, uses: [] }),
  };
  override render() {
    return html`<dashboard-image-library
        .api=${this.client as unknown as ImageApi}
      ></dashboard-image-library>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("image-leave-test-app", ImageLeaveApp);
let app: ImageLeaveApp;
afterEach(() => {
  app?.remove();
  setLocale("en-GB");
});
async function mount(upload = false) {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  app = document.createElement("image-leave-test-app") as ImageLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const library = app.shadowRoot!.querySelector("dashboard-image-library")!;
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-test=edit-one]")).not.toBeNull(),
  );
  library
    .shadowRoot!.querySelector<HTMLElement>(upload ? "[data-test=upload]" : "[data-test=edit-one]")!
    .click();
  await library.updateComplete;
  await library.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return library;
}
async function edit(library: HTMLElement, value: string) {
  const field =
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await (library as HTMLElementTagNameMap["dashboard-image-library"]).updateComplete;
}
function cancel(library: HTMLElement) {
  library.shadowRoot!.querySelector<HTMLElement>("wt-modal wt-button[slot=cancel]")!.click();
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function file(library: HTMLElement, value: File | null) {
  const field = library.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  const data = new DataTransfer();
  if (value) data.items.add(value);
  field.files = data.files;
  field.dispatchEvent(new Event("change", { bubbles: true }));
}
for (const route of ["cancel", "escape"] as const) {
  it(`Image Edit ${route} retains values through Keep and discards without a write`, async () => {
    const library = await mount();
    await edit(library, "Pan editado");
    if (route === "cancel") cancel(library);
    else await userEvent.keyboard("{Escape}");
    const q = await question();
    expect(q.open).toBe(true);
    expect(
      library.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(
      library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!.value,
    ).toBe("Pan editado");
    cancel(library);
    await question();
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(app.client.updateImage).not.toHaveBeenCalled();
    expect(app.client.deleteImage).not.toHaveBeenCalled();
  });
}
it("Image names reverted to their trimmed starting values close without a question", async () => {
  const library = await mount();
  await edit(library, "Changed");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(library, " Pan ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(library);
  await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
});
it("Upload protects a selected opaque File and becomes clean when cleared", async () => {
  const library = await mount(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  file(library, new File(["first"], "same.png", { type: "image/png" }));
  await library.updateComplete;
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  cancel(library);
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(library.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!.src).toMatch(
    /^blob:/,
  );
  file(library, null);
  await library.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(library);
  await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(app.client.uploadImage).not.toHaveBeenCalled();
  expect(app.client.deleteImage).not.toHaveBeenCalled();
});
it("a refused Image update retains the exact submitted metadata and remains protected", async () => {
  const library = await mount();
  await edit(library, "Pan editado");
  app.client.updateImage.mockRejectedValue({
    code: "image.translation_required",
    params: { language: "es" },
  });
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[name=name-es]")!.getAttribute("error")).not.toBe(""),
  );
  expect(app.client.updateImage).toHaveBeenCalledWith("one", {
    names: { es: "Pan editado", en: "Bread" },
  });
  cancel(library);
  expect((await question()).open).toBe(true);
});
it("successful Upload closes and clears its scope before a failed refresh without deleting stored bytes", async () => {
  const library = await mount(true);
  const selected = new File(["bytes"], "same.png", { type: "image/png" });
  file(library, selected);
  await edit(library, "Nueva");
  let cleanAtRefresh: boolean | undefined;
  app.client.listImages.mockImplementation(async () => {
    cleanAtRefresh = !app.leave.coordinator.isDirty();
    throw new Error("refresh refused");
  });
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(library.shadowRoot!.querySelector("wt-modal")).toBeNull());
  await vi.waitFor(() => expect(cleanAtRefresh).toBe(true));
  expect(app.client.uploadImage).toHaveBeenCalledWith(selected, { names: { es: "Nueva" } });
  expect(app.client.deleteImage).not.toHaveBeenCalled();
  expect((await question()).open).toBe(false);
});

it("replacing a selected File while asking invalidates the old answer, even for identical filenames", async () => {
  const library = await mount(true);
  file(library, new File(["first"], "same.png", { type: "image/png" }));
  await library.updateComplete;
  cancel(library);
  const q = await question();
  expect(q.open).toBe(true);
  const oldChoice = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  file(library, new File(["second"], "same.png", { type: "image/png" }));
  await library.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldChoice.click();
  expect(library.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  expect(
    library.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!.files![0]!.size,
  ).toBe(6);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("replacing an Image editor while asking starts a clean scope and invalidates the old answer", async () => {
  const library = await mount();
  await edit(library, "Pan editado");
  cancel(library);
  const q = await question();
  expect(q.open).toBe(true);
  const oldChoice = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  await library.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldChoice.click();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(library.shadowRoot!.querySelector("input[type=file]")).not.toBeNull();
  expect(
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-modal [name=name-es]")!
      .value,
  ).toBe("");
});
it("an image name supplied as a blank optional translation reverts to absent without a question", async () => {
  const library = await mount(true);
  const field = library.shadowRoot!.querySelector("[name=name-en]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Name" }, bubbles: true, composed: true }),
  );
  await library.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: " " }, bubbles: true, composed: true }),
  );
  await library.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a refused write from a replaced Image editor cannot mark the replacement fields", async () => {
  const library = await mount();
  await edit(library, "Old name");
  let refuse!: (error: unknown) => void;
  app.client.updateImage.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await library.updateComplete;
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=upload]")!.click();
  await library.updateComplete;
  refuse({ code: "image.translation_required", params: { language: "es" } });
  await vi.waitFor(() =>
    expect(
      library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!
        .disabled,
    ).toBe(false),
  );
  expect(library.shadowRoot!.querySelector("[name=name-es]")!.getAttribute("error")).toBe("");
  expect(library.shadowRoot!.querySelector("input[type=file]")).not.toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a successful Image write commits submitted values while preserving newer input", async () => {
  const library = await mount();
  await edit(library, "Submitted name");
  let finish!: (value: { image: LibraryImage }) => void;
  app.client.updateImage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await library.updateComplete;
  const save =
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(true);
  const field = library.shadowRoot!.querySelector("[name=name-es]")!;
  field.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Newer name" },
      bubbles: true,
      composed: true,
    }),
  );
  await library.updateComplete;
  finish({ image });
  await vi.waitFor(() =>
    expect(
      library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!
        .disabled,
    ).toBe(false),
  );
  expect(
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!.value,
  ).toBe("Newer name");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(save.variant).toBe("primary");
  expect(save.disabled).toBe(false);
  await edit(library, "Submitted name");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(save.variant).toBe("secondary");
  expect(save.disabled).toBe(true);
  cancel(library);
  await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
});

it("a duplicate Upload response from a replaced editor cannot close or label its replacement", async () => {
  const library = await mount(true);
  file(library, new File(["bytes"], "same.png", { type: "image/png" }));
  await edit(library, "Old upload");
  let finish!: (value: { image: LibraryImage; created: boolean }) => void;
  app.client.uploadImage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await library.updateComplete;
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-one]")!.click();
  await library.updateComplete;
  finish({ image, created: false });
  await vi.waitFor(() =>
    expect(
      library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!
        .disabled,
    ).toBe(false),
  );
  expect(
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!.value,
  ).toBe("Pan");
  expect(library.shadowRoot!.querySelector("[data-test=duplicate-upload]")).toBeNull();
  expect(library.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
