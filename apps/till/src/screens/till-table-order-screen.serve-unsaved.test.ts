import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  current,
  currentGroup,
  row,
  groups,
  now,
} from "./till-table-order-screen.current-orders.test-helpers.js";

class ServeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly commands: unknown[] = [];
  readonly protectionAtSubmit: boolean[] = [];
  override render() {
    return html`<till-table-order-screen
        .orderId=${"wo-4"}
        .groups=${groups}
        .now=${now}
        .currentOrders=${current({ groups: [currentGroup("g1", 1, "fired", [row("dish", "Croquetas", "4.000", { servedQuantity: "2.000" })])] })}
        @serve-lines=${(event: CustomEvent) => this.accept(event)}
        @unserve-lines=${(event: CustomEvent) => this.accept(event)}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
  private accept(event: CustomEvent) {
    this.protectionAtSubmit.push(unload());
    this.commands.push(event.detail);
  }
}
customElements.define("serve-leave-test-app", ServeLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount(undo = false) {
  const { el: app } = await mountWidget<ServeLeaveApp>("serve-leave-test-app", {});
  const screen = app.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
  await screen.updateComplete;
  await click(screen, "[data-open-drawer]");
  await click(screen, `[data-${undo ? "unserve" : "serve"}-row="dish"]`);
  const dialog = screen.shadowRoot!.querySelector<WtDialog>("[data-serve-dialog]")!;
  await dialog.updateComplete;
  return { app, screen, dialog };
}
async function click(screen: TillTableOrderScreen, selector: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await screen.updateComplete;
}
const count = (screen: TillTableOrderScreen) =>
  screen.shadowRoot!.querySelector("[data-serve-count]")!.textContent!.trim();
async function question(app: ServeLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
for (const undo of [false, true]) {
  for (const route of ["Back", "Escape"]) {
    it(`${undo ? "undo" : "serve"} ${route} keeps the count until local Discard without issuing a command`, async () => {
      const { app, screen, dialog } = await mount(undo);
      await click(screen, "[data-serve-dec]");
      if (route === "Back") await click(screen, "[data-serve-dismiss]");
      else await userEvent.keyboard("{Escape}");
      const q = await question(app);
      expect(q.open).toBe(true);
      expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
      expect(count(screen)).toBe("1");
      expect(app.commands).toEqual([]);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(count(screen)).toBe("1");
      expect(unload()).toBe(true);
      await click(screen, "[data-serve-dismiss]");
      await question(app);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => dialog.open).toBe(false);
      expect(app.commands).toEqual([]);
      expect(unload()).toBe(false);
      await click(screen, `[data-${undo ? "unserve" : "serve"}-row="dish"]`);
      expect(count(screen)).toBe("2");
    });
  }
}
it("clean and reverted counts close without a question", async () => {
  const { app, screen, dialog } = await mount();
  expect(unload()).toBe(false);
  await click(screen, "[data-serve-dec]");
  expect(unload()).toBe(true);
  await click(screen, "[data-serve-inc]");
  expect(unload()).toBe(false);
  await click(screen, "[data-serve-dismiss]");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.commands).toEqual([]);
});
it("Confirm releases serving protection synchronously and sends the exact count once", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dec]");
  expect(unload()).toBe(true);
  const confirm = screen.shadowRoot!.querySelector<HTMLElement>("[data-serve-confirm]")!;
  confirm.click();
  confirm.click();
  await screen.updateComplete;
  expect(app.commands).toEqual([{ items: [{ lineId: "dish", quantity: "1" }] }]);
  expect(app.protectionAtSubmit).toEqual([false]);
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("a confirmed count makes an old Discard inert", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dec]");
  await click(screen, "[data-serve-dismiss]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await click(screen, "[data-serve-confirm]");
  await expect.poll(() => q.open).toBe(false);
  await click(screen, '[data-serve-row="dish"]');
  discard.click();
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(count(screen)).toBe("2");
  expect(app.commands).toEqual([{ items: [{ lineId: "dish", quantity: "1" }] }]);
});
it("disconnect removes protection and aborts a question; reconnect retains the original comparison", async () => {
  const { app, screen } = await mount();
  await click(screen, "[data-serve-dec]");
  await click(screen, "[data-serve-dismiss]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  discard.click();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(count(screen)).toBe("1");
  expect(unload()).toBe(true);
  await click(screen, "[data-serve-dismiss]");
  expect((await question(app)).open).toBe(true);
  expect(app.commands).toEqual([]);
});
it("departed buttons and child close reports cannot dismiss or submit the serving editor", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dec]");
  dialog
    .querySelector<HTMLElement>("[data-serve-dec]")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(dialog.open).toBe(true);
  expect(count(screen)).toBe("1");
  const confirm = screen.shadowRoot!.querySelector<HTMLElement>("[data-serve-confirm]")!;
  screen.remove();
  confirm.click();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  expect(count(screen)).toBe("1");
  expect(app.commands).toEqual([]);
});
it("Keep restores native focus and repeated Escape opens only one question", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dec]");
  const increase = screen
    .shadowRoot!.querySelector("[data-serve-inc]")!
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  increase.focus();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => q.open).toBe(false);
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(
    increase.getRootNode() instanceof ShadowRoot &&
      (increase.getRootNode() as ShadowRoot).activeElement,
  ).toBe(increase);
  expect(count(screen)).toBe("1");
  expect(app.commands).toEqual([]);
});
it("changing the shown bill aborts an old serving question without a command", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dec]");
  await click(screen, "[data-serve-dismiss]");
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  screen.orderId = "wo-next";
  await screen.updateComplete;
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  await screen.updateComplete;
  expect(dialog.open).toBe(false);
  expect(unload()).toBe(false);
  expect(app.commands).toEqual([]);
});
it("a clean asynchronous Back cannot dismiss a replacement serving choice", async () => {
  const { screen, dialog } = await mount();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-serve-dismiss]")!.click();
  screen.shadowRoot!.querySelector<HTMLElement>('[data-serve-row="dish"]')!.click();
  await screen.updateComplete;
  await dialog.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(dialog.open).toBe(true);
  expect(count(screen)).toBe("2");
});

it("an untouched count closes directly without warning or command", async () => {
  const { app, screen, dialog } = await mount();
  await click(screen, "[data-serve-dismiss]");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(false);
  expect(app.commands).toEqual([]);
});

it("an enclosing leave asks about this child and resets only its local choice", async () => {
  const { app, screen } = await mount();
  await click(screen, "[data-serve-dec]");
  let leaves = 0;
  const kept = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => {
      leaves++;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await kept).toBe("kept");
  expect(leaves).toBe(0);
  expect(unload()).toBe(true);
  const discarded = app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => {
      leaves++;
    },
  });
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(leaves).toBe(1);
  expect(count(screen)).toBe("2");
  expect(app.commands).toEqual([]);
  expect(unload()).toBe(false);
});
