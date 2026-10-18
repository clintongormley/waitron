import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, type WtFloorPlanCanvas } from "@waitron/ui";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import "./floor-plan-editor.js";
import { currentLocale, setLocale } from "../i18n/t.js";

const originalUrl = location.href;
const plan: FloorPlan = {
  zoneId: "z1",
  setId: "s1",
  setName: "Standard",
  revision: 3,
  savedAt: "2026-10-01T10:00:00Z",
  tables: [
    {
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
      partIds: [],
      keptSize: null,
    },
  ],
};
class App extends LitElement {
  readonly leave = new LeaveController(this);
  readonly live = new LiveData();
  zones: Awaited<ReturnType<DashboardApi["listZones"]>> = [
    { id: "z1", name: "Terrace", displayOrder: 0, active: true },
    { id: "z2", name: "Bar", displayOrder: 1, active: true },
  ];
  readonly save = vi.fn(async (): Promise<Awaited<ReturnType<DashboardApi["saveFloorPlan"]>>> => ({
    revision: 4,
    ids: { m1: "m1" },
  }));
  readonly read = vi.fn(async () => plan);
  readonly api = {
    liveData: this.live,
    getFloorPlan: this.read,
    listZones: async () => this.zones,
    listTables: async () => [],
    saveFloorPlan: this.save,
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-floor-plan-editor .api=${this.api}></dashboard-floor-plan-editor
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("deleted-floor-owner-app", App);
let app: App;
let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  app?.remove();
  history.replaceState(null, "", originalUrl);
});
async function mount() {
  history.replaceState(null, "", "/manage/floor-plan/set/s1/zone/z1");
  app = document.createElement("deleted-floor-owner-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const editor = app.shadowRoot!.querySelector("dashboard-floor-plan-editor")!;
  await expect.poll(() => editor.shadowRoot?.querySelector("wt-floor-plan-canvas")).not.toBeNull();
  const canvas = editor.shadowRoot!.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas")!;
  canvas.dispatchEvent(
    new CustomEvent("wt-table-move", {
      detail: { key: "m1", x: 6, y: 3 },
      bubbles: true,
      composed: true,
    }),
  );
  await editor.updateComplete;
  return editor;
}
async function deleted() {
  app.zones = app.zones.filter((zone) => zone.id !== "z1");
  app.live.invalidate([{ type: "floor_zones" }]);
}
it("a deleted zone retires the same dirty editor and ignores its late save", async () => {
  const editor = await mount();
  let resolve!: (value: { revision: number; ids: Record<string, string> }) => void;
  app.save.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  editor.shadowRoot!.querySelector<HTMLElement>("[data-action=save]")!.click();
  await expect.poll(() => app.save.mock.calls.length).toBe(1);
  await deleted();
  await expect.poll(() => editor.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
  resolve({ revision: 4, ids: { m1: "m1" } });
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each(["keep", "discard"] as const)(
  "deletion invalidates pending %s on the retained floor owner",
  async (decision) => {
    const editor = await mount();
    const outcome = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed: () => {},
    });
    await app.updateComplete;
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    const stale = question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!;
    await deleted();
    await expect.poll(() => editor.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
    stale.click();
    expect(await outcome).toBe("stale");
    await editor.updateComplete;
    expect(editor.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
    expect(app.save).not.toHaveBeenCalled();
  },
);
it("deleting another zone keeps the floor move and Save/Undo", async () => {
  const editor = await mount();
  app.zones = app.zones.filter((zone) => zone.id !== "z2");
  app.live.invalidate([{ type: "floor_zones" }]);
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas")!.tables[0]!
      .placement!.x,
  ).toBe(6);
  expect(app.leave.coordinator.isDirty()).toBe(true);
  editor.shadowRoot!.querySelector<HTMLElement>("[data-action=undo]")!.click();
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas")!.tables[0]!
      .placement!.x,
  ).toBe(2);
});
it("a plan read that finishes after deletion cannot reopen the same owner", async () => {
  history.replaceState(null, "", "/manage/floor-plan/set/s1/zone/z1");
  app = document.createElement("deleted-floor-owner-app") as App;
  let finish!: (value: FloorPlan) => void;
  app.read.mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const editor = app.shadowRoot!.querySelector("dashboard-floor-plan-editor")!;
  await expect.poll(() => app.read.mock.calls.length).toBe(1);
  await deleted();
  await expect
    .poll(() => editor.shadowRoot?.querySelector("[data-load-error]")?.textContent ?? "")
    .toContain("zone");
  finish(plan);
  await new Promise((done) => setTimeout(done, 0));
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each([false, true])(
  "zone-watch recovery clears its read failure and preserves a newer action refusal (%s)",
  async (action) => {
    const editor = await mount();
    const read = app.api.listZones;
    app.api.listZones = async () => {
      throw { code: "server.internal" };
    };
    app.live.invalidate([{ type: "floor_zones" }]);
    const message = () => editor.shadowRoot!.querySelector("wt-form-actions")!.error;
    await expect.poll(message).toBe("Something went wrong, try again");
    if (action) {
      app.save.mockRejectedValueOnce({ code: "permission.denied" });
      editor.shadowRoot!.querySelector<HTMLElement>("[data-action=save]")!.click();
      await expect.poll(message).not.toBe("Something went wrong, try again");
    }
    const refusal = message();
    const recovered = vi.fn(read);
    app.api.listZones = recovered;
    app.live.invalidate([{ type: "floor_zones" }]);
    await expect.poll(() => recovered.mock.calls.length).toBe(1);
    await editor.updateComplete;
    if (action) {
      await editor.updateComplete;
      expect(message()).toBe(refusal);
    } else await expect.poll(message).toBe("");
  },
);
