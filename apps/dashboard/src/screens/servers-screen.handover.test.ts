import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
async function mount(
  options: {
    permission?: boolean;
    password?: boolean;
    lost?: boolean;
    listing?: ServerListing;
  } = {},
) {
  const start = vi.fn().mockResolvedValue({ handoverPage: "https://new.example/handover/move" });
  if (options.lost) start.mockRejectedValue({ code: "connection.failed" });
  const status = vi.fn().mockResolvedValue({ handoverPage: "https://new.example/handover/move" });
  const api = {
    listServers: vi.fn().mockResolvedValue(options.listing ?? listing),
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
it.each(["source is not primary", "target is not spare", "target has no address"] as const)(
  "does not offer handover when %s",
  async (condition) => {
    const changed = structuredClone(listing);
    if (condition === "source is not primary") changed.nodes[0]!.standing = "serving-secondary";
    if (condition === "target is not spare") changed.nodes[1]!.standing = "serving-primary";
    if (condition === "target has no address") changed.nodes[1]!.contactUrl = "";
    const { el } = await mount({ listing: changed });
    expect(q(q(el, "wt-data-table"), '[data-test="handover-new"]')).toBeNull();
  },
);
async function open(el: ServersScreen) {
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
}
it("hands over to the selected spare without embedded credentials", async () => {
  const { el, host, start } = await mount();
  const navigate = vi.fn();
  host.addEventListener("handover-open", navigate);
  await open(el);
  expect(q(el, "dashboard-fresh-sign-in")).toBeNull();
  expect(start).not.toHaveBeenCalled();
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0]![0]).toEqual({
    destinationNodeId: "new",
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
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
it("offers no handover action without node.promote", async () => {
  const { el } = await mount({ permission: false });
  expect(q(el, "wt-data-table").shadowRoot!.querySelector('[data-test="handover-new"]')).toBeNull();
});
it("a passkey-only account cannot start the handover", async () => {
  const { el, start } = await mount({ password: false });
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      t("servers.handover_password"),
    ),
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

it.each([
  "handover.destination_unreachable",
  "handover.destination_not_joined",
  "handover.venue_not_supported",
  "handover.operation_in_progress",
])("shows an early %s refusal and allows a fresh attempt", async (code) => {
  const { el, start, status } = await mount();
  start.mockRejectedValue({ code, status: 409 });
  status.mockRejectedValue({ code: "handover.operation_unknown", status: 404 });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      codeMessage(code),
    ),
  );
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).not.toBe(start.mock.calls[0]![0].operationId);
});
it("keeps an unproved or cancelled shared sign-in available for retry without polling status", async () => {
  const { el, start, status } = await mount();
  start.mockRejectedValue({ code: "management_session.proof_required", status: 400 });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      codeMessage("management_session.proof_required"),
    ),
  );
  expect(status).not.toHaveBeenCalled();
  expect(q(el, "[data-test=stop-handover]").textContent?.trim()).toBe("Stop");
  start.mockResolvedValue({ handoverPage: "https://new.example/handover/move" });
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).toBe(start.mock.calls[0]![0].operationId);
});
it("offers Close rather than Stop once a lost request may already have started handover", async () => {
  const { el, status } = await mount({ lost: true });
  status.mockRejectedValue({ code: "connection.failed" });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=confirm-handover]").textContent).toContain("Check handover progress"),
  );
  expect(q(el, "[data-test=stop-handover]").textContent?.trim()).toBe("Close");
  expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
    t("servers.handover_reconnect"),
  );
});

it("keeps an early refusal through a lost status read and retries only after unknown operation is confirmed", async () => {
  const { el, start, status } = await mount();
  const refusal = { code: "handover.destination_unreachable", status: 409 };
  start.mockRejectedValue(refusal);
  status
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockRejectedValue({ code: "handover.operation_unknown", status: 404 });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=confirm-handover]").textContent).toContain("Check handover progress"),
  );
  expect(
    (q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error,
  ).toContain(codeMessage(refusal.code));
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      codeMessage(refusal.code),
    ),
  );
  expect(start).toHaveBeenCalledTimes(1);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).not.toBe(start.mock.calls[0]![0].operationId);
});

it("keeps Hand over quiet after a failed passive profile read and retries it", async () => {
  const { el, start } = await mount();
  vi.mocked(el.api.getProfile).mockRejectedValueOnce({ code: "connection.failed" });
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() => expect(q(el, "[data-test=retry-handover-profile]")).not.toBeNull());
  expect(
    (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  expect(start).not.toHaveBeenCalled();
  q(el, "[data-test=retry-handover-profile]").click();
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe("");
});
