import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, registerIcons } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, closeReportsDelivered } from "./test-helpers.js";
import type { CatalogueBrowser } from "./catalogue-browser.js";
import "./catalogue-browser.js";
registerIcons(DASHBOARD_ICONS);
class CatalogueLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-catalogue-browser
        .api=${this.api}
        .categories=${[
          { id: "d", name: "Drinks", parentId: null, color: null },
          { id: "f", name: "Food", parentId: null, color: null },
        ]}
      ></dashboard-catalogue-browser
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("catalogue-leave-test-app", CatalogueLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const counts = { id: "d", folders: 1, products: 3, activeProducts: 2, routes: 1, ownRoutes: 1 };
async function fixture(operation: "move" | "delete", overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const api = {
    moveCatalogueItems: vi.fn().mockResolvedValue(undefined),
    deleteCatalogueItems: vi.fn().mockResolvedValue(undefined),
    summariseFolders: vi.fn().mockResolvedValue([counts]),
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<CatalogueLeaveApp>("catalogue-leave-test-app", { api });
  const browser = app.shadowRoot!.querySelector<CatalogueBrowser>("dashboard-catalogue-browser")!;
  await browser.updateComplete;
  browser.shadowRoot!.querySelector<HTMLElement>("[data-test=select]")!.click();
  await browser.updateComplete;
  const list = browser.shadowRoot!.querySelector("dashboard-product-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table
    .shadowRoot!.querySelector<HTMLInputElement>(
      'tr[data-row-key="folder:d"] input[type=checkbox]',
    )!
    .click();
  await browser.updateComplete;
  browser.shadowRoot!.querySelector<HTMLElement>(`[data-test=${operation}]`)!.click();
  await expect.poll(() => browser.shadowRoot!.querySelector("wt-modal")?.open).toBe(true);
  await browser.updateComplete;
  const modal = browser.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return { app, api, browser, modal, operation };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function edit(f: Fixture, reverted = false) {
  if (f.operation === "move") {
    const combo = f.modal.querySelector("wt-combobox")!;
    if (reverted) combo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
    else await chooseOption(combo, "f");
  } else
    f.modal
      .querySelector<HTMLInputElement>(`input[value=${reverted ? "move_up" : "delete"}]`)!
      .click();
  await f.browser.updateComplete;
}
function value(f: Fixture) {
  return f.operation === "move"
    ? f.modal.querySelector("wt-combobox")!.value
    : f.modal.querySelector<HTMLInputElement>("input:checked")!.value;
}
function protectedUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("a contents choice hidden by the fresh counts is no longer an unsaved submitted value", async () => {
  const summariseFolders = vi
    .fn()
    .mockResolvedValueOnce([counts])
    .mockResolvedValue([
      { id: "d", folders: 0, products: 0, activeProducts: 0, routes: 1, ownRoutes: 1 },
    ]);
  const f = await fixture("delete", { summariseFolders });
  await edit(f);
  expect(protectedUnload()).toBe(true);
  f.modal.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => f.modal.querySelector("input[name=contents]")).toBeNull();
  await expect
    .poll(() => f.modal.querySelector("[data-test=confirm]")?.hasAttribute("disabled"))
    .toBe(false);
  expect(f.api.deleteCatalogueItems).not.toHaveBeenCalled();
  expect(f.modal.textContent).toContain(t("folders.summary_changed"));
  expect(protectedUnload()).toBe(false);
  await cancel(f, "cancel");
  await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question(f)).open).toBe(false);
  expect(f.api.deleteCatalogueItems).not.toHaveBeenCalled();
});
async function question(f: Fixture) {
  await f.app.updateComplete;
  const q = f.app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(f: Fixture, decision: "keep" | "discard") {
  const q = await question(f);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await q.updateComplete;
}
async function cancel(f: Fixture, route: "cancel" | "escape") {
  const button = f.modal.querySelector<HTMLElement>("wt-button[slot=cancel]")!;
  button.focus();
  if (route === "cancel") button.click();
  else await userEvent.keyboard("{Escape}");
  await f.browser.updateComplete;
}
for (const operation of ["move", "delete"] as const) {
  for (const route of ["cancel", "escape"] as const) {
    it(`${operation} ${route} retains its staged choice until explicit local Discard`, async () => {
      const f = await fixture(operation);
      await edit(f);
      expect(protectedUnload()).toBe(true);
      await cancel(f, route);
      expect((await question(f)).open).toBe(true);
      expect(f.modal.open).toBe(true);
      await choose(f, "keep");
      expect(value(f)).toBe(operation === "move" ? "f" : "delete");
      await expect
        .poll(
          () => f.modal.querySelector("wt-button[slot=cancel]")!.shadowRoot!.activeElement?.tagName,
        )
        .toBe("BUTTON");
      await cancel(f, route);
      await choose(f, "discard");
      await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
      expect(f.api.moveCatalogueItems).not.toHaveBeenCalled();
      expect(f.api.deleteCatalogueItems).not.toHaveBeenCalled();
      expect(protectedUnload()).toBe(false);
      expect(
        f.browser.shadowRoot!.querySelector("[data-test=selected-count]")!.textContent!.trim(),
      ).toBe("1 selected");
    });
  }
  it(`${operation} untouched and reverted choice closes directly`, async () => {
    const f = await fixture(operation);
    expect(protectedUnload()).toBe(false);
    await edit(f);
    await edit(f, true);
    expect(protectedUnload()).toBe(false);
    await cancel(f, "escape");
    await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect((await question(f)).open).toBe(false);
  });
  it(`${operation} successful submission retires only the accepted operation`, async () => {
    const f = await fixture(operation);
    await edit(f);
    f.modal.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(protectedUnload()).toBe(false);
    expect((await question(f)).open).toBe(false);
    if (operation === "move")
      expect(f.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
        { productIds: [], categoryIds: ["d"] },
        "f",
      );
    else
      expect(f.api.deleteCatalogueItems).toHaveBeenCalledExactlyOnceWith(
        { productIds: [], categoryIds: ["d"] },
        "delete",
        [counts],
      );
  });
  it(`${operation} refusal retains its retry choice and protection`, async () => {
    const f = await fixture(operation, {
      [operation === "move" ? "moveCatalogueItems" : "deleteCatalogueItems"]: vi
        .fn()
        .mockRejectedValue({ code: "category.name_taken" }),
    });
    await edit(f);
    f.modal.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await expect.poll(() => f.modal.querySelector("[role=alert]")?.textContent).toBeTruthy();
    expect(protectedUnload()).toBe(true);
    await cancel(f, "cancel");
    expect((await question(f)).open).toBe(true);
    await choose(f, "keep");
    expect(value(f)).toBe(operation === "move" ? "f" : "delete");
  });
}
it("disconnect invalidates a question and reconnect keeps the original move baseline", async () => {
  const f = await fixture("move");
  await edit(f);
  await cancel(f, "cancel");
  const stale = (await question(f)).shadowRoot!.querySelector<HTMLElement>(
    "[data-choice=discard]",
  )!;
  f.browser.remove();
  expect(protectedUnload()).toBe(false);
  stale.click();
  f.app.shadowRoot!.prepend(f.browser);
  await f.browser.updateComplete;
  expect(value(f)).toBe("f");
  expect(protectedUnload()).toBe(true);
  await cancel(f, "escape");
  expect((await question(f)).open).toBe(true);
});
it("a child close report cannot remove the operation", async () => {
  const f = await fixture("move");
  await edit(f);
  f.modal
    .querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await f.browser.updateComplete;
  expect(f.browser.shadowRoot!.querySelector("wt-modal")).toBe(f.modal);
  expect(value(f)).toBe("f");
});
for (const operation of ["move", "delete"] as const) {
  it(`${operation} busy submission invalidates an earlier question and blocks changed controls`, async () => {
    let refuse!: (value: unknown) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      refuse = reject;
    });
    const f = await fixture(operation, {
      [operation === "move" ? "moveCatalogueItems" : "deleteCatalogueItems"]: vi
        .fn()
        .mockReturnValue(pending),
    });
    await edit(f);
    await cancel(f, "cancel");
    const stale = (await question(f)).shadowRoot!.querySelector<HTMLElement>(
      "[data-choice=discard]",
    )!;
    f.modal.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await f.browser.updateComplete;
    await expect.poll(async () => (await question(f)).open).toBe(false);
    if (operation === "move")
      f.modal
        .querySelector("wt-combobox")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "top" } }));
    else
      f.modal
        .querySelector<HTMLInputElement>("input[value=move_up]")!
        .dispatchEvent(new Event("change"));
    stale.click();
    expect(await f.modal.requestClose("cancel")).toBe(false);
    expect(value(f)).toBe(operation === "move" ? "f" : "delete");
    refuse({ code: "category.name_taken" });
    await expect.poll(() => f.modal.querySelector("[role=alert]")?.textContent).toBeTruthy();
    expect(protectedUnload()).toBe(true);
    expect(value(f)).toBe(operation === "move" ? "f" : "delete");
  });
}
it("departed move controls cannot change or submit a replacement operation", async () => {
  const f = await fixture("move");
  await edit(f);
  const oldCombo = f.modal.querySelector("wt-combobox")!;
  const oldConfirm = f.modal.querySelector<HTMLElement>("[data-test=confirm]")!;
  await cancel(f, "cancel");
  await choose(f, "discard");
  await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
  f.browser.shadowRoot!.querySelector<HTMLElement>("[data-test=move]")!.click();
  await f.browser.updateComplete;
  const replacement = f.browser.shadowRoot!.querySelector("wt-modal")!;
  oldCombo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "f" } }));
  await f.browser.updateComplete;
  expect(replacement.querySelector("wt-combobox")!.value).toBe("");
  await chooseOption(replacement.querySelector("wt-combobox")!, "top");
  await f.browser.updateComplete;
  oldConfirm.click();
  expect(f.api.moveCatalogueItems).not.toHaveBeenCalled();
  expect(protectedUnload()).toBe(true);
});
it("a deletion-count refresh keeps the staged disposition protected", async () => {
  const fresh = { ...counts, activeProducts: 4, products: 5 };
  const f = await fixture("delete", {
    summariseFolders: vi.fn().mockResolvedValueOnce([counts]).mockResolvedValue([fresh]),
  });
  await edit(f);
  f.modal.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => f.modal.querySelector("[role=alert]")?.textContent).toBeTruthy();
  expect(f.api.deleteCatalogueItems).not.toHaveBeenCalled();
  expect(value(f)).toBe("delete");
  expect(protectedUnload()).toBe(true);
  await cancel(f, "cancel");
  expect((await question(f)).open).toBe(true);
});

for (const route of ["cancel", "close-report"] as const) {
  it(`departed ${route} cannot close a replacement operation`, async () => {
    const f = await fixture("move");
    const oldCancel = f.modal.querySelector<HTMLElement>("wt-button[slot=cancel]")!;
    await cancel(f, "cancel");
    await expect.poll(() => f.browser.shadowRoot!.querySelector("wt-modal")).toBeNull();
    f.browser.shadowRoot!.querySelector<HTMLElement>("[data-test=move]")!.click();
    await f.browser.updateComplete;
    const replacement = f.browser.shadowRoot!.querySelector("wt-modal")!;
    if (route === "cancel") oldCancel.click();
    else f.modal.dispatchEvent(new CustomEvent("wt-close"));
    await f.browser.updateComplete;
    await closeReportsDelivered();
    expect(f.browser.shadowRoot!.querySelector("wt-modal")).toBe(replacement);
    expect(replacement.open).toBe(true);
    expect(f.api.moveCatalogueItems).not.toHaveBeenCalled();
  });
}
