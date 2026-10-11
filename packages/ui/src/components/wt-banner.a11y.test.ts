import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtBanner } from "./wt-banner.js";
import "./wt-banner.js";

afterEach(cleanup);

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const shown = async (el: HTMLElement) => {
  await nextFrame();
  await nextFrame();
  await (el as WtBanner).updateComplete;
};

describe.each(["light", "dark"] as const)("wt-banner a11y (%s theme)", (theme) => {
  test("message only", async () => {
    await shown(await mountThemed('<wt-banner message="Waitron was updated."></wt-banner>', theme));
    await expectNoA11yViolations(host);
  });

  test("message and action", async () => {
    await shown(
      await mountThemed(
        '<wt-banner message="Waitron se ha actualizado." action-label="Recargar"></wt-banner>',
        theme,
      ),
    );
    await expectNoA11yViolations(host);
  });

  test("action focused", async () => {
    const el = (await mountThemed(
      '<wt-banner message="Waitron was updated." action-label="Reload"></wt-banner>',
      theme,
    )) as WtBanner;
    await shown(el);
    el.shadowRoot!.querySelector("button")!.focus();
    await expectNoA11yViolations(host);
  });
});
