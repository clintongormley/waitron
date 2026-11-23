import { createFreshSignInGate } from "../api/fresh-sign-in.js";
import { FreshSignInDialog } from "../widgets/fresh-sign-in-dialog.js";
import type { LitElement } from "lit";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ServersScreen } from "./servers-screen.js";
import { DashboardApi, type ServerListing } from "../api/client.js";
const listing: ServerListing = {
  term: 2,
  nodes: [
    {
      nodeId: "old",
      contactUrl: "https://old.example",
      standing: "serving-primary",
      isSelf: true,
      removable: false,
      canClear: false,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      canWipeWithLoss: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
    },
    {
      nodeId: "new",
      contactUrl: "https://new.example",
      standing: "serving-secondary",
      isSelf: false,
      removable: true,
      canClear: false,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      canWipeWithLoss: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
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
it("offers no handover action without node.manage", async () => {
  const { el } = await mount({ permission: false });
  expect(q(el, "wt-data-table").shadowRoot!.querySelector('[data-test="handover-new"]')).toBeNull();
});
it("a passkey-only account cannot start the handover", async () => {
  const { el, start } = await mount({ password: false });
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error,
    ).toContain("This account has no password"),
  );
  expect(
    (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  expect(
    (q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error,
  ).toContain(t("profile.password_recovery"));
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
it("shows an in-progress refusal naming another operation without reading status", async () => {
  const { el, start, status } = await mount();
  start.mockRejectedValue({
    code: "handover.operation_in_progress",
    status: 409,
    params: { operationId: "33333333-3333-4333-8333-333333333333" },
  });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      codeMessage("handover.operation_in_progress"),
    ),
  );
  expect(status).not.toHaveBeenCalled();
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).not.toBe(start.mock.calls[0]![0].operationId);
});
it("shows a waiting-return refusal naming the open takeover without reading status", async () => {
  const { el, start, status } = await mount();
  start.mockRejectedValue({
    code: "handover.return_outstanding",
    status: 409,
    params: { operationId: "33333333-3333-4333-8333-333333333333", sourceNodeId: "gone" },
  });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
      codeMessage("handover.return_outstanding"),
    ),
  );
  expect(status).not.toHaveBeenCalled();
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start.mock.calls[1]![0].operationId).not.toBe(start.mock.calls[0]![0].operationId);
});
it.each(["handover.operation_in_progress", "handover.return_outstanding"])(
  "reads its own operation's status after %s naming that operation",
  async (code) => {
    const { el, start, status } = await mount();
    start.mockImplementation(({ operationId }: { operationId: string }) =>
      Promise.reject({ code, status: 409, params: { operationId } }),
    );
    await open(el);
    q(el, "[data-test=confirm-handover]").click();
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(status).toHaveBeenCalledWith(start.mock.calls[0]![0].operationId);
  },
);
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

