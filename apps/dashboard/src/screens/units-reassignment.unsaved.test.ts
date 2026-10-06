import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, ProductUsingUnit } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./units-screen.js";

registerIcons(DASHBOARD_ICONS);
class ReassignmentLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-units-screen .api=${this.api}></dashboard-units-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("reassignment-leave-test-app", ReassignmentLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const products: ProductUsingUnit[] = [
  { id: "p1", name: "Soup", active: true },
  { id: "p2", name: "Tea", active: false },
];
async function fixture(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const api = {
    listUnits: async () => [
      { id: "u1", name: { en: "Gram" }, abbreviation: { en: "g" }, precision: 3 },
      { id: "u2", name: { en: "Kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
    ],
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listUnitProducts: async () => products,
    reassignProductsUnit: vi.fn().mockResolvedValue([products[1]]),
    deleteUnit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  const { el: app } = await mountWidget<ReassignmentLeaveApp>("reassignment-leave-test-app", {
    api,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-units-screen")!;
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-data-table")!.rows).toHaveLength(2),
  );
  const list = screen.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>('[data-row-key="u1"] .row-activate')!.click();
  const modal = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    "[data-test=in-use-dialog]",
  )!;
  await expect.poll(() => modal.open).toBe(true);
  await screen.updateComplete;
  await modal.updateComplete;
  return { app, api, screen, modal };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function select(f: Fixture, ids = ["p1"]) {
  const toggle = f.modal.querySelector<HTMLElement>("[data-test=select-products]")!;
  const table = f.modal.querySelector("wt-data-table")!;
  if (!table.selectable) {
    toggle.click();
    await f.screen.updateComplete;
    await table.updateComplete;
  }
  table.dispatchEvent(
    new CustomEvent("wt-selection-change", {
      detail: { selected: ids },
      bubbles: true,
      composed: true,
    }),
  );
  await f.screen.updateComplete;
  await table.updateComplete;
}
async function target(f: Fixture, value = "u2") {
  await chooseOption(f.modal.querySelector("wt-combobox")!, value);
  await f.screen.updateComplete;
}
async function question(app: ReassignmentLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(f: Fixture, decision: "keep" | "discard") {
  const q = await question(f.app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await q.updateComplete;
}
function unloadProtected() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function cancel(f: Fixture, route: "cancel" | "escape") {
  const button = f.modal.querySelector<HTMLElement>("[data-test=cancel-in-use]")!;
  button.focus();
  if (route === "cancel") button.click();
  else {
    button.focus();
    await userEvent.keyboard("{Escape}");
  }
}
for (const route of ["cancel", "escape"] as const) {
  it(`${route} keeps reassignment selections and target until explicit local Discard`, async () => {
    const f = await fixture();
    await select(f);
    await target(f);
    expect(unloadProtected()).toBe(true);
    await cancel(f, route);
    expect((await question(f.app)).open).toBe(true);
    expect(f.modal.open).toBe(true);
    await choose(f, "keep");
    expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
    expect(f.modal.querySelector("wt-combobox")!.value).toBe("u2");
    await expect
      .poll(
        () =>
          f.modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-in-use]")!
            .shadowRoot!.activeElement?.tagName,
      )
      .toBe("BUTTON");
    await cancel(f, route);
    await choose(f, "discard");
    await expect.poll(() => f.modal.open).toBe(false);
    expect(f.api.reassignProductsUnit).not.toHaveBeenCalled();
    expect(f.api.deleteUnit).not.toHaveBeenCalled();
    expect(unloadProtected()).toBe(false);
    const list = f.screen.shadowRoot!.querySelector("wt-data-table")!;
    list.shadowRoot!.querySelector<HTMLElement>('[data-row-key="u1"] .row-activate')!.click();
    await expect.poll(() => f.modal.open).toBe(true);
    expect(f.modal.querySelector("wt-data-table")!.selected).toEqual([]);
    expect(f.modal.querySelector("wt-combobox")!.value).toBe("");
  });
}
for (const changed of ["selection", "target"] as const) {
  it(`protects a reassignment ${changed} before the other field is filled`, async () => {
    const f = await fixture();
    if (changed === "selection") await select(f);
    else await target(f, "__each__");
    expect(unloadProtected()).toBe(true);
    await cancel(f, "cancel");
    expect((await question(f.app)).open).toBe(true);
    await choose(f, "keep");
    expect(f.modal.open).toBe(true);
    expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(
      changed === "selection" ? ["p1"] : [],
    );
    expect(f.modal.querySelector("wt-combobox")!.value).toBe(
      changed === "target" ? "__each__" : "",
    );
  });
}
it("untouched, search-only and reverted reassignment closes without a warning", async () => {
  const f = await fixture();
  const search = f.modal.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=in-use-search]",
  )!;
  await search.updateComplete;
  await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Soup");
  expect(unloadProtected()).toBe(false);
  await select(f);
  await target(f);
  await select(f, []);
  await target(f, "");
  expect(unloadProtected()).toBe(false);
  await cancel(f, "escape");
  await expect.poll(() => f.modal.open).toBe(false);
  expect((await question(f.app)).open).toBe(false);
  expect(f.api.reassignProductsUnit).not.toHaveBeenCalled();
});
for (const succeeds of [true, false]) {
  it(`direct reassignment ${succeeds ? "clears only its accepted entry" : "refusal retains exact retry values"}`, async () => {
    const reassign = vi.fn(async () => {
      if (!succeeds) throw { code: "unit.not_found" };
      return [products[1]];
    });
    const f = await fixture({ reassignProductsUnit: reassign });
    await select(f);
    await target(f, "__each__");
    f.modal.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
    await expect.poll(() => reassign.mock.calls.length).toBe(1);
    expect(reassign).toHaveBeenCalledExactlyOnceWith("u1", ["p1"], null);
    await expect
      .poll(() => f.modal.querySelector("[data-test=change-unit]")!.hasAttribute("disabled"))
      .toBe(succeeds);
    expect(unloadProtected()).toBe(!succeeds);
    await cancel(f, "cancel");
    if (succeeds) {
      await expect.poll(() => f.modal.open).toBe(false);
      expect(unloadProtected()).toBe(false);
      expect((await question(f.app)).open).toBe(false);
    } else {
      expect((await question(f.app)).open).toBe(true);
      await choose(f, "keep");
      expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
      expect(f.modal.querySelector("wt-combobox")!.value).toBe("__each__");
      expect(unloadProtected()).toBe(true);
    }
    expect(f.api.deleteUnit).not.toHaveBeenCalled();
  });
}
it("a busy reassignment invalidates an old Discard and ignores departed controls", async () => {
  let resolve!: (rows: ProductUsingUnit[]) => void;
  const f = await fixture({
    reassignProductsUnit: vi.fn(
      () =>
        new Promise<ProductUsingUnit[]>((r) => {
          resolve = r;
        }),
    ),
  });
  await select(f);
  await target(f);
  await cancel(f, "cancel");
  const q = await question(f.app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  f.modal.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
  await f.screen.updateComplete;
  await f.modal.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  await cancel(f, "escape");
  expect(f.modal.open).toBe(true);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
  const oldTarget = f.modal.querySelector("wt-combobox")!;
  oldTarget.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "__each__" }, bubbles: true, composed: true }),
  );
  await f.screen.updateComplete;
  expect(oldTarget.value).toBe("u2");
  resolve([products[1]]);
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(false);
  f.screen.remove();
  oldTarget.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "u2" }, bubbles: true, composed: true }),
  );
  expect(unloadProtected()).toBe(false);
  f.app.shadowRoot!.prepend(f.screen);
  await f.screen.updateComplete;
  await select(f);
  await target(f);
  expect(unloadProtected()).toBe(true);
});
it("ignores reordered selection events during an in-flight reassignment", async () => {
  let resolve!: (rows: ProductUsingUnit[]) => void;
  const f = await fixture({
    reassignProductsUnit: vi.fn(
      () =>
        new Promise<ProductUsingUnit[]>((r) => {
          resolve = r;
        }),
    ),
  });
  await select(f, ["p2", "p1"]);
  await target(f);
  f.modal.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
  await f.screen.updateComplete;
  await select(f, ["p1", "p2"]);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p2", "p1"]);
  resolve([]);
  await expect.poll(() => unloadProtected()).toBe(false);
});
it("busy reassignment keeps target and selection controls unavailable", async () => {
  let resolve!: (rows: ProductUsingUnit[]) => void;
  const f = await fixture({
    reassignProductsUnit: vi.fn(
      () =>
        new Promise<ProductUsingUnit[]>((r) => {
          resolve = r;
        }),
    ),
  });
  await select(f);
  await target(f);
  f.modal.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
  await f.screen.updateComplete;
  expect(f.modal.querySelector("wt-combobox")!.disabled).toBe(true);
  expect(f.modal.querySelector("wt-data-table")!.selectable).toBe(false);
  expect(f.modal.querySelector("[data-test=select-products]")!.hasAttribute("disabled")).toBe(true);
  resolve([products[1]]);
  await expect.poll(() => f.modal.querySelector("wt-combobox")!.disabled).toBe(false);
});
it("a child close report cannot discard the reassignment modal", async () => {
  const f = await fixture();
  await select(f);
  await target(f);
  f.modal
    .querySelector("wt-data-table")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await f.screen.updateComplete;
  expect(f.modal.open).toBe(true);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
  expect(unloadProtected()).toBe(true);
});
it("an ancestor leave preserves reassignment until Discard and resets only local values", async () => {
  const f = await fixture();
  await select(f);
  await target(f);
  let left = 0;
  const leaving = f.app.leave.coordinator.request({
    scopes: [f.screen],
    reason: "navigation",
    proceed() {
      left++;
    },
  });
  expect((await question(f.app)).open).toBe(true);
  await choose(f, "keep");
  expect(await leaving).toBe("kept");
  expect(left).toBe(0);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
  const discard = f.app.leave.coordinator.request({
    scopes: [f.screen],
    reason: "navigation",
    proceed() {
      left++;
    },
  });
  await choose(f, "discard");
  expect(await discard).toBe("proceeded");
  await f.screen.updateComplete;
  expect(left).toBe(1);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual([]);
  expect(f.modal.querySelector("wt-combobox")!.value).toBe("");
  expect(f.api.reassignProductsUnit).not.toHaveBeenCalled();
  expect(f.api.deleteUnit).not.toHaveBeenCalled();
});
it("disconnecting a dirty owner cancels its question and reconnects with the retained draft", async () => {
  const f = await fixture();
  await select(f);
  await target(f);
  await cancel(f, "cancel");
  const q = await question(f.app);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  f.screen.remove();
  expect(unloadProtected()).toBe(false);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  f.app.shadowRoot!.prepend(f.screen);
  await f.screen.updateComplete;
  expect(f.modal.open).toBe(true);
  expect(f.modal.querySelector("wt-data-table")!.selected).toEqual(["p1"]);
  expect(f.modal.querySelector("wt-combobox")!.value).toBe("u2");
  expect(unloadProtected()).toBe(true);
  await cancel(f, "escape");
  expect((await question(f.app)).open).toBe(true);
  expect(f.api.reassignProductsUnit).not.toHaveBeenCalled();
  expect(f.api.deleteUnit).not.toHaveBeenCalled();
});
it("native selection registers unload protection and Cancel selection reverts it", async () => {
  const f = await fixture();
  f.modal.querySelector<HTMLElement>("[data-test=select-products]")!.click();
  await f.screen.updateComplete;
  const table = f.modal.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!.click();
  await f.screen.updateComplete;
  expect(table.selected).toEqual(["p1"]);
  expect(unloadProtected()).toBe(true);
  f.modal.querySelector<HTMLElement>("[data-test=select-products]")!.click();
  await f.screen.updateComplete;
  expect(table.selected).toEqual([]);
  expect(unloadProtected()).toBe(false);
  await cancel(f, "cancel");
  await expect.poll(() => f.modal.open).toBe(false);
  expect((await question(f.app)).open).toBe(false);
});
it("untouched usage search closes without protection or a write", async () => {
  const f = await fixture();
  const search = f.modal.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[data-test=in-use-search]",
  )!;
  await search.updateComplete;
  await userEvent.fill(page.elementLocator(search.shadowRoot!.querySelector("input")!), "Soup");
  expect(unloadProtected()).toBe(false);
  await cancel(f, "escape");
  await expect.poll(() => f.modal.open).toBe(false);
  expect((await question(f.app)).open).toBe(false);
  expect(f.api.reassignProductsUnit).not.toHaveBeenCalled();
  expect(f.api.deleteUnit).not.toHaveBeenCalled();
});
