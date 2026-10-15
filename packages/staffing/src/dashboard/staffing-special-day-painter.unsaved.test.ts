import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController, registerIcons } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { StaffingBlock } from "../slots.js";
import type { StaffingGrid } from "./staffing-grid.js";
import type { StaffingSpecialDayPainter } from "./staffing-special-day-painter.js";
import { headChef } from "../testing/season-staffing-fixture.js";
import { specialDayApi } from "../testing/special-day-staffing-fixture.js";
import "./staffing-special-day-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = specialDayApi().api;
  readonly open = vi.fn();
  override render() {
    return html`<staffing-special-day-painter
        .api=${this.api}
        .open=${this.open}
        specialDayId="xmas"
        month="2026-12"
      ></staffing-special-day-painter
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("staffing-special-day-painter-leave-app", PainterApp);

let app: PainterApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function settle(el: StaffingSpecialDayPainter) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
}
async function mount() {
  app = document.createElement("staffing-special-day-painter-leave-app") as PainterApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const painter = app.shadowRoot!.querySelector<StaffingSpecialDayPainter>(
    "staffing-special-day-painter",
  )!;
  await settle(painter);
  return painter;
}
const question = () =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>("wt-unsaved-changes")!;
async function choose(decision: "keep" | "discard") {
  await app.updateComplete;
  await expect.poll(() => question().open).toBe(true);
  await question().updateComplete;
  question().shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question().open).toBe(false);
}
const frame = (painter: StaffingSpecialDayPainter) =>
  painter.shadowRoot!.querySelector<HTMLElementTagNameMap["painter-frame"]>("painter-frame")!;
const grid = (painter: StaffingSpecialDayPainter) =>
  painter.shadowRoot!.querySelector<StaffingGrid>("staffing-grid")!;
const frameButton = (painter: StaffingSpecialDayPainter, test: string) =>
  frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=${test}]`,
  )!;
const dinner: StaffingBlock = {
  staffRoleId: "sc",
  headcount: 1,
  startsAt: "19:00",
  endsAt: "23:00",
};
async function paint(
  painter: StaffingSpecialDayPainter,
  key: string,
  blocks: StaffingBlock[] | null,
) {
  grid(painter).dispatchEvent(
    new CustomEvent("staffing-change", { detail: { key, blocks }, bubbles: true, composed: true }),
  );
  await settle(painter);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("keeps Save quiet until a date changes, and quiet again once the change is undone", async () => {
  const painter = await mount();
  expect(frameButton(painter, "save").disabled).toBe(true);
  expect(frameButton(painter, "save").variant).toBe("secondary");
  await paint(painter, "day", [dinner]);
  expect(frameButton(painter, "save").disabled).toBe(false);
  expect(frameButton(painter, "save").variant).toBe("primary");
  expect(unload()).toBe(true);
  await paint(painter, "day", null);
  expect(frameButton(painter, "save").disabled).toBe(true);
  expect(unload()).toBe(false);
});

it.each(["dismiss", "cancel"])(
  "%s with edits asks first: Keep stays, Discard returns to the month",
  async (button) => {
    const painter = await mount();
    await paint(painter, "eve", null);
    frameButton(painter, button).click();
    await choose("keep");
    expect(frame(painter).open).toBe(true);
    expect(grid(painter).days.get("eve")).toBeNull();
    expect(app.open).not.toHaveBeenCalled();
    frameButton(painter, button).click();
    await choose("discard");
    await expect.poll(() => app.open.mock.calls.length).toBe(1);
    expect(app.open).toHaveBeenCalledWith("staffing", { month: "2026-12" });
    expect(grid(painter).days.get("eve")).toEqual([headChef]);
  },
);

it("closes without asking when nothing changed", async () => {
  const painter = await mount();
  frameButton(painter, "cancel").click();
  await expect.poll(() => app.open.mock.calls.length).toBe(1);
  expect(question().open).toBe(false);
});

it("an edit kept while the painter is taken off the page and put back still asks before leaving", async () => {
  const painter = await mount();
  await paint(painter, "day", [dinner]);
  const parent = painter.parentNode!;
  painter.remove();
  expect(unload()).toBe(false);
  parent.insertBefore(painter, parent.firstChild);
  await settle(painter);
  expect(unload()).toBe(true);
  const request = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose("keep");
  expect(await request).toBe("kept");
  expect(grid(painter).days.get("day")).toEqual([dinner]);
});

it("an edit kept while the painter is put back in a later task still asks before leaving", async () => {
  const painter = await mount();
  await paint(painter, "day", [dinner]);
  const parent = painter.parentNode!;
  painter.remove();
  await new Promise((resolve) => setTimeout(resolve, 20));
  parent.insertBefore(painter, parent.firstChild);
  await settle(painter);
  expect(unload()).toBe(true);
});
