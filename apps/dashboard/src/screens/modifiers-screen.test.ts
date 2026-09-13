import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type { DashboardApi, Modifier } from "../api/client.js";
import type { ModifierForm } from "../widgets/modifier-form.js";
import { t } from "../i18n/t.js";
afterEach(cleanupWidgets);
const modifier: Modifier = { id: "m", type: "text", name: { es: "Nota" }, available: true };
function api(overrides: Partial<DashboardApi> = {}) {
  return {
    listModifiers: vi.fn().mockResolvedValue([modifier]),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    createModifier: vi.fn().mockResolvedValue(modifier),
    updateModifier: vi.fn().mockResolvedValue(modifier),
    deleteModifier: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function mount(client = api()) {
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  return el;
}
async function create(el: ModifiersScreen) {
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create"]')!.click();
  await el.updateComplete;
  return el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!;
}
it("shows searchable rows and opens the shared form", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table") as unknown as { rows: Modifier[] };
  expect(table.rows).toEqual([modifier]);
  el.shadowRoot!.querySelector('[name="modifier-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "absent" } }),
  );
  await el.updateComplete;
  expect(table.rows).toEqual([]);
  expect((await create(el)).open).toBe(true);
});
it("opens the new-modifier form from a round add button with an accessible name", async () => {
  const el = await mount();
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="create"]')!;
  expect(add.getAttribute("shape")).toBe("round");
  expect(add.getAttribute("aria-label")).toBe(t("modifiers.new"));
  expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull(); // the old kebab is gone from the heading
  add.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<ModifierForm>("dashboard-modifier-form")!.open).toBe(true);
});
it("keeps failed saves in the form and closes after successful writes even if reload fails", async () => {
  const client = api({
    createModifier: vi
      .fn()
      .mockRejectedValueOnce({ code: "options.group_invalid" })
      .mockResolvedValue(modifier),
  });
  const el = await mount(client);
  const form = await create(el);
  const submit = () =>
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { type: "text", name: { es: "Nota" }, available: true } },
        bubbles: true,
        composed: true,
      }),
    );
  submit();
  await vi.waitFor(() => expect(Object.keys(form.fieldErrors)).not.toHaveLength(0));
  expect(form.open).toBe(true);
  vi.mocked(client.listModifiers).mockRejectedValue(new Error("load failed"));
  submit();
  await vi.waitFor(() => expect(form.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});
it("refreshes with the passive client without replacing an open draft", async () => {
  const background = api();
  const liveData = new LiveData();
  const client = api({ background, liveData });
  const el = await mount(client);
  const form = await create(el);
  form
    .shadowRoot!.querySelector('[name="name-es"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  await form.updateComplete;
  liveData.invalidate([{ type: "option_groups", id: "m" }]);
  await vi.waitFor(() => expect(background.listModifiers).toHaveBeenCalled());
  expect(
    (form.shadowRoot!.querySelector('[name="name-es"]') as unknown as { value: string }).value,
  ).toBe("Draft");
});
it("shows failed initial loads and retries", async () => {
  const client = api({
    listModifiers: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([modifier]),
  });
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="retry"]')!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
});
it("keeps deletion failures in confirmation and deletes only after confirmation", async () => {
  const client = api({
    deleteModifier: vi
      .fn()
      .mockRejectedValueOnce({ code: "options.group_invalid" })
      .mockResolvedValue(undefined),
  });
  const el = await mount(client);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
  await el.updateComplete;
  expect(client.deleteModifier).not.toHaveBeenCalled();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-delete"]')!.click();
  await vi.waitFor(() => expect(client.deleteModifier).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true));
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-delete"]')!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false));
  expect(client.deleteModifier).toHaveBeenLastCalledWith("m");
});
it("displays only enabled content translations", async () => {
  const { setLocale } = await import("../i18n/t.js");
  setLocale("en");
  try {
    const el = await mount(
      api({
        listModifiers: vi
          .fn()
          .mockResolvedValue([{ ...modifier, name: { es: "Nota", en: "Hidden English" } }]),
        getContentLanguages: vi
          .fn()
          .mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      }),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.textContent).toContain("Nota");
    expect(table.shadowRoot!.textContent).not.toContain("Hidden English");
  } finally {
    setLocale("es");
  }
});
it("passes structured server validation fields into the reusable form", async () => {
  const client = api({
    createModifier: vi
      .fn()
      .mockRejectedValue({ code: "modifier.invalid", params: { field: "choices.0.priceDelta" } }),
  });
  const el = await mount(client);
  const form = await create(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { type: "text", name: { es: "Nota" }, available: true } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.fieldErrors["choices.0.priceDelta"]).toBeTruthy());
});
it("identifies a retained-order dependency and offers deactivation", async () => {
  const { t } = await import("../i18n/t.js");
  const client = api({
    deleteModifier: vi.fn().mockRejectedValue({
      code: "modifier.in_use",
      params: { dependency: "order", modifierId: "m" },
    }),
  });
  const el = await mount(client);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-delete"]')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-dialog")!.textContent).toContain(
      t("modifiers.in_use.order"),
    ),
  );
});
