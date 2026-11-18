import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens, setContentLanguages } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import {
  codeMessage,
  currentLocale,
  registerCodeMessages,
  setLocale,
  LiveData,
} from "@waitron/dashboard-kit";
import type { ImageApi, LibraryImage } from "./client.js";
import type { ImageLibrary } from "./image-library.js";
import "./image-library.js";
import { MEDIA_STRINGS } from "./strings.js";

const CONNECTION_FAILED =
  "This browser could not connect to Waitron. Check your connection and try again.";
registerCodeMessages({
  "connection.failed": {
    en: CONNECTION_FAILED,
    es: `${CONNECTION_FAILED} (es)`,
  },
});

class LeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot> ${this.leave.render({
        heading: "Unsaved changes",
        message: "Discard unsaved changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard changes",
      })}`;
  }
}
customElements.define("image-framing-leave-host", LeaveHost);

const image: LibraryImage = {
  id: "photo",
  filename: "photo.png",
  sourceFilename: "photo.png",
  originalFilename: "spicy-potatoes.jpg",
  names: { en: "Spicy potatoes", es: "Patatas" },
  framing: { x: 2500, y: 7500, zoom: 200 },
  revision: 3,
  usageCount: 2,
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
};
let el: ImageLibrary;
let leaveHost: LeaveHost | undefined;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  el?.remove();
  leaveHost?.remove();
  leaveHost = undefined;
  setLocale(locale);
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  vi.restoreAllMocks();
});
async function mount(value = image, parent: HTMLElement = document.body) {
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
  parent.append(el);
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

const conflict =
  "The image could not be saved. This photo has changed. Reload it before saving again.";
const reloadFailed = `The photo could not be reloaded. ${CONNECTION_FAILED}`;
const busyRefusal = "The image could not be saved. The photo service is busy. Try again shortly.";
const photoDeleted =
  "The photo could not be reloaded. This photo has been deleted. Cancel to close this editor.";
const newer = { image: { ...image, names: { en: "Newer" }, revision: 7 }, uses: [] };
type Api = Awaited<ReturnType<typeof mount>>;
async function conflictedDraft(parent?: HTMLElement) {
  const api = await mount(image, parent);
  const file = await replace();
  api.updateImage.mockRejectedValueOnce({ code: "image.changed" });
  save().click();
  await vi.waitFor(() => expect(reloadButton()).not.toBeNull());
  return { api, file };
}
function reloadButton() {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=reload-photo]",
  );
}
async function pressReload() {
  await userEvent.click(page.elementLocator(reloadButton()!));
}
function holdNextRead(api: Api) {
  let answer!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  api.getImage.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      answer = resolve;
      fail = reject;
    }),
  );
  return { answer, fail };
}
async function reloadHeld(api: Api) {
  const read = holdNextRead(api);
  await pressReload();
  await vi.waitFor(() => expect(reloadButton()!.disabled).toBe(true));
  return read;
}
async function reloadFails(api: Api) {
  api.getImage.mockRejectedValueOnce({ code: "connection.failed" });
  await pressReload();
  await vi.waitFor(async () => expect(await bottomOf()).toBe(`${conflict} ${reloadFailed}`));
}
async function bottomOf() {
  const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
    "wt-modal wt-form-actions",
  )!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}
function nameField() {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-en]")!;
}
function filename() {
  return el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent;
}
async function cancel() {
  el.shadowRoot!.querySelector<HTMLElement>("wt-modal wt-button[slot=cancel]")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
}
async function open(id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=edit-${id}]`)!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
}
async function settled() {
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
}
async function mountLeaveHost() {
  leaveHost = document.createElement("image-framing-leave-host") as LeaveHost;
  document.body.append(leaveHost);
  await leaveHost.updateComplete;
  return leaveHost;
}

it("Edit photo shows the human filename, with a stored-filename fallback and no write", async () => {
  const api = await mount();
  expect(el.shadowRoot!.querySelector("[data-test=photo-filename]")?.textContent).toContain(
    "spicy-potatoes.jpg",
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
      names: { en: "Spicy potatoes", es: "Patatas" },
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
      names: { en: "Spicy potatoes", es: "Patatas" },
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
  ).toBe("Spicy potatoes");
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
      names: { en: "Spicy potatoes", es: "Patatas" },
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

it("a reload that fails keeps the conflict and the draft, says why, and can be tried again", async () => {
  const { api, file } = await conflictedDraft();
  await reloadFails(api);
  expect(reloadButton()).not.toBeNull();
  expect(reloadButton()!.disabled).toBe(false);
  expect(filename()).toContain(file.name);
  expect(nameField().value).toBe("Spicy potatoes");
  expect(save().disabled).toBe(false);
  api.getImage.mockResolvedValueOnce(newer);
  await pressReload();
  await vi.waitFor(() => expect(nameField().value).toBe("Newer"));
  expect(filename()).not.toContain(file.name);
  expect(await bottomOf()).toBe("");
  expect(reloadButton()).toBeNull();
});

it("a reload that fails after the person typed still says why and keeps what they typed", async () => {
  const { api } = await conflictedDraft();
  const read = await reloadHeld(api);
  nameField().dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Typed meanwhile" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  read.fail({ code: "connection.failed" });
  await vi.waitFor(async () => expect(await bottomOf()).toBe(`${conflict} ${reloadFailed}`));
  expect(nameField().value).toBe("Typed meanwhile");
  expect(reloadButton()!.disabled).toBe(false);
});

it("a failed reload is worded in Spanish too", async () => {
  const { api } = await conflictedDraft();
  setLocale("es");
  api.getImage.mockRejectedValueOnce({ code: "connection.failed" });
  await pressReload();
  await vi.waitFor(async () =>
    expect(await bottomOf()).toBe(
      [
        MEDIA_STRINGS.es["image.save_error"],
        codeMessage("image.changed", "es"),
        MEDIA_STRINGS.es["image.reload_error"],
        codeMessage("connection.failed", "es"),
      ].join(" "),
    ),
  );
});

it("a new reload takes the last reload's failure away while it runs", async () => {
  const { api } = await conflictedDraft();
  await reloadFails(api);
  const read = await reloadHeld(api);
  expect(await bottomOf()).toBe(conflict);
  read.fail({ code: "connection.failed" });
  await vi.waitFor(async () => expect(await bottomOf()).toBe(`${conflict} ${reloadFailed}`));
  expect(reloadButton()!.disabled).toBe(false);
});

it("pressing Save takes a reload's failure away", async () => {
  const { api } = await conflictedDraft();
  await reloadFails(api);
  api.updateImage.mockRejectedValueOnce({ code: "image.changed" });
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () => expect(await bottomOf()).toBe(conflict));
  expect(reloadButton()).not.toBeNull();
});

it("a reload that fails after Save was pressed says nothing", async () => {
  const { api } = await conflictedDraft();
  const read = await reloadHeld(api);
  let refuse!: (reason: unknown) => void;
  api.updateImage.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      refuse = reject;
    }),
  );
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(2));
  read.fail({ code: "connection.failed" });
  await settled();
  expect(await bottomOf()).toBe("");
  refuse({ code: "image.changed" });
  await vi.waitFor(async () => expect(await bottomOf()).toBe(conflict));
});

