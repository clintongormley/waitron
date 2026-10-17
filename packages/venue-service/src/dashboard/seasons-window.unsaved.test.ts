import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController, type LeaveReason } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonsWindow } from "./seasons-window.js";
import "./seasons-window.js";

const seasons = [
  { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" as const },
  { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" as const },
];
type WindowApi = Pick<OpeningHoursApi, "saveSeasons" | "readSeasonDeleteImpact">;

class SeasonsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly windowRoot = {};
  api: WindowApi = {
    saveSeasons: vi.fn(() => new Promise<never>(() => {})),
    readSeasonDeleteImpact: vi.fn(),
  } as unknown as WindowApi;
  /** The screen's guard, reduced to asking about the window's root. */
  readonly beforeClose = async (reason: LeaveReason) =>
    (await this.leave.coordinator.request({ scopes: [this.windowRoot], reason, proceed() {} })) ===
    "proceeded";
  override render() {
    return html`<seasons-window
        .seasons=${seasons}
        .clockRevision=${1}
        .api=${this.api}
        .draftParent=${this.windowRoot}
        .beforeClose=${this.beforeClose}
      ></seasons-window
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("seasons-leave-test-app", SeasonsLeaveApp);
let app: SeasonsLeaveApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("seasons-leave-test-app") as SeasonsLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const el = app.shadowRoot!.querySelector<SeasonsWindow>("seasons-window")!;
  await el.updateComplete;
  return el;
}
const nameField = (el: SeasonsWindow, index: number) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=season-${index}-name]`)!;
async function change(el: SeasonsWindow, index: number, value: string) {
  nameField(el, index).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const modal = (el: SeasonsWindow) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const save = (el: SeasonsWindow) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-seasons]")!;
const question = () =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>("wt-unsaved-changes")!;
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const q = question();
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}

it("asks before closing a changed draft, and Keep keeps the rows", async () => {
  // Moved from season-dialog.unsaved.test.ts:67.
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, 0, "Deep winter");
  expect(unload()).toBe(true);
  const close = modal(el).requestClose("cancel");
  await choose("keep");
  expect(await close).toBe(false);
  expect(modal(el).open).toBe(true);
  expect(nameField(el, 0).value).toBe("Deep winter");
  const discard = modal(el).requestClose("escape");
  await choose("discard");
  expect(await discard).toBe(true);
  await el.updateComplete;
  expect(nameField(el, 0).value).toBe("Winter");
  expect(unload()).toBe(false);
});

it("restoring the opened values closes without asking", async () => {
  // Moved from season-dialog.unsaved.test.ts:86.
  const el = await mount();
  await change(el, 0, "Cold");
  await change(el, 0, "Winter");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  expect(unload()).toBe(false);
  expect(await modal(el).requestClose("cancel")).toBe(true);
  expect(question().open).toBe(false);
});

it("a close asked in the turn a Save starts is refused", async () => {
  // Moved from season-dialog.unsaved.test.ts:96.
  const el = await mount();
  await change(el, 0, "Cold");
  save(el).shadowRoot!.querySelector("button")!.click();
  const close = modal(el).requestClose("escape");
  const asked = expect
    .poll(() => question().open)
    .toBe(true)
    .then(
      () => "asked",
      () => "never asked",
    );
  expect(await Promise.race([close, asked])).toBe(false);
  expect(question().open).toBe(false);
  expect(modal(el).open).toBe(true);
  expect(app.api.saveSeasons).toHaveBeenCalledTimes(1);
});

it("a draft parented to the window root is asked about only for that root", async () => {
  const el = await mount();
  await change(el, 0, "Cold");
  const coordinator = app.leave.coordinator;
  expect(coordinator.isDirty([app.windowRoot])).toBe(true);
  expect(coordinator.isDirty([{}])).toBe(false);
  expect(await coordinator.request({ scopes: [{}], reason: "navigation", proceed() {} })).toBe(
    "proceeded",
  );
  expect(question().open).toBe(false);
  expect(nameField(el, 0).value).toBe("Cold");
});
