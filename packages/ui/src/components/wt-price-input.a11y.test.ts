import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-price-input.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-price-input a11y (%s theme)", (theme) => {
  test("default", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("error", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" error="Enter a price"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with-unit", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="kg" value="9.90"></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-price-input label="Price" name="price" unit="ea" value="9.90" disabled></wt-price-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
