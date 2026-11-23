import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtInput } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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
  pairedAudit: {
    complete: false,
    matched: 1,
    toCheck: 2,
    rows: (
      [
        "refunded_at_sumup",
        "matched",
        "refunded_before_check",
        "resolved",
        "partly_refunded_before_check",
      ] as const
    ).map((status, index) => ({
      paymentRef: `paired-${index}`,
      references: [`charge-${index}`],
      amount: status === "partly_refunded_before_check" ? "10.00" : "42.50",
      settledAt: "2026-07-01T18:46:00.000Z",
      readerName: index === 0 ? "Terrace reader" : "Counter reader",
      billNumber: index === 0 ? 41 : null,
      orderNumber: 41 + index,
      tableName: index === 0 ? "Table 6" : null,
      statuses: [status],
    })),
  },
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

it("shows standalone matches and exceptions, filters paired readers and reads a changed day passively", async () => {
  const changedDay = {
    ...result,
    day: "2026-07-02",
    pairedAudit: { complete: true, matched: 0, toCheck: 0, rows: [] },
  };
  const fetch = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async (path) => new Response(JSON.stringify(path.includes("?day=") ? changedDay : result)),
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
  expect(el.shadowRoot!.textContent).toContain("1 matched · 2 to check");
  expect(el.shadowRoot!.textContent).toContain("Check incomplete.");
  const pairedTable = () => el.shadowRoot!.querySelector("wt-data-table")?.shadowRoot;
  const pairedRows = () => [...(pairedTable()?.querySelectorAll("tbody tr") ?? [])];
  await expect.poll(() => pairedRows().length).toBe(2);
  expect(pairedRows()[0]!.textContent).toContain("Terrace reader");
  expect(pairedRows()[0]!.textContent).toContain("Table 6 · bill 41");
  expect(pairedRows()[0]!.textContent).toContain("Refunded at SumUp only");
  expect(pairedRows()[1]!.textContent).toContain("Partly refunded before the check");
  expect(pairedRows()[1]!.querySelector("td[data-align=end]")!.textContent).toContain("10.00");
  const status = el.shadowRoot!.querySelector("wt-combobox")!;
  await chooseOption(status, "matched");
  await expect.poll(() => pairedRows().length).toBe(2);
  expect(pairedRows()[0]!.textContent).toContain("Order 42");
  expect(pairedRows()[1]!.textContent).toContain("Refunded before the check");
  await chooseOption(status, "resolved");
  await expect.poll(() => pairedRows()[0]?.textContent).toContain("Resolved");
  await chooseOption(status, "all");
  await expect.poll(() => pairedRows().length).toBe(5);
  const day = el.shadowRoot!.querySelector<WtInput>("wt-input")!;
  day.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "2026-07-02" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => fetch.mock.calls.length).toBe(2);
  await expect.poll(() => el.shadowRoot!.textContent).toContain("0 matched · 0 to check");
  expect(el.shadowRoot!.textContent).not.toContain("Check incomplete.");
  expect(pairedRows()).toHaveLength(0);
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
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const pairedScroll = table.shadowRoot!.querySelector('[role="region"]')!;
  expect(pairedScroll.scrollWidth).toBeLessThanOrEqual(pairedScroll.clientWidth);
  const amount = document.createRange();
  amount.selectNodeContents(pairedScroll.querySelector("tbody td[data-align=end]")!);
  expect(amount.getClientRects()).toHaveLength(1);
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
    exceptions: [
      { ...row, reason: "not_found" },
      { ...row, reason: "not_checked" },
      {
        ...row,
        reason: "missing_reference",
        processorRef: null,
        providerRefundRef: null,
        providerAt: null,
        localAt: null,
      },
      { ...row, reason: "void", providerAt: null, localAt: null },
    ],
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
    "Refund not checked against SumUp yet",
    "Date unknown",
    "No reference: check in SumUp. Entries may describe the same refund.",
  ])
    expect(el.shadowRoot!.textContent).toContain(text);
});
