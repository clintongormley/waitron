import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  frame,
  painterModel,
  part,
  settle,
  specialDayApi,
  storedDay,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = specialDayApi([], { days: { sd1: storedDay() } });
  model = painterModel();
  override render() {
    return html`<special-day-painter
        .api=${this.api}
        .model=${this.model}
        .open=${true}
        .specialDayId=${"sd1"}
      ></special-day-painter
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("special-day-painter-leave-app", PainterApp);

let app: PainterApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount(): Promise<SpecialDayPainter> {
  app = document.createElement("special-day-painter-leave-app") as PainterApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const painter: SpecialDayPainter = app.shadowRoot!.querySelector("special-day-painter")!;
  await settle(painter);
  await expect.poll(() => part(painter, "loading")).toBeNull();
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
const dismiss = (painter: SpecialDayPainter) =>
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
const tick = (painter: SpecialDayPainter) =>
  painter.shadowRoot!.querySelector<HTMLInputElement>('input[name="closed.2026-12-14"]')!;

it("✕ with no edits closes at once", async () => {
  const painter = await mount();
  dismiss(painter);
  await expect.poll(() => painter.open).toBe(false);
  expect(question().open).toBe(false);
});

it("✕ with edits asks first: Keep stays with the edit, Discard closes", async () => {
  const painter = await mount();
  tick(painter).click();
  await settle(painter);
  dismiss(painter);
  await choose("keep");
  expect(painter.open).toBe(true);
  expect(tick(painter).checked).toBe(true);
  dismiss(painter);
  await choose("discard");
  await expect.poll(() => painter.open).toBe(false);
});

it("undoing an edit makes Save quiet again and ✕ closes without asking", async () => {
  const painter = await mount();
  tick(painter).click();
  await settle(painter);
  tick(painter).click();
  await settle(painter);
  expect(
    frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save]",
    )!.disabled,
  ).toBe(true);
  dismiss(painter);
  await expect.poll(() => painter.open).toBe(false);
  expect(question().open).toBe(false);
});

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
it.each(["before", "after"])(
  "an edit made %s the painter is taken off the page and put back still asks before leaving",
  async (when) => {
    const painter = await mount();
    if (when === "before") {
      tick(painter).click();
      await settle(painter);
    }
    const parent = painter.parentNode!;
    painter.remove();
    await painter.updateComplete;
    expect(unload()).toBe(false);
    parent.insertBefore(painter, parent.firstChild);
    await settle(painter);
    if (when === "after") {
      tick(painter).click();
      await settle(painter);
    }
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("keep");
    expect(await request).toBe("kept");
    expect(tick(painter).checked).toBe(true);
    expect(unload()).toBe(true);
  },
);
