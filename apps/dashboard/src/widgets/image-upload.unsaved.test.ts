import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, setContentLanguages } from "@waitron/ui";
import "@waitron/dashboard-modules";
import "./image-upload.js";
import { cleanupWidgets, mountWidget, closeReportsDelivered } from "./test-helpers.js";
import { t, setLocale } from "../i18n/t.js";

const image = {
  id: "one",
  filename: "one.jpg",
  names: { es: "Pan", en: "Bread" },
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  usageCount: 0,
};
class ImagePickerLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  parentValue = "Product draft";
  readonly parentScope = () =>
    this.leave.coordinator.register({
      id: this,
      current: () => this.parentValue,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.parentValue = value;
      },
    });
  request = vi
    .fn()
    .mockImplementation(async (_path: string, method: string) =>
      method === "GET" ? { images: [image], total: 1 } : { image, created: true },
    );
  override render() {
    return html`<dashboard-image-upload
        .draftParent=${this}
        .api=${{ imageLibraryRequest: this.request }}
      ></dashboard-image-upload>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("image-picker-leave-test-app", ImagePickerLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount() {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  const { el: app } = await mountWidget<ImagePickerLeaveApp>("image-picker-leave-test-app", {});
  app.parentScope();
  const upload = app.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
  await upload.updateComplete;
  const picker = upload.shadowRoot!.querySelector("media-image-picker")!;
  await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library")!;
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-test=edit-one]")).not.toBeNull(),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-one]")!.click();
  await library.updateComplete;
  await library.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const field =
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Pan editado",
  );
  await library.updateComplete;
  return { app, upload, library };
}
async function question(app: ImagePickerLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
it("enclosing picker Cancel keeps an edited image child until Discard, preserving the Product draft", async () => {
  const { app, upload, library } = await mount();
  app.parentValue = "Edited product";
  const cancel = () =>
    upload.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  cancel();
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(upload.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  await closeReportsDelivered();
  expect(
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!.value,
  ).toBe("Pan editado");
  cancel();
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  expect(app.parentValue).toBe("Edited product");
  expect(app.leave.coordinator.isDirty([app])).toBe(true);
  expect(app.request.mock.calls.filter(([, method]) => method !== "GET")).toEqual([]);
});
it("closing a parent scope sees an edited nested image through picker ancestry", async () => {
  const { app, upload } = await mount();
  let left = false;
  const pending = app.leave.coordinator.request({
    scopes: [app],
    reason: "cancel",
    proceed() {
      left = true;
    },
  });
  expect((await question(app)).open).toBe(true);
  expect(left).toBe(false);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!
    .click();
  expect(await pending).toBe("kept");
  expect(upload.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
});
it("saving the image child leaves the containing Product dirty and picker Cancel direct", async () => {
  const { app, upload, library } = await mount();
  app.parentValue = "Edited product";
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(app.request).toHaveBeenCalledWith("/management-api/images/one", "PATCH", {
    names: { es: "Pan editado", en: "Bread" },
  });
  expect(app.leave.coordinator.isDirty([app])).toBe(true);
  upload.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  expect((await question(app)).open).toBe(false);
  expect(app.parentValue).toBe("Edited product");
});

it("picker Cancel cannot interrupt a nested image write in progress", async () => {
  const { app, upload, library } = await mount();
  let finish!: (value: unknown) => void;
  app.request.mockImplementation(async (_path: string, method: string) =>
    method === "GET"
      ? { images: [image], total: 1 }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await library.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  expect((await question(app)).open).toBe(false);
  expect(upload.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
  finish({ image });
  await expect.poll(() => library.shadowRoot!.querySelector("wt-modal")).toBeNull();
  upload.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeNull();
});