it("the handover prompt refuses recovery codes before sending and continues with a current code", async () => {
  const own = await (await mount()).el.api.getProfile();
  cleanupWidgets();
  const confirmations: unknown[] = [];
  const starts: unknown[] = [];
  const dialog = new FreshSignInDialog();
  const gate = createFreshSignInGate({
    sessionGeneration: () => 0,
    prompt: (signal, context) => dialog.show(signal, context),
  });
  const api = new DashboardApi(
    "",
    async (path, init) => {
      if (String(path).endsWith("/servers")) return new Response(JSON.stringify(listing));
      if (String(path).endsWith("/profile")) return new Response(JSON.stringify(own));
      if (String(path).endsWith("/fresh-sign-in")) {
        confirmations.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({}));
      }
      starts.push(JSON.parse(String(init.body)));
      return confirmations.length
        ? new Response(JSON.stringify({ handoverPage: "https://new.example/handover/move" }))
        : new Response(
            JSON.stringify({ error: { code: "management_session.proof_required", params: {} } }),
            { status: 400 },
          );
    },
    undefined,
    undefined,
    false,
    { sessionGeneration: () => 0, freshSignIn: gate },
  );
  dialog.api = api.background;
  const { el, host } = await mountWidget<ServersScreen>("dashboard-servers-screen", {
    api,
    canPromote: true,
  });
  host.appendChild(dialog);
  const navigate = vi.fn();
  host.addEventListener("handover-open", navigate);
  await vi.waitFor(() =>
    expect(q(q(el, "wt-data-table"), '[data-test="handover-new"]')).not.toBeNull(),
  );
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect(
      q(dialog, "dashboard-fresh-sign-in")?.shadowRoot?.querySelector("wt-input[name=totp]"),
    ).toBeTruthy(),
  );
  const signIn = q(dialog, "dashboard-fresh-sign-in");
  const fill = async (name: string, value: string) => {
    const field = q(signIn, `[name="${name}"]`) as LitElement;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  };
  await fill("current-password", "secret");
  await fill("totp", "recovery-code");
  q(dialog, "[data-test=confirm-proof]").click();
  await vi.waitFor(() => {
    expect(confirmations).toEqual([]);
    expect((q(signIn, '[name="totp"]') as HTMLElement & { error: string }).error).not.toBe("");
  });
  expect(starts).toHaveLength(1);
  await fill("totp", "123456");
  await vi.waitFor(() =>
    expect(
      (q(dialog, "[data-test=confirm-proof]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  q(dialog, "[data-test=confirm-proof]").click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  expect(confirmations).toEqual([{ method: "password", password: "secret", totp: "123456" }]);
  expect(starts).toEqual([starts[0], starts[0]]);
});

it.each([
  ["en-GB", "Open the box's HTTPS address"],
  ["es-ES", codeMessage("node.operation_page_required", "es-ES")],
])("explains the handover connection refusal in %s", async (locale, words) => {
  const { el, start, status } = await mount();
  setLocale(locale);
  expect(words).toContain("HTTPS");
  if (locale === "es-ES") expect(words).not.toContain("This operation");
  const real = new DashboardApi(
    "",
    async () =>
      new Response(
        JSON.stringify({
          error: { code: "node.operation_page_required", params: {} },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
  );
  start.mockImplementation((input) => real.startHandover(input));
  status.mockRejectedValue({ code: "handover.operation_unknown", status: 404 });
  await open(el);
  q(el, "[data-test=confirm-handover]").click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=handover-dialog]").shadowRoot!.textContent).toContain(words),
  );
});
it("sends one handover when Hand over is pressed twice before the dialog redraws", async () => {
  const { el, start, status } = await mount();
  start.mockReturnValue(new Promise(() => {}));
  await open(el);
  const confirm = q(el, "[data-test=confirm-handover]");
  confirm.click();
  confirm.click();
  await vi.waitFor(() => expect(start).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(start).toHaveBeenCalledTimes(1);
  expect(status).not.toHaveBeenCalled();
});
it("a passkey-only account's Hand over sends nothing even when the button is pressed", async () => {
  const { el, start } = await mount({ password: false });
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await vi.waitFor(() => expect(el.api.getProfile).toHaveBeenCalled());
  await el.updateComplete;
  q(el, "[data-test=confirm-handover]").click();
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(start).not.toHaveBeenCalled();
  expect((q(el, "[data-test=handover-actions]") as HTMLElement & { error: string }).error).toBe(
    `${t("servers.handover_no_password")} ${t("profile.password_recovery")}`,
  );
});
it("Stop closes the handover dialog without sending anything", async () => {
  const { el, start } = await mount();
  await open(el);
  q(el, "[data-test=stop-handover]").click();
  await vi.waitFor(() =>
    expect((q(el, "[data-test=handover-dialog]") as HTMLElement & { open: boolean }).open).toBe(
      false,
    ),
  );
  expect(start).not.toHaveBeenCalled();
});
it.each([
  ["the start answer", "start"],
  ["a refused start", "refused"],
  ["the status answer", "status"],
] as const)(
  "opens no handover page when %s arrives after the screen has gone",
  async (_label, path) => {
    const { el, start, status } = await mount();
    let finish!: () => void;
    const late = new Promise<void>((resolve) => (finish = resolve));
    const page = { handoverPage: "https://new.example/handover/move" };
    if (path === "start") start.mockReturnValue(late.then(() => page));
    if (path === "refused")
      start.mockReturnValue(late.then(() => Promise.reject({ code: "connection.failed" })));
    if (path === "status") {
      start.mockResolvedValue({});
      status.mockReturnValue(late.then(() => page));
    }
    const navigate = vi.fn();
    el.addEventListener("handover-open", navigate);
    await open(el);
    q(el, "[data-test=confirm-handover]").click();
    if (path === "status") await vi.waitFor(() => expect(status).toHaveBeenCalled());
    else await vi.waitFor(() => expect(start).toHaveBeenCalled());
    el.remove();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(path === "status" ? 1 : 0);
  },
);
it("ignores a failed profile read for a spare whose dialog was closed", async () => {
  const two = structuredClone(listing);
  two.nodes.push({ ...two.nodes[1]!, nodeId: "other", contactUrl: "https://other.example" });
  const { el } = await mount({ listing: two });
  let fail!: (error: unknown) => void;
  vi.mocked(el.api.getProfile).mockReturnValueOnce(
    new Promise((_resolve, reject) => (fail = reject)),
  );
  q(q(el, "wt-data-table"), '[data-test="handover-new"]').click();
  await el.updateComplete;
  const handoverDialog = () =>
    q(el, "[data-test=handover-dialog]") as HTMLElement & { open: boolean };
  const closed = new Promise((resolve) =>
    handoverDialog().addEventListener("wt-close", resolve, { once: true }),
  );
  q(el, "[data-test=stop-handover]").click();
  await closed;
  await el.updateComplete;
  q(q(el, "wt-data-table"), '[data-test="handover-other"]').click();
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  expect(handoverDialog().open).toBe(true);
  expect(q(el, "p.target").textContent).toContain("other.example");
  fail({ code: "connection.failed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(q(el, "[data-test=retry-handover-profile]")).toBeNull();
  expect(
    (q(el, "[data-test=confirm-handover]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(false);
});
