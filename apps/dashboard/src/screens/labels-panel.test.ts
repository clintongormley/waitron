import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { LabelsPanel } from "./labels-panel.js";
import type { DashboardApi, LabelSummary } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));

const alcoholic: LabelSummary = { id: "l-alc", name: "Alcoholic", productCount: 3 };
const happy: LabelSummary = { id: "l-happy", name: "Happy hour drinks", productCount: 0 };

function apiFixture() {
  const api = {
    listLabels: vi.fn().mockResolvedValue([happy, alcoholic]),
    createLabel: vi.fn().mockResolvedValue({ id: "l-new", name: "Vegan" }),
    renameLabel: vi.fn().mockResolvedValue({ id: "l-alc", name: "Spirits" }),
    deleteLabel: vi.fn().mockResolvedValue(undefined),
  };
  return { api, client: api as unknown as DashboardApi };
}
async function mount(fx = apiFixture()) {
  const mounted = await mountWidget<LabelsPanel>("dashboard-labels-panel", { api: fx.client });
  await vi.waitFor(() => expect(table(mounted.el).rows.length).toBe(2));
  await table(mounted.el).updateComplete;
  return { ...fx, ...mounted };
}
function table(el: LabelsPanel) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="labels"]',
  )!;
}
function cell(el: LabelsPanel, id: string, index: number): string {
  return table(el)
    .shadowRoot!.querySelectorAll(`tr[data-row-key="${id}"] td`)
    [index]!.textContent!.trim();
}
function modal(el: LabelsPanel, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    `wt-modal[data-test="${test}"]`,
  )!;
}
function nameInput(el: LabelsPanel) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="label-name"]',
  )!;
}
async function type(el: LabelsPanel, value: string): Promise<void> {
  nameInput(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function rowAction(el: LabelsPanel, id: string, test: string): Promise<void> {
  table(el)
    .shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${id}"] [data-test="${test}"]`)!
    .click();
  await el.updateComplete;
}
function save(el: LabelsPanel) {
  modal(el, "label-form").querySelector<HTMLElement>('[data-test="save-label"]')!.click();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

it("lists every label by name with the number of products carrying it", async () => {
  const { el } = await mount();
  expect(
    [...table(el).shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual(["l-alc", "l-happy"]);
  expect(cell(el, "l-alc", 0)).toBe("Alcoholic");
  expect(cell(el, "l-alc", 1)).toBe("3");
  expect(cell(el, "l-happy", 1)).toBe("0");
});

it("creates a label from the Add label form, then refreshes the list", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  expect(modal(el, "label-form").open).toBe(true);
  expect(modal(el, "label-form").getAttribute("heading")).toBe(t("labels.add"));
  expect(nameInput(el).required).toBe(true);
  await type(el, "Vegan");
  const loads = api.listLabels.mock.calls.length;
  save(el);
  await vi.waitFor(() => expect(api.createLabel).toHaveBeenCalledWith("Vegan"));
  await vi.waitFor(() => expect(modal(el, "label-form").open).toBe(false));
  await vi.waitFor(() => expect(api.listLabels.mock.calls.length).toBe(loads + 1));
});

it("explains a blank name beside the field and in the summary, and sends nothing", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  await type(el, "   ");
  save(el);
  await el.updateComplete;
  expect(nameInput(el).error).toBe(t("labels.name_required"));
  expect(modal(el, "label-form").querySelector("wt-form-error-summary")!.errors).toEqual([
    t("labels.name_required"),
  ]);
  expect(api.createLabel).not.toHaveBeenCalled();
});

it.each(["label.name_taken", "label.invalid"])(
  "puts a %s refusal beside the name and keeps what was typed",
  async (code) => {
    const { el, api } = await mount();
    api.createLabel.mockRejectedValueOnce({ code, params: { field: "name", name: "Alcoholic" } });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
    await el.updateComplete;
    await type(el, "Alcoholic");
    save(el);
    await vi.waitFor(() => expect(nameInput(el).error).toBe(codeMessage(code)));
    expect(nameInput(el).value).toBe("Alcoholic");
    expect(modal(el, "label-form").open).toBe(true);
  },
);

it("says why a rename of a label that no longer exists was refused", async () => {
  const { el, api } = await mount();
  api.renameLabel.mockRejectedValueOnce({ code: "label.not_found" });
  await rowAction(el, "l-alc", "rename-label");
  save(el);
  await vi.waitFor(() =>
    expect(modal(el, "label-form").querySelector('p[role="alert"]')?.textContent).toBe(
      codeMessage("label.not_found"),
    ),
  );
  expect(nameInput(el).error).toBe("");
});

it("renames a label from its row, starting from its current name", async () => {
  const { el, api } = await mount();
  await rowAction(el, "l-alc", "rename-label");
  expect(modal(el, "label-form").getAttribute("heading")).toBe(t("labels.rename"));
  expect(nameInput(el).value).toBe("Alcoholic");
  await type(el, "Spirits");
  save(el);
  await vi.waitFor(() => expect(api.renameLabel).toHaveBeenCalledWith("l-alc", "Spirits"));
  await vi.waitFor(() => expect(modal(el, "label-form").open).toBe(false));
});

it("saves once and stays open against Escape while a save is in flight", async () => {
  const { el, api } = await mount();
  const saving = deferred<{ id: string; name: string }>();
  api.createLabel.mockReturnValueOnce(saving.promise);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  await type(el, "Vegan");
  save(el);
  save(el);
  await el.updateComplete;
  await userEvent.keyboard("{Escape}");
  modal(el, "label-form").dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(modal(el, "label-form").open).toBe(true);
  expect(api.createLabel).toHaveBeenCalledOnce();
  saving.resolve({ id: "l-new", name: "Vegan" });
  await vi.waitFor(() => expect(modal(el, "label-form").open).toBe(false));
});

it("closes the form after a save even when the refresh fails, and says the list failed to load", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  await type(el, "Vegan");
  api.listLabels.mockRejectedValueOnce(new Error("offline"));
  save(el);
  await vi.waitFor(() => expect(modal(el, "label-form").open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("closes the form from Cancel without saving", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  modal(el, "label-form").querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  expect(modal(el, "label-form").open).toBe(false);
  expect(api.createLabel).not.toHaveBeenCalled();
});

it("confirms a delete with the number of products it is taken off, then deletes", async () => {
  setLocale("en-GB");
  const { el, api } = await mount();
  await rowAction(el, "l-alc", "delete-label");
  const dialog = modal(el, "label-delete");
  expect(dialog.open).toBe(true);
  expect(dialog.getAttribute("heading")).toBe("Delete Alcoholic?");
  expect(dialog.querySelector('[data-test="delete-count"]')!.textContent!.trim()).toBe(
    "Deleting it removes it from 3 products.",
  );
  dialog.querySelector<HTMLElement>('wt-button[variant="danger"]')!.click();
  await vi.waitFor(() => expect(api.deleteLabel).toHaveBeenCalledWith("l-alc"));
  await vi.waitFor(() => expect(dialog.open).toBe(false));
});

it.each([
  [0, "No product carries it."],
  [1, "Deleting it removes it from 1 product."],
])("words a delete of a label on %i products", async (count, text) => {
  setLocale("en-GB");
  const fx = apiFixture();
  fx.api.listLabels.mockResolvedValue([alcoholic, { ...happy, productCount: count }]);
  const { el } = await mount(fx);
  await rowAction(el, "l-happy", "delete-label");
  expect(
    modal(el, "label-delete").querySelector('[data-test="delete-count"]')!.textContent!.trim(),
  ).toBe(text);
});

it("explains a refused delete and keeps the confirmation open", async () => {
  const { el, api } = await mount();
  api.deleteLabel.mockRejectedValueOnce({ code: "label.not_found" });
  await rowAction(el, "l-alc", "delete-label");
  const dialog = modal(el, "label-delete");
  dialog.querySelector<HTMLElement>('wt-button[variant="danger"]')!.click();
  await vi.waitFor(() =>
    expect(dialog.querySelector('p[role="alert"]')?.textContent).toBe(
      codeMessage("label.not_found"),
    ),
  );
  expect(dialog.open).toBe(true);
  dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  expect(dialog.open).toBe(false);
});

it("deletes once and stays open against a close while deleting", async () => {
  const { el, api } = await mount();
  const removal = deferred<void>();
  api.deleteLabel.mockReturnValueOnce(removal.promise);
  await rowAction(el, "l-alc", "delete-label");
  const dialog = modal(el, "label-delete");
  const remove = dialog.querySelector<HTMLElement>('wt-button[variant="danger"]')!;
  remove.click();
  remove.click();
  await el.updateComplete;
  await userEvent.keyboard("{Escape}");
  dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(api.deleteLabel).toHaveBeenCalledOnce();
  removal.resolve();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
});

it("says the labels failed to load, and loads them again from Retry", async () => {
  const fx = apiFixture();
  fx.api.listLabels.mockRejectedValueOnce(new Error("offline"));
  const { el } = await mountWidget<LabelsPanel>("dashboard-labels-panel", { api: fx.client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  expect(el.shadowRoot!.querySelector('[data-test="load-error"]')!.textContent!.trim()).toBe(
    t("labels.load_error"),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="retry"]')!.click();
  await vi.waitFor(() => expect(table(el).rows.length).toBe(2));
  expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).toBeNull();
});

it("shows its empty message when there are no labels", async () => {
  const fx = apiFixture();
  fx.api.listLabels.mockResolvedValue([]);
  const { el } = await mountWidget<LabelsPanel>("dashboard-labels-panel", { api: fx.client });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
  expect(table(el).emptyMessage).toBe(t("labels.empty"));
});

it("saves the form with Enter in the name field", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-label"]')!.click();
  await el.updateComplete;
  await type(el, "Vegan");
  await nameInput(el).updateComplete;
  nameInput(el).focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(api.createLabel).toHaveBeenCalledWith("Vegan"));
});

it("sorts the labels by how many products carry them", async () => {
  const { el } = await mount();
  table(el).shadowRoot!.querySelector<HTMLElement>('[data-sort="products"]')!.click();
  await table(el).updateComplete;
  expect(
    [...table(el).shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual(["l-happy", "l-alc"]);
});

it("finds a label by its name", async () => {
  const { el } = await mount();
  const search = table(el).shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  search.value = "happy";
  search.dispatchEvent(new Event("input"));
  await table(el).updateComplete;
  expect(
    [...table(el).shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual(["l-happy"]);
});
