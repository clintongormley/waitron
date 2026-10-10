import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import {
  leaveCoordinatorFor,
  navigationGuardFor,
  type WtButton,
  type WtFloorPlanCanvas,
} from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import { DashboardApp } from "../dashboard-app.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
  setLocale("en-GB");
});

const placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
const plan = (zoneId: string, id: string): FloorPlan => ({
  zoneId,
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    { id, liveTableId: `l-${id}`, label: id.toUpperCase(), seats: 4, fixed: false, placement },
  ],
  joins: [],
});

async function mount() {
  history.replaceState(null, "", "/manage/floor-plan/zone/z1?back=%2Fmanage%2Foverview");
  const api = {
    liveData: new LiveData(),
    getMe: async () => ({
      personId: "p1",
      email: "ada@example.com",
      role: "manager",
      locale: "en-GB",
      venueLocale: "en-GB",
      sessionDefault: "en-GB",
      venueName: "Venue",
      permissions: ["venue.view", "venue.configure"],
      modules: [],
    }),
    getLocales: async () => ({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
      loginDefault: "en-GB",
      venueName: "Venue",
      onboardingIntent: "prepare",
    }),
    getGoogleConfig: async () => ({ configured: false }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    passkeySignals: async () => ({
      rpId: "localhost",
      userId: "cDE",
      credentialIds: [],
      name: "ada@example.com",
      displayName: "Ada",
    }),
    getFloorPlan: vi.fn(async (zoneId: string) =>
      zoneId === "z2" ? plan("z2", "b1") : plan("z1", "m1"),
    ),
    listZones: async () => [
      { id: "z1", name: "Terrace", displayOrder: 0, active: true },
      { id: "z2", name: "Bar", displayOrder: 1, active: true },
    ],
    listTables: async () => [],
    saveFloorPlan: vi.fn(async (): Promise<{ revision: number; ids: Record<string, string> }> => ({
      revision: 4,
      ids: { m1: "m1" },
    })),
  };
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api: api as unknown as DashboardApi,
  });
  await expect.poll(() => canvasOf(editor(app))).not.toBeUndefined();
  return { app, api };
}

const editor = (app: DashboardApp) =>
  app.shadowRoot!.querySelector<FloorPlanEditor>("dashboard-floor-plan-editor")!;
const canvasOf = (el: FloorPlanEditor | null) =>
  el?.shadowRoot?.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas") ?? undefined;
const button = (el: FloorPlanEditor, action: string) =>
  el.shadowRoot!.querySelector<WtButton>(`wt-button[data-action=${action}]`)!;
const placed = (el: FloorPlanEditor, key: string) =>
  canvasOf(el)!.tables.find((t) => t.key === key)!.placement!;
const question = (app: DashboardApp) => app.shadowRoot!.querySelector("wt-unsaved-changes")!;

