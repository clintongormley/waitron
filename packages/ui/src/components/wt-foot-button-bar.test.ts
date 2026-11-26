import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

test("uses 52 px actions and a surface token in both stack and row layouts", async () => {
  const element = await mount(`
    <wt-foot-button-bar>
      <wt-button>Cash</wt-button>
      <wt-button variant="primary">Charge</wt-button>
      <wt-button slot="link" variant="ghost">Other card machine</wt-button>
    </wt-foot-button-bar>`);
  host.style.setProperty("--wt-color-surface", "rgb(222, 231, 238)");
  const footer = element.shadowRoot?.querySelector("footer");
  expect(footer).toBeInstanceOf(HTMLElement);
  expect(getComputedStyle(footer!).backgroundColor).toBe("rgb(222, 231, 238)");
  const [cash, charge, link] = [...element.querySelectorAll("wt-button")].map((button) =>
    button.shadowRoot!.querySelector("button")!.getBoundingClientRect(),
  );
  expect(cash!.height).toBe(52);
  expect(charge!.height).toBe(52);
  expect(cash!.width).toBe(charge!.width);
  expect(cash!.bottom).toBeLessThan(charge!.top);
  expect(charge!.bottom).toBeLessThan(link!.top);

  element.setAttribute("layout", "row");
  const buttons = [...element.querySelectorAll("wt-button:not([slot])")];
  expect(buttons[0]!.getBoundingClientRect().top).toBe(buttons[1]!.getBoundingClientRect().top);
  expect(buttons[0]!.getBoundingClientRect().right).toBeLessThan(
    buttons[1]!.getBoundingClientRect().left,
  );
});
