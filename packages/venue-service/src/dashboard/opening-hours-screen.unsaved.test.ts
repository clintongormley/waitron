import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { PeriodEditor } from "./period-editor.js";
import "./opening-hours-screen.js";

class OpeningLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly writes: unknown[][] = [];
  readonly api = new OpeningHoursApi((async (path, method, body) => {
    if (method !== "GET") {
      this.writes.push([path, method, body]);
      return;
    }
    return {
      timeZone: "Europe/Madrid",
      clockReadable: true,
      dayCutover: "06:00",
      specialDates: [],
      menus: [
        { id: "lunch", name: "Lunch menu", active: true, includes: [] },
        { id: "dinner", name: "Dinner menu", active: true, includes: [] },
      ],
      departments: [
        {
          id: "restaurant",
          name: "Restaurant",
          active: true,
          week: [],
          dates: [],
          periods: [
            {
              id: "p1",
              name: "Lunch",
              colour: "blue",
              menuId: "lunch",
              staffMenuIds: [],
              weekdays: [1],
            },
          ],
        },
      ],
    };
  }) as DashboardRequest);
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("opening-leave-test-app", OpeningLeaveApp);
let app: OpeningLeaveApp;
const originalUrl = location.href;
beforeEach(() => history.replaceState(null, "", "/manage/opening-hours/view/periods"));
afterEach(() => {
  app?.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
async function mount() {
  app = document.createElement("opening-leave-test-app") as OpeningLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
  const table =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector<PeriodEditor>("period-editor")!;
  await editor.updateComplete;
  return { screen, editor };
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function change(editor: PeriodEditor) {
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

describe.each(["en", "es"])("Opening hours discard (%s)", (locale) => {
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
    await expect.poll(() => screen.shadowRoot!.querySelector("period-editor")).toBeNull();
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
      expect(screen.shadowRoot!.querySelector("period-editor")).toBe(editor);
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

it("Cancel and native Escape close a period deletion without creating a draft or a write", async () => {
  setLocale("en");
  const { screen, editor } = await mount();
  await editor
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!
    .requestClose("cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("period-editor")).toBeNull();
  const table =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
  for (const reason of ["cancel", "escape"] as const) {
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-period]")!.click();
    await screen.updateComplete;
    const dialog =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog")!;
    await dialog.updateComplete;
    expect(dialog.open).toBe(true);
    expect(unload()).toBe(false);
    if (reason === "cancel")
      screen.shadowRoot!.querySelector<HTMLElement>('[slot="cancel"]')!.click();
    else await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-dialog")).toBeNull();
    expect(
      app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!.open,
    ).toBe(false);
  }
  expect(app.writes).toEqual([]);
});
