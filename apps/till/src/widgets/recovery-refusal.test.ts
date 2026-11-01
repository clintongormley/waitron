import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { recoveryRefusalOf } from "./recovery-refusal.js";
import { refusalOf } from "../state/bill-payment.js";
import type { TillPresentedPayDialog } from "./presented-pay-dialog.js";
import "./presented-pay-dialog.js";
import "./bill-pay-dialog.js";
import "./bill-refund-dialog.js";
import "./tender-refund-dialog.js";
import "./cancel-credit-dialog.js";

let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

for (const locale of ["en", "es"] as const) {
  it.each([false, true])(
    `offers module recovery in ${locale} while preserving charged=%s`,
    async (charged) => {
      setLocale(locale);
      const refusal = refusalOf({
        code: charged ? "sale.charged_not_recorded" : "sif.allocation_invalid",
        reason: charged ? "issuance_refused" : "conflict_requires_administrator",
        recoveryUrl: "/manage/recovery/fiscal-conflict",
      });
      const { el } = await mountWidget<TillPresentedPayDialog>("till-presented-pay-dialog", {
        open: true,
        amount: "35.00",
        tableName: "Table 4",
        takesCash: true,
        refusal,
      });
      const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-recovery]");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/manage/recovery/fiscal-conflict");
      expect(link!.target).toBe("_blank");
      expect(link!.rel).toBe("noopener");
      expect(link!.textContent).toBe(locale === "en" ? "Open recovery" : "Abrir recuperación");
      const actions = el.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        "wt-form-actions",
      )!;
      expect(actions.error).toContain(
        locale === "en" ? "current recovery key" : "clave de recuperación actual",
      );
      if (charged)
        expect(actions.error).toContain(
          locale === "en" ? "Do not charge again" : "No vuelvas a cobrar",
        );
    },
  );
}

it.each([
  "/api/secret",
  "https://elsewhere.test/manage/recovery",
  "//elsewhere.test/manage/recovery",
  "/manage/../api/secret",
  "/manage/recovery?key=secret",
  "javascript:alert(1)",
  "\\\\elsewhere.test/manage/recovery",
])("does not turn an unsafe recovery destination into a link: %s", async (recoveryUrl) => {
  const { el } = await mountWidget<TillPresentedPayDialog>("till-presented-pay-dialog", {
    open: true,
    amount: "35.00",
    takesCash: true,
    refusal: refusalOf({ code: "sif.allocation_invalid", recoveryUrl }),
  });
  expect(el.shadowRoot!.querySelector("a[data-recovery]")).toBeNull();
});

const dialogCases = [
  {
    tag: "till-bill-pay-dialog",
    props: {
      balance: {
        workingOrderId: "bill",
        status: "open",
        total: "35.00",
        received: "0.00",
        reserved: "0.00",
        outstanding: "35.00",
        tips: "0.00",
        payments: [],
        paidLines: [],
      },
      lines: [],
      way: "items",
    },
  },
  {
    tag: "till-bill-refund-dialog",
    props: {
      payment: {
        id: "payment",
        submissionId: "submission",
        kind: "contribution",
        shareOf: null,
        method: "cash",
        entry: null,
        applied: "35.00",
        tip: "0.00",
        tendered: "35.00",
        change: "0.00",
        state: "received",
        createdAt: "2026-10-16T12:40:00Z",
        receivedAt: "2026-10-16T12:40:00Z",
        lines: [],
        refunds: [],
      },
      reasons: [],
    },
  },
  {
    tag: "till-tender-refund-dialog",
    props: {
      tenders: [
        {
          tenderId: "tender",
          method: "cash",
          last4: null,
          appliedRemaining: "35.00",
          tipRemaining: "0.00",
          manual: false,
          pendingRefundId: null,
        },
      ],
      reasons: [],
    },
  },
  { tag: "till-cancel-credit-dialog", props: { invoiceNumber: "A/1", amount: "35.00" } },
];
it.each(dialogCases)("keeps recovery available for $tag", async ({ tag, props }) => {
  setLocale("en");
  const { el } = await mountWidget<
    HTMLElement & { open: boolean; refusal: ReturnType<typeof refusalOf> }
  >(tag, {
    ...props,
    open: true,
    refusal: refusalOf({
      code: "sif.allocation_invalid",
      recoveryUrl: "/manage/recovery/fiscal-conflict",
    }),
  });
  expect(el.shadowRoot!.querySelector("a[data-recovery]")?.getAttribute("href")).toBe(
    "/manage/recovery/fiscal-conflict",
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
  ).toContain("current recovery key");
});

it.each([
  null,
  undefined,
  "failure",
  { code: 42, recoveryUrl: "/manage/recovery" },
  { code: "refused", recoveryUrl: false },
  { code: "refused", recoveryUrl: "/api/secret" },
])("ignores a malformed recovery refusal: %j", (value) => {
  expect(recoveryRefusalOf(value)).toBeUndefined();
});
