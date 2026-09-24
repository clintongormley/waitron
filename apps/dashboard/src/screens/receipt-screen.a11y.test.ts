import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./receipt-screen.js";
import type { ReceiptScreen } from "./receipt-screen.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";

function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  return {
    getReceipt: vi.fn().mockResolvedValue({ receipt: { ...receipt } }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ReceiptScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("receipt-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with both fields populated", async () => {
    const { el, host } = await mountWidget<ReceiptScreen>(
      "dashboard-receipt-screen",
      {
        api: stubApi(
          {},
          { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" },
        ),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const { el, host } = await mountWidget<ReceiptScreen>(
      "dashboard-receipt-screen",
      { api: stubApi({ putReceipt: vi.fn().mockRejectedValue({ code: "receipt.invalid" }) }) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
