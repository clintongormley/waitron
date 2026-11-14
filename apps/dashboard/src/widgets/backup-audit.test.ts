import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtInput } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "../screens/payments-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
  vi.restoreAllMocks();
});
const result = {
  day: "2026-07-01",
  timeZone: "Europe/Madrid",
  complete: false,
  backupMatches: [
    {
      references: ["charge-7"],
      amount: "10.25",
      settledAt: "2026-07-01T12:00:00.000Z",
      paymentRef: "manual-7",
      workingOrderId: "order-7",
      externalMachine: "Backup Solo",
      externalRef: "operation-7",
    },
  ],
  refundAudit: {
    complete: false,
    checkedAt: ["2026-07-03T00:05:00.000Z"],
    matches: [
      {
        reason: "confirmed",
        processorRef: "charge-r",
        providerRefundRef: "refund-r",
        paymentRef: "payment-r",
        workingOrderId: "order-r",
        externalMachine: null,
        externalRef: null,
        providerAmount: "2.35",
        localAmount: "2.35",
        providerAt: "2026-07-01T13:00:00.000Z",
        localAt: "2026-07-01T13:01:00.000Z",
      },
    ],
    agreements: [],
    exceptions: [],
    outside: [],
  },
  backupUnmatched: [
    {
      kind: "recorded",
      references: [],
      amount: "42.00",
      settledAt: "2026-07-01T15:00:00.000Z",
      reason: "unmatched",
      paymentRef: "recorded-42",
      workingOrderId: "order-42",
      externalMachine: "Second Solo",
      externalRef: "operation-42",
    },
    {
      references: ["ambiguous-8"],
      amount: "10.25",
      settledAt: "2026-07-01T13:00:00.000Z",
      reason: "ambiguous",
    },
    {
      references: ["unknown-9"],
      amount: "5.00",
      settledAt: "2026-07-01T14:00:00.000Z",
      reason: "unmatched",
    },
  ],
};

it("shows matches and exceptions, and reads a changed day passively", async () => {
  const fetch = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(result)),
  );
  const activity = vi.fn();
  const api = new DashboardApi("", fetch, undefined, activity);
  const { el } = await mountWidget<LitElement>("dashboard-backup-audit", { api } as never);
  await expect.poll(() => el.shadowRoot?.textContent).toContain("Backup Solo");
  for (const text of [
    "operation-7",
    "manual-7",
    "order-7",
    "charge-7",
    "ambiguous-8",
    "unknown-9",
    "recorded-42",
    "order-42",
    "Second Solo",
    "operation-42",
    t("payments.backup.incomplete"),
    t("payments.backup.ambiguous"),
    t("payments.backup.unmatched"),
    t("payments.backup.recorded_unmatched"),
  ])
    expect(el.shadowRoot!.textContent).toContain(text);
  const day = el.shadowRoot!.querySelector<WtInput>("wt-input")!;
  day.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "2026-07-02" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => fetch.mock.calls.length).toBe(2);
  expect(fetch.mock.calls[1]![0]).toBe("/management-api/payments/backup-audit?day=2026-07-02");
  expect(new Headers(fetch.mock.calls[0]![1].headers).get("x-waitron-live")).toBe("1");
  expect(new Headers(fetch.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(activity).not.toHaveBeenCalled();
});

it("keeps a failed read visible and lets the manager retry", async () => {
  const api = {
    getBackupAudit: vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue({ ...result, complete: true, backupMatches: [], backupUnmatched: [] }),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<LitElement>("dashboard-backup-audit", { api } as never);
  await expect.poll(() => el.shadowRoot?.querySelector('[role="alert"]')).toBeTruthy();
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  await expect.poll(() => el.shadowRoot?.textContent).toContain(t("payments.backup.empty"));
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
});

it.each(
  (["en", "es"] as const).flatMap((locale) =>
    (["light", "dark"] as const).flatMap((theme) =>
      [390, 1200].map((width) => ({ locale, theme, width })),
    ),
  ),
)("renders the backup comparison at $width in $locale/$theme", async ({ locale, theme, width }) => {
  setLocale(locale);
  await page.viewport(width, 900);
  const { el, host } = await mountWidget<LitElement>(
    "dashboard-backup-audit",
    { api: { getBackupAudit: async () => result } } as never,
    theme,
  );
  await expect.poll(() => el.shadowRoot?.textContent).toContain("Backup Solo");
  await expectNoA11yViolations(host);
  expect(host.scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot({
    path: `__screenshots__/a949-refunds/${locale}-${theme}-${width}.png`,
    fullPage: true,
  });
});

it("shows refund identity, evidence labels and checked times separately from backup payments", async () => {
  const row = result.refundAudit.matches[0]!;
  const refundAudit = {
    ...result.refundAudit,
    agreements: [{ ...row, reason: "amount_agreement" }],
    exceptions: [{ ...row, reason: "not_found" }],
    outside: [{ ...row, reason: "outside" }],
  };
  const { el } = await mountWidget<LitElement>("dashboard-backup-audit", {
    api: { getBackupAudit: async () => ({ ...result, refundAudit }) },
  } as never);
  await expect.poll(() => el.shadowRoot?.textContent).toContain("refund-r");
  for (const text of [
    "Confirmed refund matches",
    "Unverified agreements",
    "Refunds to check",
    "Recorded outside this comparison",
    "Provider detail not found",
    "Provider checked",
    "Local record",
    "SumUp record",
  ])
    expect(el.shadowRoot!.textContent).toContain(text);
});
