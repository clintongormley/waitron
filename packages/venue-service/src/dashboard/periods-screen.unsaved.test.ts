import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { PeriodDialog } from "./period-dialog.js";
import "./periods-screen.js";

function model(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [
      { id: "lunch", name: "Lunch menu", active: true, includes: [] },
      { id: "dinner", name: "Dinner menu", active: true, includes: [] },
    ],
    seasons: [],
    currentSeasonId: null,
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [],
        seasonWeeks: [],
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "blue",
            menuId: "lunch",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1],
            routingUses: [],
          },
        ],
      },
    ],
  };
}

class PeriodsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly writes: unknown[][] = [];
  readonly api = new OpeningHoursApi((async (path, method, body) => {
    if (method !== "GET") {
      this.writes.push([path, method, body]);
      return;
    }
    if (path.endsWith("/menu-periods/painted-in"))
      return [{ periodId: "p1", seasons: [], specialDays: [] }];
    return model();
  }) as DashboardRequest);
  override render() {
    return html`<dashboard-periods-screen .api=${this.api}></dashboard-periods-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("periods-leave-test-app", PeriodsLeaveApp);
let app: PeriodsLeaveApp;
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("periods-leave-test-app") as PeriodsLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector("dashboard-periods-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
  const table =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector<PeriodDialog>("period-dialog")!;
  expect(editor, "period dialog opens").not.toBeNull();
  await editor.updateComplete;
  return { screen, editor };
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function change(editor: PeriodDialog) {
  editor
    .shadowRoot!.querySelector<HTMLElement>("[name=name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Dinner" }, bubbles: true, composed: true }),
    );
  await editor.updateComplete;
}
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  const question =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

describe.each(["en", "es"])("Periods discard (%s)", (locale) => {
  it("asks before closing and preserves or discards the changed period", async () => {
    setLocale(locale);
    const { screen, editor } = await mount();
    expect(unload()).toBe(false);
    await change(editor);
    expect(unload()).toBe(true);
    const modal = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
    const keep = modal.requestClose("cancel");
    await choose("keep");
    expect(await keep).toBe(false);
    expect(
      editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
    ).toBe("Dinner");
    const discard = modal.requestClose("escape");
    await choose("discard");
    expect(await discard).toBe(true);
    await expect.poll(() => screen.shadowRoot!.querySelector("period-dialog")).toBeNull();
    expect(unload()).toBe(false);
  });
  it.each(["before", "after"])(
    "keeps discard protection for an edit made %s reconnect",
    async (when) => {
      setLocale(locale);
      const { screen, editor } = await mount();
      if (when === "before") await change(editor);
      const parent = screen.parentNode!;
      screen.remove();
      expect(unload()).toBe(false);
      parent.appendChild(screen);
      await screen.updateComplete;
      await editor.updateComplete;
      if (when === "after") await change(editor);
      expect(unload()).toBe(true);
      const close = editor
        .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!
        .requestClose("cancel");
      await choose("keep");
      expect(await close).toBe(false);
      expect(screen.shadowRoot!.querySelector("period-dialog")).toBe(editor);
    },
  );
});

it("changing only the period's menu protects the draft and restoring it makes it clean", async () => {
  setLocale("en");
  const { editor } = await mount();
  const menu =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=menuId]")!;
  menu.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "dinner" }, bubbles: true, composed: true }),
  );
  await editor.updateComplete;
  expect(unload()).toBe(true);
  menu.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "lunch" }, bubbles: true, composed: true }),
  );
  await editor.updateComplete;
  expect(unload()).toBe(false);
  expect(app.writes).toEqual([]);
});
