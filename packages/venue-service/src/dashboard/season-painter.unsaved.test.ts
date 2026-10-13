import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SeasonPainter } from "./season-painter.js";
import {
  drag,
  frame,
  grid,
  painterApi,
  painterModel,
  settle,
} from "../testing/season-painter-fixture.js";
import "./season-painter.js";

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = painterApi();
  readonly model = painterModel();
  override render() {
    return html`<season-painter
        .api=${this.api}
        .model=${this.model}
        .open=${true}
        seasonId="winter"
        departmentId="d1"
      ></season-painter
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("season-painter-leave-app", PainterApp);

let app: PainterApp;
beforeEach(() => setLocale("en"));
afterEach(() => {
  app?.remove();
  setLocale("en");
});
async function mount() {
  app = document.createElement("season-painter-leave-app") as PainterApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const painter = app.shadowRoot!.querySelector<SeasonPainter>("season-painter")!;
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
const save = (painter: SeasonPainter) =>
  frame(painter).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
const button = (painter: SeasonPainter, test: string) =>
  painter.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
async function paintWednesday(painter: SeasonPainter) {
  button(painter, "paint-p2").click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
}

it("keeps Save quiet until a real paint drag, and quiet again once the drag is undone", async () => {
  const painter = await mount();
  expect(save(painter).disabled).toBe(true);
  expect(save(painter).variant).toBe("secondary");
  button(painter, "paint-p2").click();
  await settle(painter);
  expect(save(painter).disabled).toBe(true);
  await paintWednesday(painter);
  expect(save(painter).disabled).toBe(false);
  expect(save(painter).variant).toBe("primary");
  button(painter, "paint-closed").click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  expect(grid(painter).days.get("3")).toEqual([]);
  expect(save(painter).disabled).toBe(true);
});

it("stepping seasons with edits asks first: Keep stays, Discard moves on with a fresh draft", async () => {
  const painter = await mount();
  await paintWednesday(painter);
  button(painter, "next-season").click();
  await choose("keep");
  await settle(painter);
  expect(frame(painter).heading).toBe("Winter week");
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
  button(painter, "next-season").click();
  await choose("discard");
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(grid(painter).days.get("3")).toEqual([]);
  expect(save(painter).disabled).toBe(true);
  button(painter, "previous-season").click();
  await settle(painter);
  expect(question().open).toBe(false);
  expect(frame(painter).heading).toBe("Winter week");
  expect(grid(painter).days.get("3")).toEqual([]);
});

it("✕ with edits asks first", async () => {
  const painter = await mount();
  await paintWednesday(painter);
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await choose("keep");
  expect(painter.open).toBe(true);
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await choose("discard");
  await expect.poll(() => painter.open).toBe(false);
});
