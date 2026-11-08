import { afterEach, describe, expect, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import type { WtWaitronLockup } from "./wt-waitron-lockup.js";
import "./wt-waitron-lockup.js";

afterEach(cleanup);

async function lockup(theme: "light" | "dark", attrs = ""): Promise<WtWaitronLockup> {
  const el = (await mountThemed(
    `<wt-waitron-lockup ${attrs}></wt-waitron-lockup>`,
    theme,
  )) as WtWaitronLockup;
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("wt-waitron-lockup a11y (%s theme)", (theme) => {
  test("named", async () => {
    await lockup(theme);
    await expectNoA11yViolations(host);
  });

  test("decoration", async () => {
    await lockup(theme, 'label=""');
    await expectNoA11yViolations(host);
  });

  test("control: an image role with no name is refused", async () => {
    const el = await lockup(theme);
    el.shadowRoot!.querySelector("svg")!.removeAttribute("aria-label");
    await expect(expectNoA11yViolations(host)).rejects.toThrow(/svg-img-alt/);
  });
});
