import { afterEach, describe, expect, test, vi } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import type { WtPoweredBy } from "./wt-powered-by.js";
import "./wt-powered-by.js";

afterEach(cleanup);

async function poweredBy(theme: "light" | "dark"): Promise<WtPoweredBy> {
  const el = (await mountThemed(
    `<wt-powered-by label="Powered by"></wt-powered-by>`,
    theme,
  )) as WtPoweredBy;
  el.requestUpdate();
  await el.updateComplete;
  const image = el.shadowRoot!.querySelector<HTMLImageElement>("img")!;
  await vi.waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
  return el;
}

describe.each(["light", "dark"] as const)("wt-powered-by a11y (%s theme)", (theme) => {
  test("the line", async () => {
    await poweredBy(theme);
    await expectNoA11yViolations(host);
  });

  test("control: the line with its lockup's alt removed is refused", async () => {
    const el = await poweredBy(theme);
    el.shadowRoot!.querySelector("img")!.removeAttribute("alt");
    await expect(expectNoA11yViolations(host)).rejects.toThrow(/image-alt/);
  });
});
