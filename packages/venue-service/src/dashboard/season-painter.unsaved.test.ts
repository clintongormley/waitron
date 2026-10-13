import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  pick,
  settle,
} from "../testing/season-painter-fixture.js";
import "./season-painter.js";

class PainterApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = painterApi();
  model = painterModel();
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

const dismiss = (painter: SeasonPainter) =>
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();

it("after ✕ and Discard, the next save sends the clock revision the model now holds", async () => {
  const painter = await mount();
  const sent = vi.spyOn(painter.api, "saveSeasonWeeks");
  await paintWednesday(painter);
  app.model = { ...painterModel(), clockRevision: 11 };
  app.requestUpdate();
  await app.updateComplete;
  await settle(painter);
  dismiss(painter);
  await choose("discard");
  await expect.poll(() => painter.open).toBe(false);
  painter.open = true;
  await settle(painter);
  await paintWednesday(painter);
  save(painter).click();
  await expect.poll(() => sent.mock.calls.length).toBe(1);
  expect(sent.mock.calls[0]![2]).toBe(11);
});

it("Discard clears a removal notice and a refused save's message", async () => {
  const painter = await mount();
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  await paintWednesday(painter);
  const next = painterModel();
  const restaurant = next.departments[0]!;
  app.model = {
    ...next,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...next.departments.slice(1),
    ],
  };
  app.requestUpdate();
  await app.updateComplete;
  await settle(painter);
  expect(frame(painter).refusal).toBe("Terrace was removed; its changes were dropped.");
  const discard = async () => {
    const left = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("discard");
    await left;
    await settle(painter);
  };
  await discard();
  expect(frame(painter).refusal).toBe("");
  vi.spyOn(painter.api, "saveSeasonWeeks").mockRejectedValueOnce({ code: "season.not_found" });
  await paintWednesday(painter);
  save(painter).click();
  await expect.poll(() => frame(painter).refusal).toBe("This could not be saved. Try again.");
  await expect.poll(() => frame(painter).busy).toBe(false);
  await discard();
  expect(frame(painter).refusal).toBe("");
  expect(frame(painter).open).toBe(true);
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
    if (when === "before") await paintWednesday(painter);
    const parent = painter.parentNode!;
    painter.remove();
    expect(unload()).toBe(false);
    parent.insertBefore(painter, parent.firstChild);
    await settle(painter);
    if (when === "after") await paintWednesday(painter);
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("keep");
    expect(await request).toBe("kept");
    expect(grid(painter).days.get("3")).toEqual([
      { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
    ]);
    expect(unload()).toBe(true);
  },
);
