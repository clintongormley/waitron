import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

test("paints formatted amounts using the payment display and muted text tokens", async () => {
  const element = await mount(`
    <wt-amount-block>
      <span slot="label">To pay</span>€80.52
      <span slot="breakdown">Bill €73.20 + tip €7.32</span>
    </wt-amount-block>`);
  const amount = element.shadowRoot?.querySelector<HTMLElement>("[part=amount]");
  const label = element.shadowRoot?.querySelector<HTMLElement>("[part=label]");
  expect(amount).toBeInstanceOf(HTMLElement);
  expect(getComputedStyle(amount!).fontSize).toBe("42px");
  host.style.setProperty("--wt-font-size-payment-amount", "33px");
  host.style.setProperty("--wt-color-text-muted", "rgb(25, 45, 60)");
  expect(getComputedStyle(amount!).fontSize).toBe("33px");
  expect(getComputedStyle(amount!).fontVariantNumeric).toBe("tabular-nums");
  expect(getComputedStyle(label!).color).toBe("rgb(25, 45, 60)");
  expect(
    amount!
      .querySelector("slot")!
      .assignedNodes()
      .map((node) => node.textContent)
      .join("")
      .trim(),
  ).toBe("€80.52");
});
