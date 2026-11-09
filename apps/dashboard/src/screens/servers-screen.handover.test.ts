import { currentLocale, setLocale } from "../i18n/t.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ServersScreen } from "./servers-screen.js";
import { DashboardApi, type ServerListing } from "../api/client.js";
const listing: ServerListing = {
  term: 2,
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
      removable: true,
      canClear: false,
    },
  ],
};
const originalLocale = currentLocale();
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});
async function mount(options: { permission?: boolean; password?: boolean; lost?: boolean } = {}) {
  const start = vi.fn().mockResolvedValue({ handoverPage: "https://new.example/handover/move" });
  if (options.lost) start.mockRejectedValue(new TypeError("network lost"));
  const status = vi.fn().mockResolvedValue({ handoverPage: "https://new.example/handover/move" });
  const api = {
    listServers: vi.fn().mockResolvedValue(listing),
    startHandover: start,
    handoverStatus: status,
    getProfile: vi.fn().mockResolvedValue({
      displayName: "Owner",
      firstNames: null,
      lastNames: null,
      telephone: null,
      email: "owner@example.com",
      pendingEmail: null,
      locale: "en",
      hasPassword: options.password !== false,
      hasTotp: true,
      hasGoogle: false,
      passkeys: [],
    }),
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  const { el, host } = await mountWidget<ServersScreen>("dashboard-servers-screen", {
    api,
    canPromote: options.permission !== false,
  });
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("wt-data-table")!
        .shadowRoot!.querySelector('[data-row-key="new"]'),
    ).not.toBeNull(),
  );
  return { el, host, start, status };
}
const q = (el: HTMLElement, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
async function open(el: ServersScreen) {
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() => expect(q(el, "dashboard-fresh-sign-in")).not.toBeNull());
  const sign = q(el, "dashboard-fresh-sign-in") as LitElement;
  await vi.waitFor(() => expect(q(sign, '[name="current-password"]')).not.toBeNull());
  for (const [name, value] of [
    ["current-password", "secret"],
    ["totp", "123456"],
  ]) {
    const field = q(sign, `[name="${name}"]`) as LitElement;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = value!;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  await el.updateComplete;
}
it("asks for fresh password and authenticator before handing over to the selected spare", async () => {
  const { el, host, start } = await mount();
  const navigate = vi.fn();
  host.addEventListener("handover-open", navigate);
  await open(el);
  expect(start).not.toHaveBeenCalled();
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0]![0]).toMatchObject({
    destinationNodeId: "new",
    signIn: { method: "password", password: "secret", totp: "123456" },
  });
  expect(start.mock.calls[0]![0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(navigate.mock.calls[0]![0].detail.url).toBe("https://new.example/handover/move");
});
it("recovers a lost start answer through the public status with the original operation id", async () => {
  const { el, host, start, status } = await mount({ lost: true });
  const navigate = vi.fn();
  host.addEventListener("handover-open", navigate);
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(status).toHaveBeenCalledWith(start.mock.calls[0]![0].operationId);
  expect(start).toHaveBeenCalledTimes(1);
});
it("refuses a recovery code before it can stop sales", async () => {
  const { el, start } = await mount();
  await open(el);
  const field = q(q(el, "dashboard-fresh-sign-in"), '[name="totp"]') as LitElement;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "recovery-code";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error,
    ).toContain("authenticator"),
  );
  expect(start).not.toHaveBeenCalled();
});

it("offers no handover action without node.promote", async () => {
  const { el } = await mount({ permission: false });
  expect(q(el, "wt-data-table").shadowRoot!.querySelector('[data-test="handover-new"]')).toBeNull();
});
it("a passkey-only account cannot start the handover", async () => {
  const { el, start } = await mount({ password: false });
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() => expect(q(el, "dashboard-fresh-sign-in")).not.toBeNull());
  await vi.waitFor(() =>
    expect(
      (q(el, "dashboard-fresh-sign-in") as HTMLElement & { ways: unknown }).ways,
    ).not.toBeNull(),
  );
  expect(
    (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  expect(start).not.toHaveBeenCalled();
});

it("reads the sign-in profile without extending the dashboard session", async () => {
  const reads: RequestInit[] = [];
  const api = new DashboardApi("", async (path, init) => {
    if (String(path).endsWith("/servers")) return new Response(JSON.stringify(listing));
    reads.push(init);
    return new Response(
      JSON.stringify({
        displayName: "Owner",
        hasPassword: true,
        hasTotp: false,
        hasGoogle: false,
        passkeys: [],
        email: "owner@example.com",
        firstNames: null,
        lastNames: null,
        telephone: null,
        pendingEmail: null,
        locale: "en",
      }),
    );
  });
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", {
    api,
    canPromote: true,
  });
  await vi.waitFor(() =>
    expect(q(q(el, "wt-data-table"), '[data-test="handover-new"]')).not.toBeNull(),
  );
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  expect(new Headers(reads[0]!.headers).get("x-waitron-live")).toBe("1");
});

it("starts a new operation after the source confirms the refused offer was abandoned", async () => {
  const { el, start, status } = await mount();
  start.mockRejectedValue({ code: "handover.modules_differ", status: 409 });
  status.mockResolvedValue({ state: "abandoned" });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).not.toBe(start.mock.calls[0]![0].operationId);
});
