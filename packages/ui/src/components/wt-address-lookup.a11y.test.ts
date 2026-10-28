import { afterEach, describe, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-address-lookup.js";
import type { AddressLookupProvider, WtAddressLookup } from "./wt-address-lookup.js";

afterEach(cleanup);

const provider: AddressLookupProvider = {
  suggest: async () => [
    { id: "s1", label: "Calle Mayor 1", secondaryLabel: "28013 Madrid" },
    { id: "s2", label: "Calle Mayor 2" },
  ],
  resolve: async () => ({
    lines: ["Calle Mayor 1"],
    locality: "Madrid",
    postalCode: "28013",
    countryCode: "ES",
  }),
};

const MARKUP =
  '<wt-address-lookup label="Find the address" placeholder="Street and number" country-code="ES" no-results-label="No address found." unavailable-label="Suggestions are not available."></wt-address-lookup>';

async function mountWith(theme: "light" | "dark"): Promise<WtAddressLookup> {
  const el = (await mountThemed(MARKUP, theme)) as WtAddressLookup;
  el.provider = provider;
  el.delay = 0;
  await el.updateComplete;
  return el;
}

async function typeAndWait(el: WtAddressLookup, text: string): Promise<void> {
  const input = el.shadowRoot!.querySelector("input")!;
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("wt-address-lookup a11y (%s theme)", (theme) => {
  test("closed, empty field", async () => {
    await mountWith(theme);
    await expectNoA11yViolations(host);
  });

  test("open list with an active suggestion", async () => {
    const el = await mountWith(theme);
    await typeAndWait(el, "Calle Mayor");
    await userEvent.keyboard("{ArrowDown}");
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("a line under the field", async () => {
    const el = await mountWith(theme);
    el.message = "That address is in another country.";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("disabled field", async () => {
    const el = await mountWith(theme);
    el.disabled = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
