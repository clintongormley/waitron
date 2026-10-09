import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, TranslationPage } from "../api/client.js";
import { t, setLocale } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./content-translations-dialog.js";

const result: TranslationPage = {
  language: "es",
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  next: null,
  total: 1,
  rows: [
    {
      kind: "product",
      id: "dish",
      name: "STAFF Soup",
      reason: "partial",
      selectedText: null,
      defaultText: "Customer soup",
      effectiveSelectedText: null,
      effectiveDefaultText: "Customer soup",
      defaultRequired: false,
      eligible: true,
      unavailableReason: null,
      owners: { kind: "product", parentId: null },
      expected: "baseline",
    },
  ],
};
class TranslationLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getContentTranslationTargets: vi.fn().mockResolvedValue(result),
    saveContentTranslations: vi.fn().mockResolvedValue({ saved: result.rows }),
  } as unknown as DashboardApi;
  open = true;
  closed = 0;
  override render() {
    return html`<dashboard-content-translations-dialog
        .api=${this.api}
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
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  return { app, form };
}
const field = (form: HTMLElement) =>
  form
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[name=translation-text-product-dish]",
    )!;
async function edit(
  form: HTMLElementTagNameMap["dashboard-content-translations-dialog"],
  value: string,
) {
  const input = field(form);
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, value);
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
}
async function question(app: TranslationLeaveApp) {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  await warning.updateComplete;
  return warning;
}
/**
 * Resolves on the inner modal's `wt-close`, which the dialog's close report follows. Chromium sends
 * the native close only with a later rendered frame, which a busy runner can hold back past
 * `vi.waitFor`'s one second.
 */
function modalClosed(form: Element): Promise<unknown> {
  const modal = form.shadowRoot!.querySelector("wt-modal")!;
  return new Promise((resolve) => modal.addEventListener("wt-close", resolve, { once: true }));
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
    const closed = modalClosed(form);
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
  const closed = modalClosed(form);
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
  expect(app.api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
    edits: [{ kind: "product", id: "dish", expected: "baseline", text: "Sopa nueva" }],
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
  field(form)
    .closest("tr")!
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
  field(form)
    .closest("tr")!
    .querySelector<HTMLAnchorElement>("a")!
    .dispatchEvent(
      new MouseEvent("click", { button: 0, bubbles: true, composed: true, cancelable: true }),
    );
  await question(app);
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce());
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
