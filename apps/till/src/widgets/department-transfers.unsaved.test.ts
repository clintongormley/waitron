import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { mountWidget, cleanupWidgets } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import type { DepartmentTransferDetail } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";
import { t } from "../i18n/t.js";
const request = {
  id: "one",
  tabId: "tab",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "ana",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending" as const,
  reason: null,
  createdAt: "2026-10-07T09:00:00Z",
  resolvedAt: null,
  revision: 0,
};
const detail: DepartmentTransferDetail = {
  request,
  tab: {
    id: "tab",
    revision: 7,
    status: "placed",
    label: null,
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [],
  outstandingWork: [],
};
class TransferLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  writes: unknown[] = [];
  refusal = false;
  open = true;
  api = new TillApi("", async (_, init) => {
    if (init?.method === "POST") this.writes.push(JSON.parse(String(init.body)));
    const refused = this.refusal && init?.method === "POST";
    return new Response(
      JSON.stringify(
        refused
          ? { error: { code: "department_transfer.not_pending", params: {} } }
          : init?.method === "POST"
            ? { ...request, status: "declined" }
            : detail,
      ),
      { status: refused ? 409 : 200, headers: { "content-type": "application/json" } },
    );
  });
  override render() {
    return html`<till-department-transfers
        .api=${this.api}
        .open=${this.open}
        .snapshot=${{ incoming: [request], sent: [], notifications: [], receivingAllowed: true, error: undefined }}
        @close-transfers=${() => {
          this.closes++;
          this.open = false;
          this.requestUpdate();
        }}
      ></till-department-transfers
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("transfer-leave-test-app", TransferLeaveApp);
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<TransferLeaveApp>("transfer-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillDepartmentTransfers>("till-department-transfers")!;
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-view]")!.click();
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[data-current-tab]")).not.toBeNull(),
  );
  form.shadowRoot!.querySelector<HTMLElement>("[data-decline]")!.click();
  await form.updateComplete;
  const field = form.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "wt-textarea",
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea")!;
  await userEvent.fill(page.elementLocator(input), "Closing soon");
  return { app, form, input };
}
async function question(app: TransferLeaveApp) {
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
for (const action of ["Cancel", "Escape", "Close"]) {
  it(`${action} keeps a decline draft, then discards without writing`, async () => {
    const { app, form, input } = await mount();
    expect(unload()).toBe(true);
    if (action === "Escape") await userEvent.keyboard("{Escape}");
    else
      form
        .shadowRoot!.querySelector<HTMLElement>(
          action === "Cancel" ? "[data-cancel-transfer]" : "[data-close-transfers]",
        )!
        .click();
    const q = await question(app);
    await expect.poll(() => q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("Closing soon");
    expect(app.closes).toBe(0);
    expect(app.writes).toEqual([]);
    form.shadowRoot!.querySelector<HTMLElement>("[data-cancel-transfer]")!.click();
    await expect.poll(() => q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => form.shadowRoot!.querySelector("wt-textarea")).toBeNull();
    expect(unload()).toBe(false);
    expect(app.writes).toEqual([]);
  });
}
it("a declined write commits the draft before notifying its parent", async () => {
  const { app, form } = await mount();
  const dirtyAtNotification: boolean[] = [];
  form.addEventListener("transfer-changed", () => dirtyAtNotification.push(unload()));
  form.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
  await vi.waitFor(() => expect(app.writes).toEqual([{ reason: "Closing soon" }]));
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-textarea")).toBeNull());
  expect(unload()).toBe(false);
  expect(dirtyAtNotification).toEqual([false]);
});
it("a refused decline and a parent rerender keep the typed reason protected", async () => {
  const { app, form, input } = await mount();
  app.refusal = true;
  form.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
  await vi.waitFor(() => expect(app.writes).toHaveLength(1));
  await vi.waitFor(() =>
    expect(
      form.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")!
        .disabled,
    ).toBe(false),
  );
  app.requestUpdate();
  await app.updateComplete;
  expect(input.value).toBe("Closing soon");
  expect(unload()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel-transfer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  form.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(false);
  expect(unload()).toBe(false);
});
