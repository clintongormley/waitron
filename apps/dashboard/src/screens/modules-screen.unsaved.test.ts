import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, registerIcons, type WtDialog, type WtInput } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { modulesClient } from "./modules-screen.test-support.js";
import { ModulesScreen } from "./modules-screen.js";
registerIcons(DASHBOARD_ICONS);
class ModulesLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  request!: DashboardRequest;
  override render() {
    return html`<dashboard-modules-screen
        .api=${this.api}
        .request=${this.request}
      ></dashboard-modules-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("modules-leave-test", ModulesLeaveApp);
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/modules");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(
  provider = "stripe",
  request = vi.fn(async () => ({ merchantName: "Restaurant" })) as unknown as DashboardRequest,
  api = modulesClient(),
) {
  const { el: app } = await mountWidget<ModulesLeaveApp>("modules-leave-test", { api, request });
  const screen = app.shadowRoot!.querySelector<ModulesScreen>("dashboard-modules-screen")!;
  await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() =>
    expect(table.shadowRoot!.querySelector(`[data-test=configure-${provider}]`)).not.toBeNull(),
  );
  table.shadowRoot!.querySelector<HTMLElement>(`[data-test=configure-${provider}]`)!.click();
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const form = dialog.querySelector<LitElement>(`${provider}-connect-form`)!;
  await form.updateComplete;
  return { app, screen, dialog, form, api };
}
async function field(form: LitElement, name = "secret-key", value = "sk_test_synthetic") {
  const input = form.shadowRoot!.querySelector<WtInput>(`[data-test=${name}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
  return input;
}
async function choose(app: ModulesLeaveApp, choice: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await vi.waitFor(() => expect(question.open).toBe(false));
}
for (const reason of ["escape", "back"] as const) {
  it(`protects the provider draft on ${reason}, and Discard closes only its window`, async () => {
    const { app, screen, dialog, form } = await mount();
    const input = await field(form);
    async function close() {
      if (reason === "escape") await userEvent.keyboard("{Escape}");
      else
        void app.leave.coordinator.request({
          scopes: "all",
          reason: "navigation",
          proceed: () => {
            history.replaceState(null, "", "/manage");
            screen.remove();
          },
        });
    }
    await close();
    await choose(app, "keep");
    expect(input.value).toBe("sk_test_synthetic");
    expect(dialog.open).toBe(true);
    expect(location.pathname).toBe("/manage/modules");
    await close();
    await choose(app, "discard");
    await vi.waitFor(() =>
      expect(
        reason === "back" ? screen.isConnected : !!screen.shadowRoot!.querySelector("wt-dialog"),
      ).toBe(false),
    );
  });
}
it.each([
  {
    provider: "sumup",
    input: "api-key",
    value: "synthetic-key",
    body: { apiKey: "synthetic-key" },
  },
  {
    provider: "stripe",
    input: "secret-key",
    value: "sk_test_synthetic",
    body: { secretKey: "sk_test_synthetic", webhookSecret: "", successUrl: "", cancelUrl: "" },
  },
])(
  "configures $provider through its real contributed form and closes before a failed refresh",
  async ({ provider, input, value, body }) => {
    const request = vi.fn(async () => ({
      merchantName: "Restaurant",
    })) as unknown as DashboardRequest;
    const { screen, form, api } = await mount(provider, request);
    const save =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=connect]")!;
    expect(save.textContent?.trim()).toBe("Save");
    expect(save.disabled).toBe(true);
    expect(save.variant).toBe("secondary");
    await field(form, input, value);
    expect(save.disabled).toBe(false);
    vi.mocked(api.listModules).mockRejectedValue({ code: "connection.failed" });
    vi.mocked(api.listPaymentProviders).mockResolvedValue([
      { providerId: "sumup", state: "connected", canUnpair: true },
      { providerId: "stripe", state: "connected", canUnpair: false },
    ]);
    save.click();
    await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-dialog")).toBeNull());
    await vi.waitFor(() =>
      expect(
        screen
          .shadowRoot!.querySelector("wt-data-table")!
          .shadowRoot!.querySelector(`[data-row-key="card-provider:${provider}"]`)!.textContent,
      ).toContain("Configured"),
    );
    expect(request).toHaveBeenCalledWith(
      `/management-api/payments/providers/${provider}/connect`,
      "POST",
      body,
    );
    await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(screen.shadowRoot!.querySelector("[role=alert]")?.textContent).not.toContain("saved");
  },
);
it("keeps a refused save's draft and allows a corrected retry", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce({ code: "payment.provider_credential_rejected" })
    .mockResolvedValue({ merchantName: "Restaurant" }) as unknown as DashboardRequest;
  const { screen, form } = await mount("stripe", request);
  const input = await field(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("wt-form-actions")?.textContent).toContain("Save"),
  );
  await vi.waitFor(() =>
    expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).toContain("not accepted"),
  );
  expect(input.value).toBe("sk_test_synthetic");
  await field(form, "secret-key", "sk_test_corrected");
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
  await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-dialog")).toBeNull());
});
it("keeps the configuration window open while its write is pending", async () => {
  let finish!: (value: { merchantName: string }) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as unknown as DashboardRequest;
  const { screen, dialog, form } = await mount("stripe", request);
  await field(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  await screen.updateComplete;
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=connect]")!
      .variant,
  ).toBe("primary");
  expect(await dialog.requestClose("escape")).toBe(false);
  expect(dialog.open).toBe(true);
  finish({ merchantName: "Restaurant" });
  await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-dialog")).toBeNull());
});

it("Cancel discards the provider draft without an extra question", async () => {
  const { app, screen, dialog, form } = await mount();
  await field(form);
  await dialog.requestClose("cancel");
  await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-dialog")).toBeNull());
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
