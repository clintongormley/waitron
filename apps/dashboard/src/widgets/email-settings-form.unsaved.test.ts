import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget, reattachAfterDetachedUpdate } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import "./email-settings-form.js";

class EmailLeaveHost extends LitElement {
  api!: DashboardApi;
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-email-settings-form
        .api=${this.api}
        .settings=${{ server: "smtp.example.test", port: 465, encryption: "tls", from: "invoices@example.test", hasAuthentication: true }}
      ></dashboard-email-settings-form>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("email-leave-test-host", EmailLeaveHost);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Form = HTMLElementTagNameMap["dashboard-email-settings-form"];
const input = (form: Form, name: string) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${name}]`)!;
const click = (form: Form, name: string) =>
  form.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!.click();
async function change(form: Form, name: string, value: string) {
  input(form, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
async function mount(fail = false) {
  const api = {
    saveEmailSettings: vi.fn().mockImplementation(async () => {
      if (fail) throw { code: "connection.failed" };
      return { saved: true };
    }),
    testEmailSettings: vi.fn().mockResolvedValue({ accepted: false, code: "email.test_refused" }),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<EmailLeaveHost>("email-leave-test-host", { api });
  const form = app.shadowRoot!.querySelector("dashboard-email-settings-form")!;
  await form.updateComplete;
  return { app, form, api };
}
async function choose(app: EmailLeaveHost, decision: "keep" | "discard") {
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(confirmation.open).toBe(true));
  confirmation.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
  );
}
it.each(["en-GB", "es"])(
  "protects edited credentials on Cancel and reconnect in %s",
  async (locale) => {
    setLocale(locale);
    const { app, form } = await mount();
    const cancel = vi.fn();
    form.addEventListener("email-cancel", cancel);
    await change(form, "password", "new-secret");
    await reattachAfterDetachedUpdate(form);
    expect(input(form, "password").value).toBe("new-secret");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    click(form, "cancel");
    await choose(app, "keep");
    await vi.waitFor(() =>
      expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false),
    );
    expect(cancel).not.toHaveBeenCalled();
    click(form, "cancel");
    await choose(app, "discard");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(input(form, "password").value).toBe("");
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);
it("failed test and save keep the draft protected; a successful save commits before its event", async () => {
  const { app, form, api } = await mount(true);
  await change(form, "user", "invoice-user");
  await change(form, "password", "new-secret");
  click(form, "test");
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
  );
  expect(app.leave.coordinator.isDirty()).toBe(true);
  click(form, "save");
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toBeTruthy(),
  );
  expect(input(form, "password").value).toBe("new-secret");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  vi.mocked(api.saveEmailSettings).mockResolvedValue({ saved: true });
  let dirtyAtEvent: boolean | undefined;
  form.addEventListener("email-saved", () => {
    dirtyAtEvent = app.leave.coordinator.isDirty();
  });
  click(form, "save");
  await vi.waitFor(() => expect(dirtyAtEvent).toBe(false));
});