it("a reload that answers after Save was refused for another reason changes nothing", async () => {
  const host = await mountLeaveHost();
  const { api, file } = await conflictedDraft(host);
  const read = await reloadHeld(api);
  api.updateImage.mockRejectedValueOnce({ code: "image.busy" });
  save().click();
  await vi.waitFor(async () => expect(await bottomOf()).toBe(busyRefusal));
  read.answer(newer);
  await settled();
  await host.updateComplete;
  expect(host.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(filename()).toContain(file.name);
  expect(nameField().value).toBe("Spicy potatoes");
  expect(await bottomOf()).toBe(busyRefusal);
  expect(reloadButton()).toBeNull();
});

it("a reload that fails after Save was refused as changed again shows only the new conflict", async () => {
  const { api } = await conflictedDraft();
  const read = await reloadHeld(api);
  api.updateImage.mockRejectedValueOnce({ code: "image.changed" });
  save().click();
  await vi.waitFor(() => expect(api.updateImage).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () => expect(await bottomOf()).toBe(conflict));
  read.fail({ code: "connection.failed" });
  await vi.waitFor(() => expect(reloadButton()!.disabled).toBe(false));
  await settled();
  expect(await bottomOf()).toBe(conflict);
});

it("a reload that finds the photo deleted says so, offers no reload, and Cancel still closes", async () => {
  const { api, file } = await conflictedDraft();
  api.getImage.mockRejectedValueOnce({ code: "image.not_found" });
  await pressReload();
  await vi.waitFor(async () => expect(await bottomOf()).toBe(photoDeleted));
  expect(reloadButton()).toBeNull();
  expect(filename()).toContain(file.name);
  expect(nameField().value).toBe("Spicy potatoes");
  await cancel();
});

it("the deleted photo's sentence names the editor's Cancel button in each language", () => {
  for (const language of ["en", "es"] as const)
    expect(codeMessage("image.not_found", language)).toContain(
      MEDIA_STRINGS[language]["image.cancel"],
    );
});

it("closing the editor takes a reload's failure away", async () => {
  const { api } = await conflictedDraft();
  await reloadFails(api);
  await cancel();
  await open("photo");
  expect(await bottomOf()).toBe("");
  expect(reloadButton()).toBeNull();
});

it("a reload that answers after Cancel leaves the editor closed and the photo as it was", async () => {
  const { api } = await conflictedDraft();
  const read = await reloadHeld(api);
  await cancel();
  read.answer(newer);
  await settled();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  await open("photo");
  expect(nameField().value).toBe("Spicy potatoes");
  expect(await bottomOf()).toBe("");
});

it("a reload that fails after Cancel leaves nothing for the next photo opened", async () => {
  const { api } = await conflictedDraft();
  api.listImages.mockResolvedValue({
    images: [image, { ...image, id: "other", names: { en: "Other" } }],
    total: 2,
  });
  api.liveData.invalidate([{ type: "media_images" }]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=edit-other]")).not.toBeNull(),
  );
  const read = await reloadHeld(api);
  await cancel();
  read.fail({ code: "connection.failed" });
  await settled();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  await open("other");
  expect(nameField().value).toBe("Other");
  expect(await bottomOf()).toBe("");
  expect(reloadButton()).toBeNull();
});

it("a reload that fails after the screen was taken off the page and put back leaves the editor's message alone", async () => {
  const { api } = await conflictedDraft();
  const read = await reloadHeld(api);
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  read.fail({ code: "connection.failed" });
  await vi.waitFor(() => expect(reloadButton()?.disabled).not.toBe(true));
  await el.updateComplete;
  expect(await bottomOf()).toBe(conflict);
  expect(reloadButton()).not.toBeNull();
});

it("a reload that answers after the screen was taken off the page and put back does not replace the draft", async () => {
  const { api, file } = await conflictedDraft();
  const read = await reloadHeld(api);
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  read.answer(newer);
  await vi.waitFor(() => expect(reloadButton()?.disabled).not.toBe(true));
  await el.updateComplete;
  expect(filename()).toContain(file.name);
  expect(nameField().value).toBe("Spicy potatoes");
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
