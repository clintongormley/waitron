import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./presented-pay-dialog.js";
import type { PresentedPayDetail, TillPresentedPayDialog } from "./presented-pay-dialog.js";

class PresentedPayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  paid: PresentedPayDetail[] = [];
  override render() {
    return html`<till-presented-pay-dialog
        .open=${true}
        .amount=${"30.00"}
        .takesCash=${true}
        .takesManualCard=${true}
        @presented-pay-close=${() => this.closes++}
        @presented-pay=${(event: CustomEvent<PresentedPayDetail>) => this.paid.push(event.detail)}
      ></till-presented-pay-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("presented-pay-leave-test-app", PresentedPayLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<PresentedPayLeaveApp>("presented-pay-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-presented-pay-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function click(form: TillPresentedPayDialog, selector: string) {
  form.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}
async function fill(form: TillPresentedPayDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function question(app: PresentedPayLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function answer(app: PresentedPayLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

for (const route of ["Close", "Escape"] as const) {
  it(`${route} with typed cash asks first, and closes only on Discard`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "tendered", "40.00");
    if (route === "Close") click(form, "[data-presented-pay-close]");
    else await userEvent.keyboard("{Escape}");
    expect((await question(app)).open).toBe(true);
    expect(app.closes).toBe(0);
    await answer(app, "keep");
    expect(input.value).toBe("40.00");
    expect(unload()).toBe(true);

    if (route === "Close") click(form, "[data-presented-pay-close]");
    else await userEvent.keyboard("{Escape}");
    await answer(app, "discard");
    await expect.poll(() => app.closes).toBe(1);
    expect(unload()).toBe(false);
    expect(app.paid).toEqual([]);
  });
}

it("an untouched sheet, or cash typed back to empty, closes without a question", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await fill(form, "tendered", "40");
  expect(unload()).toBe(true);
  await fill(form, "tendered", "");
  expect(unload()).toBe(false);
  click(form, "[data-presented-pay-close]");
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("a typed operation number counts, compared trimmed", async () => {
  const { app, form } = await mount();
  click(form, 'input[name="method"][value="manual"]');
  await form.updateComplete;
  await fill(form, "externalRef", "   ");
  expect(unload()).toBe(false);
  await fill(form, "externalRef", " slip-9 ");
  expect(unload()).toBe(true);
  click(form, "[data-presented-pay-close]");
  expect((await question(app)).open).toBe(true);
  await answer(app, "keep");
  click(form, "[data-presented-pay-take]");
  await expect.poll(() => app.paid.length).toBe(1);
  expect(app.paid).toEqual([{ method: "manual", externalRef: "slip-9" }]);
});

it("a payment being sent drops a pending question and blocks closing; a refusal keeps the draft", async () => {
  const { app, form } = await mount();
  await fill(form, "tendered", "40.00");
  click(form, "[data-presented-pay-close]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const old = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.busy = true;
  await form.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  old.click();
  await userEvent.keyboard("{Escape}");
  expect(app.closes).toBe(0);

  form.busy = false;
  form.refusal = { code: "sale.unconfirmed" };
  await form.updateComplete;
  expect(unload()).toBe(true);
});

it("closing from outside and reopening starts a clean sheet", async () => {
  const { form } = await mount();
  await fill(form, "tendered", "40.00");
  form.open = false;
  await form.updateComplete;
  expect(unload()).toBe(false);
  form.open = true;
  await form.updateComplete;
  expect(unload()).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=tendered]")!.value,
  ).toBe("");
});

it("a removed sheet holds nothing", async () => {
  const { form } = await mount();
  await fill(form, "tendered", "40.00");
  form.remove();
  expect(unload()).toBe(false);
});
