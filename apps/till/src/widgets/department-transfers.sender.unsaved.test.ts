import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { mountWidget, cleanupWidgets } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
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
class SenderLeaveApp extends LitElement {
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
            : { destinations: [{ id: "restaurant", name: "Restaurant" }] },
      ),
      { status: refused ? 409 : 200, headers: { "content-type": "application/json" } },
    );
  });
  override render() {
    return html`<till-department-transfers
        .api=${this.api}
        .open=${this.open}
        .currentTabId=${"tab"}
        .currentTabLabel=${"Tab 12 — Lunch"}
        .snapshot=${{ incoming: [], sent: [], notifications: [], receivingAllowed: true, error: undefined }}
        @close-transfers=${() => {
          this.closes++;
          this.open = false;
          this.requestUpdate();
        }}
      ></till-department-transfers
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("transfer-sender-leave-test-app", SenderLeaveApp);
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<SenderLeaveApp>("transfer-sender-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillDepartmentTransfers>("till-department-transfers")!;
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-request-transfer]")!.click();
  await vi.waitFor(() =>
    expect(
      form.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
        ?.disabled,
    ).toBe(false),
  );
  const field = form.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown>; value: string }
  >("wt-combobox")!;
  await field.updateComplete;
  field.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "restaurant" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  const input = field;
  return { app, form, input };
}
async function question(app: SenderLeaveApp) {
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
  it(`${action} keeps a destination draft, then discards without writing`, async () => {
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
    expect(input.value).toBe("restaurant");
    expect(app.closes).toBe(0);
    expect(app.writes).toEqual([]);
    form.shadowRoot!.querySelector<HTMLElement>("[data-cancel-transfer]")!.click();
    await expect.poll(() => q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect
      .poll(() => form.shadowRoot!.querySelector("[name=destinationDepartmentId]"))
      .toBeNull();
    expect(unload()).toBe(false);
    expect(app.writes).toEqual([]);
  });
}
it("a transfer request commits the draft before notifying its parent", async () => {
  const { app, form } = await mount();
  const dirtyAtNotification: boolean[] = [];
  form.addEventListener("transfer-changed", () => dirtyAtNotification.push(unload()));
  form.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
  await vi.waitFor(() => expect(app.writes).toEqual([{ destinationDepartmentId: "restaurant" }]));
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("[name=destinationDepartmentId]")).toBeNull(),
  );
  expect(unload()).toBe(false);
  expect(dirtyAtNotification).toEqual([false]);
});
it("a refused request and a parent rerender keep the chosen destination protected", async () => {
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
  expect(input.value).toBe("restaurant");
  expect(unload()).toBe(true);
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel-transfer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  form.remove();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(false);
  expect(unload()).toBe(false);
});
