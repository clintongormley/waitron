import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import type { SectionDetails, SectionInput } from "../api/client.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./section-details-form.js";
import "@waitron/dashboard-modules";

registerIcons(DASHBOARD_ICONS);
const section: SectionDetails = {
  id: "starters",
  internalName: "Starters",
  names: { en: "To begin", es: "Para empezar", fr: "Entrées" },
  image: null,
  color: null,
  members: [],
};
class SectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  value: SectionDetails | null = section;
  cancelled = 0;
  submissions: SectionInput[] = [];
  override render() {
    return html`<dashboard-section-details-form
        .open=${this.open}
        .value=${this.value}
        .languages=${{ defaultLanguage: "en", languages: ["en", "es"] }}
        heading="Edit Starters"
        @wt-cancel=${() => {
          this.cancelled++;
          this.open = false;
          this.requestUpdate();
        }}
        @wt-submit=${(event: CustomEvent<SectionInput>) => this.submissions.push(event.detail)}
      ></dashboard-section-details-form
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("section-leave-test-app", SectionLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(value: SectionDetails | null = section) {
  const { el: app } = await mountWidget<SectionLeaveApp>("section-leave-test-app", { value });
  const form = app.shadowRoot!.querySelector("dashboard-section-details-form")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { app, form };
}
async function edit(
  form: HTMLElementTagNameMap["dashboard-section-details-form"],
  name: string,
  value: string,
) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
async function question(app: SectionLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: HTMLElement) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
}
for (const route of ["cancel", "escape"] as const) {
  it(`Section ${route} retains translated values through Keep and emits cancellation once after Discard`, async () => {
    const { app, form } = await mount();
    await edit(form, "names-es", "Primeros platos");
    if (route === "cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(app.cancelled).toBe(0);
    expect(q.open).toBe(true);
    expect(
      form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
    ).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    await closeReportsDelivered();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=names-es]")!.value,
    ).toBe("Primeros platos");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.cancelled).toBe(1);
    await closeReportsDelivered();
    expect(app.cancelled).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("Section revert compares the trimmed request including hidden translations", async () => {
  const { app, form } = await mount();
  await edit(form, "internalName", "Changed");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  await edit(form, "internalName", " Starters ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Section Add starts clean and a refused save retains the authored draft", async () => {
  const { app, form } = await mount(null);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "internalName", " Specials ");
  await edit(form, "names-en", " Dinner specials ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(app.submissions).toEqual([
    { internalName: "Specials", names: { en: "Dinner specials" }, image: null, color: null },
  ]);
  form.fieldErrors = { _form: "Refused" };
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
it("a replacement Section invalidates its pending answer and uses the new baseline", async () => {
  const { app, form } = await mount();
  await edit(form, "internalName", "Old draft");
  cancel(form);
  expect((await question(app)).open).toBe(true);
  app.value = { ...section, id: "desserts", internalName: "Desserts" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(app.cancelled).toBe(0);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=internalName]")!.value,
  ).toBe("Desserts");
});
it("Section color and image changes participate in the same draft and revert cleanly", async () => {
  const { app, form } = await mount();
  form.shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click();
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-color='']")!.click();
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const upload = form.shadowRoot!.querySelector("dashboard-image-upload")!;
  upload.dispatchEvent(
    new CustomEvent("image-changed", {
      detail: { image: "stored-photo" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  upload.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: null }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("Section success commits only submitted values and preserves later edits", async () => {
  const { app, form } = await mount();
  await edit(form, "internalName", " Saved starters ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(app.submissions).toEqual([
    {
      internalName: "Saved starters",
      names: { en: "To begin", es: "Para empezar", fr: "Entrées" },
      image: null,
      color: null,
    },
  ]);
  await edit(form, "internalName", "Newer edit");
  form.commitSaved(app.submissions[0]!);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "internalName", "Saved starters");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  cancel(form);
  await expect.poll(() => app.cancelled).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("Section busy and open image picker retain direct-close blocking", async () => {
  const { app, form } = await mount();
  await edit(form, "internalName", "Edited");
  form.busy = true;
  await form.updateComplete;
  cancel(form);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.cancelled).toBe(0);
  form.busy = false;
  await form.updateComplete;
  form.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: true },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  cancel(form);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.cancelled).toBe(0);
});

it("a Section leave sees edited image names through its enclosing picker ancestry", async () => {
  const { app, form } = await mount();
  form.api = {
    imageLibraryRequest: async <T>(_path: string, method: string): Promise<T> => {
      if (method !== "GET") throw new Error("No image write expected");
      return {
        images: [
          {
            id: "photo",
            filename: "photo.jpg",
            names: { en: "Bread", es: "Pan" },
            createdAt: "2026-09-12T12:00:00Z",
            updatedAt: "2026-09-12T12:00:00Z",
            usageCount: 0,
          },
        ],
        total: 1,
      } as T;
    },
  };
  await form.updateComplete;
  const upload = form.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
  await upload.updateComplete;
  const picker = upload.shadowRoot!.querySelector("media-image-picker")!;
  await (picker as LitElement).updateComplete;
  const library = picker.shadowRoot!.querySelector("dashboard-image-library")!;
  await vi.waitFor(() =>
    expect(library.shadowRoot!.querySelector("[data-test=edit-photo]")).not.toBeNull(),
  );
  library.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-photo]")!.click();
  await library.updateComplete;
  const field =
    library.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name-es]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Pan editado",
  );
  await library.updateComplete;
  expect(app.leave.coordinator.isDirty([form])).toBe(true);
  let left = false;
  const pending = app.leave.coordinator.request({
    scopes: [form],
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(left).toBe(false);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await pending).toBe("kept");
  expect(field.value).toBe("Pan editado");
  expect(upload.shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
});
it("a Section taken out of the page and put back asks before discarding an edit made afterwards", async () => {
  const { app, form } = await mount();
  const parent = form.parentNode!;
  form.remove();
  await form.updateComplete;
  parent.appendChild(form);
  await form.updateComplete;
  await edit(form, "internalName", "Changed");
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.cancelled).toBe(0);
});
