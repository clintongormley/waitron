import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./receipt-screen.js";
import type { ReceiptScreen } from "./receipt-screen.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";

/**
 * The receipt screen scanned by axe in both themes, in two shapes: populated fields (both the header
 * wt-input and the footer <textarea> carry authored text), and the error state (a rejected save shows
 * the `role="alert"` banner). Mounted by ASSIGNING the `api` stub as a property; the screen loads on
 * connect, so the stub must resolve or a stray rejection pollutes the run (a rejection is a finding).
 */
function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  return {
    getLayout: vi.fn().mockResolvedValue({
      definition: [{ type: "product-grid", region: "main", config: {} }],
      receipt: { ...receipt },
    }),
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
      { api: stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" }) },
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
