import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
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
  readonly leavePage = async () =>
    this.leave.coordinator.request({
      scopes: [this.windowRoot],
      reason: "navigation",
      proceed() {},
    });
  override render() {
    return html`<seasons-window
        seasonId="winter"
        .seasons=${seasons}
        .clockRevision=${1}
        .api=${this.api}
        .draftParent=${this.windowRoot}
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
const nameField = (el: SeasonsWindow) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
async function change(el: SeasonsWindow, value: string) {
  nameField(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
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

it("asks before leaving a changed page, and Keep keeps the rows", async () => {
  const el = await mount();
  expect(unload()).toBe(false);
  await change(el, "Deep winter");
  expect(unload()).toBe(true);
  const close = app.leavePage();
  await choose("keep");
  expect(await close).toBe("kept");
  expect(nameField(el).value).toBe("Deep winter");
  const discard = app.leavePage();
  await choose("discard");
  expect(await discard).toBe("proceeded");
  await el.updateComplete;
  expect(nameField(el).value).toBe("Winter");
  expect(unload()).toBe(false);
});

it("restoring the saved values lets navigation proceed without asking", async () => {
  const el = await mount();
  await change(el, "Cold");
  await change(el, "Winter");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  expect(unload()).toBe(false);
  expect(await app.leavePage()).toBe("proceeded");
  expect(question().open).toBe(false);
});

it("a draft parented to the page root is asked about only for that root", async () => {
  const el = await mount();
  await change(el, "Cold");
  const coordinator = app.leave.coordinator;
  expect(coordinator.isDirty([app.windowRoot])).toBe(true);
  expect(coordinator.isDirty([{}])).toBe(false);
  expect(await coordinator.request({ scopes: [{}], reason: "navigation", proceed() {} })).toBe(
    "proceeded",
  );
  expect(question().open).toBe(false);
  expect(nameField(el).value).toBe("Cold");
});
