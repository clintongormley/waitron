import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
class Host extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-servers-screen
        .api=${this.api}
        .canPromote=${true}
      ></dashboard-servers-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("handover-leave-test", Host);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("keeps an entered password on Keep editing, and clears it when discarded", async () => {
  setLocale("en-GB");
  const api = {
    listServers: vi.fn().mockResolvedValue({
      term: 1,
      authorityFingerprint: null,
      nodes: [
        {
          nodeId: "old",
          contactUrl: "https://old.example",
          standing: "serving-primary",
          isSelf: true,
          removable: false,
          canClear: false,
        },
        {
          nodeId: "new",
          contactUrl: "https://new.example",
          standing: "serving-secondary",
          isSelf: false,
          removable: false,
          canClear: false,
        },
      ],
    }),
    getProfile: vi.fn().mockResolvedValue({
      displayName: "Owner",
      hasPassword: true,
      hasTotp: false,
      passkeys: [],
      email: "owner@example.com",
      firstNames: null,
      lastNames: null,
      telephone: null,
      pendingEmail: null,
      locale: "en",
      hasGoogle: false,
    }),
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  const { el: host } = await mountWidget<Host>("handover-leave-test", { api });
  const screen = host.shadowRoot!.querySelector<ServersScreen>("dashboard-servers-screen")!;
  await vi.waitFor(() =>
    expect(
      screen
        .shadowRoot!.querySelector("wt-data-table")!
        .shadowRoot!.querySelector('[data-test="handover-new"]'),
    ).not.toBeNull(),
  );
  screen
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>('[data-test="handover-new"]')!
    .click();
  await vi.waitFor(() =>
    expect(
      screen
        .shadowRoot!.querySelector("dashboard-fresh-sign-in")
        ?.shadowRoot?.querySelector('[name="current-password"]'),
    ).toBeTruthy(),
  );
  const field = screen
    .shadowRoot!.querySelector("dashboard-fresh-sign-in")!
    .shadowRoot!.querySelector<LitElement>('[name="current-password"]')!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "private";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  for (const decision of ["keep", "discard"] as const) {
    const request = host.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await vi.waitFor(() =>
      expect(
        (host.shadowRoot!.querySelector("wt-unsaved-changes") as HTMLElement & { open: boolean })
          .open,
      ).toBe(true),
    );
    host
      .shadowRoot!.querySelector("wt-unsaved-changes")!
      .dispatchEvent(new CustomEvent("wt-unsaved-choice", { detail: { decision } }));
    await request;
    await field.updateComplete;
    expect(input.value).toBe(decision === "keep" ? "private" : "");
  }
});
