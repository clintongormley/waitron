import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { SCOPE, UNDER_WAY, VIEW, fakeGiveBackApi } from "./give-back-dialog.test-helpers.js";
import { GiveBackSession } from "../state/give-back.js";
import "./give-back-dialog.js";
import type { TillGiveBackDialog } from "./give-back-dialog.js";

class GiveBackLeaveApp extends LitElement {
  /** What the next app's window reads. */
  static view = VIEW;
  /** What the next app's window opens filled in with. */
  static fill: { cancellationIds: string[]; reasonId: string } | null = null;
  readonly fill = GiveBackLeaveApp.fill;
  readonly leave = new LeaveController(this);
  readonly api = fakeGiveBackApi(GiveBackLeaveApp.view);
  readonly session = new GiveBackSession(SCOPE, this.api);
  closes = 0;
  override render() {
    return html`<till-give-back-dialog
        .api=${this.api}
        .session=${this.session}
        .saleId=${"s1"}
        .invoiceNumber=${"A/1042"}
        .namesLocale=${"en"}
        .fill=${this.fill}
        @give-back-close=${() => this.closes++}
      ></till-give-back-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("give-back-leave-test-app", GiveBackLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  GiveBackLeaveApp.view = VIEW;
  GiveBackLeaveApp.fill = null;
});

async function mount() {
  const { el: app } = await mountWidget<GiveBackLeaveApp>("give-back-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-give-back-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-loading]")).toBeNull());
  await form.updateComplete;
  return { app, form };
}
async function choose(form: TillGiveBackDialog, purpose: string) {
  form.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${purpose}]`)!.click();
  await form.updateComplete;
}
const amount = (form: TillGiveBackDialog) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
    "wt-price-input[name=amount]",
  )!;
async function type(form: TillGiveBackDialog, value: string) {
  const field = amount(form);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
async function question(app: GiveBackLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

it("Escape with a typed amount asks first, keeps it on Keep and gives nothing back on Discard", async () => {
  const { app, form } = await mount();
  await choose(form, "goodwill");
  await type(form, "12.50");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.closes).toBe(0);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(amount(form).value).toBe("12.50");
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  const closed = new Promise<void>((resolve) =>
    form.addEventListener("give-back-close", () => resolve(), { once: true }),
  );
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await closed;
  expect(app.closes).toBe(1);
  expect(app.api.giveBack).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});

it("a choice made with nothing typed closes without asking", async () => {
  const { app, form } = await mount();
  await choose(form, "extra");
  expect(unload()).toBe(false);
  const closed = new Promise<void>((resolve) =>
    form.addEventListener("give-back-close", () => resolve(), { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  expect((await question(app)).open).toBe(false);
});

it("a ticked dish asks first", async () => {
  const { app, form } = await mount();
  await choose(form, "dishes");
  form
    .shadowRoot!.querySelector('wt-switch[data-line="croquetas"]')!
    .shadowRoot!.querySelector("input")!
    .click();
  await form.updateComplete;
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(app.closes).toBe(0);
});

it("the choice's Cancel closes at once", async () => {
  const { app, form } = await mount();
  const closed = new Promise<void>((resolve) =>
    form.addEventListener("give-back-close", () => resolve(), { once: true }),
  );
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await closed;
  expect(app.closes).toBe(1);
});

it("Back with a ticked dish asks first, keeps it on Keep and goes back on Discard", async () => {
  const { app, form } = await mount();
  await choose(form, "dishes");
  form
    .shadowRoot!.querySelector('wt-switch[data-line="croquetas"]')!
    .shadowRoot!.querySelector("input")!
    .click();
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(amount(form).value).toBe("8.00");
  form.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
  expect((await question(app)).open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect
    .poll(() => form.shadowRoot!.querySelector("wt-choice-row[data-choice=dishes]"))
    .not.toBeNull();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
});

it("Done after the money went back closes without asking", async () => {
  const { app, form } = await mount();
  await choose(form, "goodwill");
  await type(form, "5");
  form.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "complaint" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-summary]")).not.toBeNull());
  form.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-outcome]")).not.toBeNull());
  expect(unload()).toBe(false);
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open ?? false).toBe(false);
});

it("closing the under-way view closes the window at once and ends nothing", async () => {
  GiveBackLeaveApp.view = { ...VIEW, underWay: UNDER_WAY };
  const { app, form } = await mount();
  const view = form.shadowRoot!.querySelector("till-give-back-under-way")!;
  await vi.waitFor(() => expect(view.shadowRoot!.querySelector("[data-close]")).not.toBeNull());

  view.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await vi.waitFor(() => expect(app.closes).toBe(1));
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open ?? false).toBe(false);
  expect(app.api.closeInvoiceCorrection).not.toHaveBeenCalled();
  expect(app.api.fileInvoiceCorrection).not.toHaveBeenCalled();
});

it("a window filled in after a cancel closes without asking, and asks once a dish is unticked", async () => {
  GiveBackLeaveApp.fill = { cancellationIds: ["cancel-1"], reasonId: "complaint" };
  const { app, form } = await mount();
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[data-purpose]")).not.toBeNull());
  expect(unload()).toBe(false);
  form
    .shadowRoot!.querySelector('wt-switch[data-line="paella"]')!
    .shadowRoot!.querySelector("input")!
    .click();
  await form.updateComplete;
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  expect(app.closes).toBe(0);
});
