import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, Unit } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { UnitsScreen } from "./units-screen.js";
import "./units-screen.js";

afterEach(cleanupWidgets);

const units: Unit[] = [
  { id: "u1", name: { es: "unidad", en: "each" }, precision: 0 },
  { id: "u2", name: { es: "kilogramo", en: "kilogram" }, precision: 3 },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    background: {
      listUnits: vi.fn().mockResolvedValue(units),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    },
    listUnits: vi.fn().mockResolvedValue(units),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    createUnit: vi.fn().mockResolvedValue({ id: "u3", name: { es: "caja" }, precision: 0 }),
    updateUnit: vi.fn().mockResolvedValue(units[0]),
    deleteUnit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: UnitsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api = stubApi()): Promise<UnitsScreen> {
  const { el } = await mountWidget<UnitsScreen>("dashboard-units-screen", { api });
  await flush(el);
  return el;
}

describe("units-screen", () => {
  it("lists localized units and filters them", async () => {
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.shadowRoot!.querySelector('[data-row-key="u1"]')).toBeTruthy();
    expect(table.shadowRoot!.textContent).toContain("kilogramo");
    el.shadowRoot!.querySelector("[data-test=search]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "kilo" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect((table.rows as readonly Unit[]).map((unit) => unit.id)).toEqual(["u2"]);
  });

  it("blocks duplicate submissions and closes after a successful create", async () => {
    let resolveCreate!: (unit: Unit) => void;
    const createUnit: DashboardApi["createUnit"] = vi.fn(
      () => new Promise<Unit>((resolve) => (resolveCreate = resolve)),
    );
    const api = stubApi({ createUnit });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    const submit = new CustomEvent("wt-submit", {
      detail: { value: { name: { es: "caja" }, precision: 0 } },
      bubbles: true,
      composed: true,
    });
    form.dispatchEvent(submit);
    form.dispatchEvent(submit);
    expect(api.createUnit).toHaveBeenCalledTimes(1);
    resolveCreate({ id: "u3", name: { es: "caja" }, precision: 0 });
    await flush(el);
    expect(form.open).toBe(false);
  });

  it("retains the editor on a failed write", async () => {
    const api = stubApi({ createUnit: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 0 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("places server validation beside the offending field", async () => {
    const api = stubApi({
      createUnit: vi.fn().mockRejectedValue({ code: "unit.precision_invalid" }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 2 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.fieldErrors.precision).toBeTruthy();
  });

  it("keeps the editor closed when refresh fails after a successful write", async () => {
    const background = {
      listUnits: vi.fn().mockRejectedValue({ code: "server.internal" }),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    };
    const api = stubApi({ background } as unknown as Partial<DashboardApi>);
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 0 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.open).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("uses the passive client for live refresh and restores focus after Cancel", async () => {
    const api = stubApi();
    const el = await mount(api);
    const create = el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!;
    create.focus();
    create.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("dashboard-unit-form")!.dispatchEvent(
      new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.shadowRoot!.activeElement).toBe(create);

    api.liveData.invalidate([{ type: "units", id: "u1" }]);
    await flush(el);
    expect(api.background.listUnits).toHaveBeenCalled();
  });

  it("confirms deletion and shows referencing product names when refused", async () => {
    const api = stubApi({
      deleteUnit: vi
        .fn()
        .mockRejectedValue({ code: "unit.in_use", params: { products: [{ es: "Café" }] } }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!
      .click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain("Café");
  });

  it("restores focus when deletion is cancelled", async () => {
    const el = await mount();
    const menu = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("wt-row-actions")!;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    const remove = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!;
    trigger.focus();
    remove.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(menu.shadowRoot!.activeElement).toBe(trigger);
  });
});
