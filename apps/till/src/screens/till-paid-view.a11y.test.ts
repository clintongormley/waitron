import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { BillPaymentView, OriginalReceiptPrint } from "../api/client.js";
import "./till-paid-view.js";
import type { TillPaidView } from "./till-paid-view.js";

const payment = (over: Partial<BillPaymentView>): BillPaymentView => ({
  id: "p1",
  submissionId: "s1",
  kind: "share",
  shareOf: 3,
  method: "card",
  entry: "reader",
  applied: "20.80",
  tip: "0.00",
  tendered: null,
  change: null,
  state: "received",
  createdAt: "2026-10-19T12:00:00.000Z",
  receivedAt: "2026-10-19T12:00:05.000Z",
  lines: [],
  refunds: [],
  ...over,
});

const payments = [
  payment({ id: "p1" }),
  payment({ id: "p2", submissionId: "s2", state: "pending" }),
  payment({ id: "p3", submissionId: "s3", method: "cash", entry: null, change: "4.20" }),
];

const cases: [string, Partial<TillPaidView>][] = [
  ["ticket sent, Reimprimir", { receipt: { status: "done", jobId: "j", canRetry: false } }],
  ["failed, Retry", { receipt: { status: "failed", jobId: "j", canRetry: true } }],
  ["not printed, original offered", { receipt: { status: "not_queued" }, originalAvailable: true }],
  ["read failed", { receipt: null, receiptReadFailed: true }],
  ["busy", { busy: true, receipt: { status: "queued", jobId: "j", canRetry: false } }],
  ["presented bill, no list, no printing", { payments: [], canPrint: false }],
  ["presented bill paid in cash, change to give", { payments: [], change: "30.00" }],
];

function mount(theme: "light" | "dark", props: Partial<TillPaidView>) {
  return mountWidget<TillPaidView>(
    "till-paid-view",
    {
      tableName: "Mesa 4",
      total: "62.40",
      payments,
      receipt: { status: "done", jobId: "j", canRetry: false } as OriginalReceiptPrint,
      canPrint: true,
      ...props,
    },
    theme,
  );
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe.each(["light", "dark"] as const)("till-paid-view a11y (%s theme)", (theme) => {
  it.each(cases)("%s has no violations", async (_name, props) => {
    setLocale("es-ES");
    const { host } = await mount(theme, props);
    await expectNoA11yViolations(host);
  });
});

describe("till-paid-view look", () => {
  it("is captured in both themes at 390 and 1280, and the themes paint differently", async () => {
    setLocale("es-ES");
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const banners: Record<string, string> = {};
    try {
      for (const theme of ["light", "dark"] as const)
        for (const width of [390, 1280]) {
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const { el, host } = await mount(theme, {});
          const article = el.shadowRoot!.querySelector("article")!;
          expect(article.scrollWidth).toBeLessThanOrEqual(article.clientWidth);
          banners[theme] = getComputedStyle(
            el.shadowRoot!.querySelector(".banner")!,
          ).backgroundColor;
          await page.screenshot({
            element: host,
            path: `__screenshots__/look/a796-paid-view-${theme}-${width}.png`,
          });
          console.info(
            `look ${theme} ${width}: article ${article.getBoundingClientRect().width}px`,
          );
          cleanupWidgets();
        }
      expect(banners.light).not.toBe(banners.dark);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});
