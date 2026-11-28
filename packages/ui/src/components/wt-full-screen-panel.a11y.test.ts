import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "../index.js";

afterEach(async () => {
  cleanup();
  await page.viewport(1280, 900);
});

describe.each(["light", "dark"] as const)("wt-full-screen-panel (%s)", (theme) => {
  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("panel with a scrolling body=%s, rising=%s", async (tall, rising) => {
    await mountThemed(
      `<wt-full-screen-panel body-label="Details" ${rising ? "rising" : ""}>
        <h2 slot="header">Menu</h2>
        <p style="height:${tall ? 400 : 30}px">Details</p>
      </wt-full-screen-panel>`,
      theme,
    );
    host.style.height = "240px";
    const panel = host.querySelector("wt-full-screen-panel")!;
    const body = panel.shadowRoot!.querySelector<HTMLElement>("[part=body]")!;
    await vi.waitFor(() => expect(body.hasAttribute("tabindex")).toBe(tall));
    await expectNoA11yViolations(host);
  });

  test("keeps both bars in the named dialog when the panel body overflows", async () => {
    await page.viewport(390, 568);
    await mountThemed(
      `<wt-dialog full-screen aria-label="Pay" open>
        <wt-full-screen-panel body-label="Payment options">
          <wt-top-bar slot="header" heading="Pay" subtitle="Bill 1" back-label="Table 4">
            <wt-icon-button slot="action" icon="check" label="Payment equipment"></wt-icon-button>
          </wt-top-bar>
          <wt-amount-block>
            <span slot="label">To pay</span>€80.52
            <span slot="breakdown">Bill €73.20 + tip €7.32</span>
          </wt-amount-block>
          <div style="display:grid;gap:8px;padding:6px 12px">
            <wt-choice-tile label="Whole bill" hint="€73.20" check-position="start" selected></wt-choice-tile>
            <wt-choice-tile label="Split equally" hint="Between guests" check-position="start"></wt-choice-tile>
            <wt-choice-tile label="Items" hint="Choose dishes" check-position="start"></wt-choice-tile>
            <wt-choice-tile label="An amount" hint="Enter an amount" check-position="start"></wt-choice-tile>
            <wt-button variant="ghost">Full invoice instead</wt-button>
          </div>
          <wt-foot-button-bar slot="footer">
            <wt-button variant="primary">Charge €80.52</wt-button>
            <wt-button>Cash</wt-button>
            <wt-button slot="link" variant="ghost">Other card machine</wt-button>
          </wt-foot-button-bar>
        </wt-full-screen-panel>
      </wt-dialog>`,
      theme,
    );
    await expect.element(page.getByRole("dialog", { name: "Pay" })).toBeVisible();
    const panel = host.querySelector("wt-full-screen-panel")!;
    const body = panel.shadowRoot!.querySelector<HTMLElement>("[part=body]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(panel.querySelector("wt-top-bar")!.getBoundingClientRect().top).toBe(0);
    expect(panel.querySelector("wt-foot-button-bar")!.getBoundingClientRect().bottom).toBe(568);
    await expectNoA11yViolations(host);
  });
});
