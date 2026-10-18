import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { ContentSuggestionView, DashboardApi } from "../api/client.js";
import type {
  TranslationItemPage,
  TranslationCellRef,
  TranslationCell,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import { fill, t, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  dialogClosed,
  mountWidget,
} from "./test-helpers.js";
import "./content-translations-dialog.js";

const config = { defaultLanguage: "en", languages: ["en", "es"] };
const savedCell = (id = "dish", language = "es", text: string | null = null): TranslationCell => ({
  kind: "product",
  id,
  language,
  field: "name",
  owners: { kind: "product", parentId: null },
  text,
  inheritedText: null,
  effectiveText: text,
  defaultText: "Customer soup",
  inheritedDefaultText: null,
  effectiveDefaultText: "Customer soup",
  expected: "baseline",
  staffText: "STAFF Soup",
  eligible: true,
  unavailableReason: null,
});
const result: TranslationItemPage = {
  config,
  required: [],
  configuration: "suggestion-config",
  next: null,
  total: 1,
  rows: [
    {
      kind: "product",
      id: "dish",
      name: "STAFF Soup",
      owners: { kind: "product", parentId: null },
      cells: [savedCell()],
    },
  ],
};
const readCells = async (refs: readonly TranslationCellRef[]) => ({
  config,
  required: [],
  configuration: "suggestion-config",
  cells: refs.map((ref) => savedCell(ref.id, ref.language)),
});
const save = async (batch: { edits: { id: string; language: string; text: string | null }[] }) => ({
  saved: batch.edits.map((edit) => savedCell(edit.id, edit.language, edit.text)),
});
class TranslationLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getContentSuggestions: vi.fn(async () => ({
      config,
      required: [],
      configuration: "suggestion-config",
      waitingFixes: 0,
      run: null,
      suggestions: [],
      next: null,
      service: "not_connected" as const,
      cloudOrigin: null,
    })),
    getContentTranslationTargets: vi.fn().mockResolvedValue(result),
    getContentTranslationCells: vi.fn(readCells),
    saveContentTranslations: vi.fn(save),
  } as unknown as DashboardApi;
  open = true;
  closed = 0;
  override render() {
    return html`<dashboard-content-translations-dialog
        .api=${this.api}
        .config=${config}
        language="es"
        .open=${this.open}
        @translations-closed=${() => {
          this.closed++;
          this.open = false;
          this.requestUpdate();
        }}
      ></dashboard-content-translations-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("translation-leave-test-app", TranslationLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});
async function mount() {
  const { el: app } = await mountWidget<TranslationLeaveApp>("translation-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("dashboard-content-translations-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
  await vi.waitFor(() =>
    expect(
      form
        .shadowRoot!.querySelector("dashboard-content-translation-window")
        ?.shadowRoot?.querySelector("wt-input"),
    ).toBeTruthy(),
  );
  await form.updateComplete;
  await form.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
  return { app, form };
}
const field = (form: HTMLElement) =>
  form
    .shadowRoot!.querySelector("dashboard-content-translation-window")!
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[name=translation-product-dish-es-name]",
    )!;
async function edit(
  form: HTMLElementTagNameMap["dashboard-content-translations-dialog"],
  value: string,
) {
  const input = field(form);
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, value);
  await form.updateComplete;
  await form.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
}
async function question(app: TranslationLeaveApp) {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  await warning.updateComplete;
  return warning;
}
for (const route of ["close", "escape"] as const) {
  it(`translation ${route} retains the draft through Keep and closes once after Discard`, async () => {
    const { app, form } = await mount();
    await edit(form, "Sopa del día");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    if (route === "close")
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
    else await userEvent.keyboard("{Escape}");
    const warning = await question(app);
    expect(app.closed).toBe(0);
    warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await vi.waitFor(() => expect(warning.open).toBe(false));
    await closeReportsDelivered();
    expect(field(form).value).toBe("Sopa del día");
    expect(form.open).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
    await question(app);
    const closed = dialogClosed(form.shadowRoot!.querySelector("wt-modal")!);
    warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await closed;
    await vi.waitFor(() => expect(app.closed).toBe(1));
    await closeReportsDelivered();
    expect(app.closed).toBe(1);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("translation edit/revert compares normalized values and removes the unload warning", async () => {
  const { app, form } = await mount();
  await edit(form, "Sopa");
  const changed = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(changed);
  expect(changed.defaultPrevented).toBe(true);
  await edit(form, "  ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const reverted = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(reverted);
  expect(reverted.defaultPrevented).toBe(false);
  const closed = dialogClosed(form.shadowRoot!.querySelector("wt-modal")!);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  await closed;
  await vi.waitFor(() => expect(app.closed).toBe(1));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("translation success commits before its saved event and closes the native modal", async () => {
  const { app, form } = await mount();
  await edit(form, "Sopa");
  const outcomes: boolean[] = [];
  form.addEventListener("translations-saved", () => outcomes.push(app.leave.coordinator.isDirty()));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(outcomes).toEqual([false]));
  expect(form.open).toBe(false);
  await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  expect(
    form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open,
  ).toBe(false);
});

it("registers a dirty draft even when disconnected before its edit redraw and reconnects with its original token", async () => {
  const { app, form } = await mount();
  const control = field(form);
  control.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Sopa nueva" },
      bubbles: true,
      composed: true,
    }),
  );
  form.remove();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  await vi.waitFor(() => expect(app.leave.coordinator.isDirty()).toBe(true));
  expect(field(form).value).toBe("Sopa nueva");
  const warning = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(warning);
  expect(warning.defaultPrevented).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  const questionEl = await question(app);
  questionEl.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(questionEl.open).toBe(false));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(app.api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [
      {
        kind: "product",
        id: "dish",
        language: "es",
        field: "name",
        expected: "baseline",
        text: "Sopa nueva",
      },
    ],
  });
});
it.each(["navigation", "locale", "signout"] as const)(
  "registers translation drafts for the application %s leave gate",
  async (reason) => {
    const { app, form } = await mount();
    await edit(form, "Sopa nueva");
    const proceed = vi.fn();
    const leave = () =>
      app.leave.coordinator.request({
        scopes: "all",
        reason: reason === "locale" ? "navigation" : reason,
        proceed,
      });
    const kept = leave();
    const warning = await question(app);
    warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    expect(await kept).toBe("kept");
    expect(proceed).not.toHaveBeenCalled();
    expect(field(form).value).toBe("Sopa nueva");
    const discarded = leave();
    await question(app);
    warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    expect(await discarded).toBe("proceeded");
    expect(proceed).toHaveBeenCalledOnce();
    await form.updateComplete;
    expect(field(form).value).toBe("");
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);
it("native close asks about changes and security reset cancels the pending choice", async () => {
  const { app, form } = await mount();
  await edit(form, "Sopa nueva");
  const modal = form.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  modal
    .shadowRoot!.querySelector("dialog")!
    .dispatchEvent(new Event("cancel", { cancelable: true }));
  await question(app);
  expect(app.closed).toBe(0);
  app.leave.forceReset();
  form.remove();
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false),
  );
  expect(app.closed).toBe(0);
});
it("a product editor link asks about the draft before emitting navigation", async () => {
  const { app, form } = await mount();
  await edit(form, "Sopa nueva");
  const opened = vi.fn();
  form.addEventListener("wt-edit-product", opened);
  expect(field(form).closest("section")!.querySelector("a")).not.toBeNull();
  field(form)
    .closest("section")!
    .querySelector<HTMLAnchorElement>("a")!
    .dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, composed: true, cancelable: true }),
    );
  const warning = await question(app);
  expect(opened).not.toHaveBeenCalled();
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await vi.waitFor(() => expect(warning.open).toBe(false));
  await closeReportsDelivered();
  expect(opened).not.toHaveBeenCalled();
  expect(field(form).closest("section")!.querySelector("a")).not.toBeNull();
  field(form)
    .closest("section")!
    .querySelector<HTMLAnchorElement>("a")!
    .dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, composed: true, cancelable: true }),
    );
  await question(app);
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
const soup = (id: string, itemId: string, text: string): ContentSuggestionView => ({
  id,
  kind: "product",
  itemId,
  language: "es",
  text,
  placeholder: false,
  fix: null,
  stale: false,
  cell: { kind: "product", id: itemId, language: "es", field: "name" },
  expected: "baseline",
});
function suggestionApi(page: TranslationItemPage, suggestions: ContentSuggestionView[]) {
  return {
    getContentTranslationTargets: vi.fn(async (query: TranslationQuery) => ({
      ...page,
      rows:
        "targets" in query
          ? page.rows.filter((row) => query.targets.some((ref) => ref.id === row.id))
          : page.rows.slice(0, 50),
      next: null,
    })),
    getContentTranslationCells: vi.fn(readCells),
    getContentSuggestions: vi.fn(async (query: { after?: string } = {}) => ({
      config,
      required: [],
      configuration: "suggestion-config",
      waitingFixes: 0,
      run: null,
      suggestions: suggestions.slice(query.after ? 100 : 0, query.after ? 200 : 100),
      next: !query.after && suggestions.length > 100 ? "suggestions-100" : null,
      service: "on" as const,
      cloudOrigin: null,
    })),
    saveContentTranslations: vi.fn(save),
    discardContentSuggestion: vi.fn(),
    startContentSuggestions: vi.fn(async () => ({ run: null })),
  } as unknown as DashboardApi;
}
async function mountWith(api: DashboardApi) {
  const { el: app } = await mountWidget<TranslationLeaveApp>("translation-leave-test-app", { api });
  const form = app.shadowRoot!.querySelector("dashboard-content-translations-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
  await vi.waitFor(() =>
    expect(
      form
        .shadowRoot!.querySelector("dashboard-content-translation-window")
        ?.shadowRoot?.querySelector("wt-input"),
    ).toBeTruthy(),
  );
  await form.updateComplete;
  await form.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
  return { app, form };
}
async function closeUnasked(
  app: TranslationLeaveApp,
  form: HTMLElementTagNameMap["dashboard-content-translations-dialog"],
) {
  const closed = dialogClosed(form.shadowRoot!.querySelector("wt-modal")!);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  await closed;
  await vi.waitFor(() => expect(app.closed).toBe(1));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
}
it("closes with only untouched suggestions without asking or warning on unload", async () => {
  const { app, form } = await mountWith(
    suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]),
  );
  expect(field(form).value).toBe("CLIENT-es Sopa del día");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  await closeUnasked(app, form);
});
it("a person's edit of a suggested name still asks, and discarding the edit brings the suggestion back", async () => {
  const { app, form } = await mountWith(
    suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]),
  );
  await edit(form, "Sopa de la casa");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const proceed = vi.fn();
  const discarded = app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  const warning = await question(app);
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discarded).toBe("proceeded");
  await form.updateComplete;
  await form.shadowRoot!.querySelector("dashboard-content-translation-window")!.updateComplete;
  expect(field(form).value).toBe("CLIENT-es Sopa del día");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("saving untouched suggestions leaves nothing unsaved when the saved event arrives", async () => {
  const api = suggestionApi(result, [soup("s1", "dish", "CLIENT-es Sopa del día")]);
  const { app, form } = await mountWith(api);
  const outcomes: boolean[] = [];
  form.addEventListener("translations-saved", () => outcomes.push(app.leave.coordinator.isDirty()));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(outcomes).toEqual([false]));
  expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [
      {
        kind: "product",
        id: "dish",
        language: "es",
        field: "name",
        expected: "baseline",
        text: "CLIENT-es Sopa del día",
      },
    ],
  });
});

it("fills at most 100 of 150 suggestions and closes without asking", async () => {
  const rows = Array.from({ length: 150 }, (_, n) => ({
    ...result.rows[0]!,
    id: `dish-${n}`,
    name: `STAFF Soup ${n}`,
    cells: [savedCell(`dish-${n}`)],
  }));
  const { app, form } = await mountWith(
    suggestionApi(
      { ...result, rows },
      rows.map((row, n) => soup(`s${n}`, row.id, `CLIENT-es Sopa ${n}`)),
    ),
  );
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=next-suggestions]")!.click();
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-test=suggestion-capacity]")).not.toBeNull(),
  );
  expect(
    form.shadowRoot!.querySelector("[data-test=suggestion-capacity]")!.textContent!.trim(),
  ).toBe(fill("suggestions.capacity", { shown: "100" }));
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await closeUnasked(app, form);
});