async function move(el: FloorPlanEditor, x = 5, y = 4) {
  canvasOf(el)!.dispatchEvent(
    new CustomEvent("wt-table-move", {
      detail: { key: "m1", x, y },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
async function undo(el: FloorPlanEditor) {
  button(el, "undo").click();
  await el.updateComplete;
}
function close(el: FloorPlanEditor) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-action=close]")!.click();
}
async function choose(app: DashboardApp, decision: "keep" | "discard") {
  const warning = question(app);
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("an untouched editor closes without asking", async () => {
  const { app } = await mount();
  close(editor(app));
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(question(app).open).toBe(false);
});

it("Close asks after a move, and Keep stays with the move", async () => {
  const { app } = await mount();
  const el = editor(app);
  await move(el);
  close(el);
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/floor-plan/zone/z1");
  expect(placed(el, "m1").x).toBe(5);
});

it("Discard on Close leaves and writes nothing", async () => {
  const { app, api } = await mount();
  const el = editor(app);
  await move(el);
  close(el);
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(api.saveFloorPlan).not.toHaveBeenCalled();
});

it("undoing every change closes without asking", async () => {
  const { app } = await mount();
  const el = editor(app);
  await move(el);
  await undo(el);
  close(el);
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(question(app).open).toBe(false);
});

it("a table moved by hand back to where it was closes without asking", async () => {
  const { app } = await mount();
  const el = editor(app);
  await move(el);
  await move(el, placement.x, placement.y);
  expect(button(el, "undo").disabled).toBe(false);
  close(el);
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(question(app).open).toBe(false);
});

it("a sidebar link asks before leaving a changed plan", async () => {
  const { app } = await mount();
  const el = editor(app);
  await move(el);
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/floor-plan/zone/z1");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
});

it("opening another zone's editor asks first, and Discard opens it fresh", async () => {
  const { app, api } = await mount();
  const el = editor(app);
  await move(el);
  void navigationGuardFor(window)!.write(new URL("/manage/floor-plan/zone/z2", location.origin));
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/floor-plan/zone/z2");
  expect(api.getFloorPlan).toHaveBeenLastCalledWith("z2");
  await expect.poll(() => canvasOf(editor(app))?.tables.map((t) => t.key)).toEqual(["b1"]);
  expect(button(editor(app), "undo").disabled).toBe(true);
});

it("the browser's unload prompt holds a changed plan", async () => {
  const { app } = await mount();
  const el = editor(app);
  expect(unload()).toBe(false);
  await move(el);
  expect(unload()).toBe(true);
  await undo(el);
  expect(unload()).toBe(false);
});

it("refused text standing in a field holds the plan, though the draft is unchanged", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(1280, 800);
  onTestFinished(() => page.viewport(...before));
  const { app } = await mount();
  const el = editor(app);
  canvasOf(el)!.dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m1" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const panel = el.shadowRoot!.querySelector("floor-plan-table-panel")!;
  await panel.updateComplete;
  const input = panel
    .shadowRoot!.querySelector("[name=width]")!
    .shadowRoot!.querySelector("input")!;
  await userEvent.clear(input);
  await userEvent.type(input, "8.");
  await el.updateComplete;
  expect(placed(el, "m1").width).toBe(8);
  expect(unload()).toBe(true);
  close(el);
  await choose(app, "keep");
  await userEvent.type(input, "{Backspace}");
  await el.updateComplete;
  expect(unload()).toBe(false);
});

it("put back after a detached update, the editor still asks before Close discards a change", async () => {
  const { app } = await mount();
  const el = editor(app);
  await reattachAfterDetachedUpdate(el);
  await move(el);
  close(el);
  await expect.poll(() => question(app).open).toBe(true);
  expect(location.pathname).toBe("/manage/floor-plan/zone/z1");
});

it("a departed save's answer cannot change a reconnected editor", async () => {
  const { app, api } = await mount();
  let answer!: (value: { revision: number; ids: Record<string, string> }) => void;
  api.saveFloorPlan.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  const el = editor(app);
  await move(el);
  button(el, "save").click();
  await expect.poll(() => api.saveFloorPlan.mock.calls.length).toBe(1);
  const parent = el.parentNode!;
  el.remove();
  parent.append(el);
  await el.updateComplete;
  answer({ revision: 4, ids: { m1: "m1" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(button(el, "save").variant).toBe("primary");
  expect(api.getFloorPlan).toHaveBeenCalledTimes(1);
  close(el);
  await expect.poll(() => question(app).open).toBe(true);
  expect(location.pathname).toBe("/manage/floor-plan/zone/z1");
  await choose(app, "keep");
  button(el, "save").click();
  await expect.poll(() => api.saveFloorPlan.mock.calls.length).toBe(2);
});

it("an edit made while a save is sent still asks on Close once the save is accepted", async () => {
  const { app, api } = await mount();
  let answer!: (value: { revision: number; ids: Record<string, string> }) => void;
  api.saveFloorPlan.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  const el = editor(app);
  await move(el);
  button(el, "save").click();
  await expect.poll(() => api.saveFloorPlan.mock.calls.length).toBe(1);
  await move(el, 7);
  answer({ revision: 4, ids: { m1: "m1" } });
  await expect.poll(() => api.getFloorPlan.mock.calls.length).toBe(2);
  await el.updateComplete;
  expect(placed(el, "m1").x).toBe(7);
  close(el);
  await expect.poll(() => question(app).open).toBe(true);
  expect(location.pathname).toBe("/manage/floor-plan/zone/z1");
});

it("an accepted save leaves without asking", async () => {
  const { app, api } = await mount();
  const el = editor(app);
  await move(el);
  button(el, "save").click();
  await expect.poll(() => api.getFloorPlan.mock.calls.length).toBe(2);
  await el.updateComplete;
  close(el);
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(question(app).open).toBe(false);
});

it("a leave asked of the editor alone asks about a changed Add tables", async () => {
  const { app } = await mount();
  const el = editor(app);
  el.shadowRoot!.querySelector("floor-plan-tables-panel")!
    .shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!
    .click();
  const dialog = el.shadowRoot!.querySelector("floor-plan-add-tables")!;
  await dialog.updateComplete;
  await chooseOption(dialog.shadowRoot!.querySelector("[name=table-count]")!, "3");
  await dialog.updateComplete;
  const proceed = vi.fn();
  // The editor's own scope names the editor element as its parent.
  const outcome = leaveCoordinatorFor(el)!.request({ scopes: [el], reason: "navigation", proceed });
  await choose(app, "keep");
  expect(await outcome).toBe("kept");
  expect(proceed).not.toHaveBeenCalled();
});
