import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { LeaveController, type WtInput } from "@waitron/ui";
import type {
  DashboardApi,
  BusinessDayClockModel,
  BusinessDayStartPreview,
  VenueDetailsModel,
} from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale, t } from "../i18n/t.js";
import "./business-day-start-editor.js";

type Editor = HTMLElementTagNameMap["dashboard-business-day-start-editor"];
const model: BusinessDayClockModel = {
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
  revision: 4,
  currentBusinessDay: "2026-11-01",
  pending: null,
};
const preview: BusinessDayStartPreview = {
  revision: 4,
  previousDay: {
    businessDay: "2026-11-03",
    dayCutover: "05:00",
    startAt: "2026-11-03T04:00:00.000Z",
    endAt: "2026-11-04T02:00:00.000Z",
  },
  effectiveDay: {
    businessDay: "2026-11-04",
    dayCutover: "03:00",
    startAt: "2026-11-04T02:00:00.000Z",
    endAt: "2026-11-05T02:00:00.000Z",
  },
  conflicts: [],
  conflictCount: 0,
  backupDeadlines: { archive: null, cloud: null },
};
class StartLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-business-day-start-editor
        .model=${model}
        .api=${this.api}
      ></dashboard-business-day-start-editor
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("business-start-leave-test-app", StartLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});
const q = <T extends HTMLElement = HTMLElement>(el: Editor, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel)!;
async function click(el: Editor, action: string) {
  q(el, `[data-test=${action}]`).click();
  await el.updateComplete;
}
async function change(el: Editor, name: string, value: string) {
  q(el, `[name=${name}]`).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: StartLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}
async function mount(write?: () => Promise<{ changed: boolean; model: VenueDetailsModel }>) {
  const writes: string[] = [];
  const api = {
    previewBusinessDayStart: async () => preview,
    putBusinessDayStart: async () => {
      writes.push("save");
      return write ? write() : { changed: true, model: venueDetailsFixture() };
    },
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<StartLeaveApp>("business-start-leave-test-app", { api });
  const editor = app.shadowRoot!.querySelector("dashboard-business-day-start-editor")!;
  await editor.updateComplete;
  await click(editor, "change");
  return { app, editor, writes };
}
async function ready(editor: Editor) {
  await change(editor, "dayCutover", "03:00");
  await expect.poll(() => editor.shadowRoot!.querySelector("[data-test=acknowledge]")).toBeTruthy();
  await click(editor, "acknowledge");
}
for (const name of ["dayCutover"]) {
  it(`protects invalid ${name} and releases on a literal revert`, async () => {
    const { app, editor } = await mount();
    expect(unload()).toBe(false);
    await change(editor, name, "invalid");
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose(app, "keep");
    expect(await request).toBe("kept");
    expect(
      q<WtInput>(editor, `[name=${name}]`).shadowRoot!.querySelector<HTMLInputElement>("input")!
        .value,
    ).toBe("invalid");
    await change(editor, name, "05:00");
    expect(unload()).toBe(false);
  });
}
it("Cancel asks before discarding without sending a request", async () => {
  const { app, editor, writes } = await mount();
  await change(editor, "dayCutover", "03:00");
  await click(editor, "cancel");
  await choose(app, "keep");
  expect(unload()).toBe(true);
  await click(editor, "cancel");
  await choose(app, "discard");
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it("a successful write releases the draft before any refresh failure", async () => {
  const { editor, writes } = await mount();
  let refreshes = 0;
  editor.addEventListener("saved", () => {
    expect(unload()).toBe(false);
    refreshes++;
  });
  await ready(editor);
  await click(editor, "save");
  await expect.poll(() => writes.length).toBe(1);
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(refreshes).toBe(1);
  expect(unload()).toBe(false);
});
it("a refusal keeps a protected retryable draft", async () => {
  const { editor } = await mount(async () => {
    throw { code: "connection.failed" };
  });
  await ready(editor);
  await click(editor, "save");
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-form-actions")?.error).toBeTruthy();
  expect(unload()).toBe(true);
  expect(q<WtInput>(editor, "[name=dayCutover]").value).toBe("03:00");
});
it("reconnecting protects the draft and ignores an old pending write", async () => {
  let resolve!: (x: { changed: boolean; model: VenueDetailsModel }) => void;
  const pending = new Promise<{ changed: boolean; model: VenueDetailsModel }>((r) => (resolve = r));
  const { editor } = await mount(() => pending);
  let saved = 0;
  editor.addEventListener("saved", () => saved++);
  await ready(editor);
  await click(editor, "save");
  await reattachAfterDetachedUpdate(editor);
  expect(unload()).toBe(true);
  resolve({ changed: true, model: venueDetailsFixture() });
  await new Promise((r) => setTimeout(r, 0));
  await editor.updateComplete;
  expect(saved).toBe(0);
  expect(q<WtInput>(editor, "[name=dayCutover]").value).toBe("03:00");
});
it("Escape keeps the native dialog open until the dirty-draft decision is answered", async () => {
  const { app, editor } = await mount();
  await change(editor, "dayCutover", "bad");
  const dialog = editor.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  const pending = dialog.requestClose("escape");
  await choose(app, "keep");
  expect(await pending).toBe(false);
  expect(dialog.shadowRoot!.querySelector<HTMLDialogElement>("dialog")!.open).toBe(true);
  expect(unload()).toBe(true);
  const discarded = dialog.requestClose("escape");
  await choose(app, "discard");
  expect(await discarded).toBe(true);
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(unload()).toBe(false);
});
