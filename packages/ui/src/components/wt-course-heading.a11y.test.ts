import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-course-heading.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-course-heading a11y (%s theme)", (theme) => {
  test("without a mark", async () => {
    await mountThemed("<wt-course-heading>Mains · held</wt-course-heading>", theme);
    await expectNoA11yViolations(host);
  });

  test("with the sent mark and a button at the end", async () => {
    await mountThemed(
      '<wt-course-heading mark="sent" mark-label="Sent">Drinks · fired 12 min ago<button type="button" slot="end">Serve all</button></wt-course-heading>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("without a mark and with a button at the end", async () => {
    await mountThemed(
      '<wt-course-heading>Mains · held<button type="button" slot="end">Send now</button></wt-course-heading>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with the sent mark and no action", async () => {
    await mountThemed(
      '<wt-course-heading mark="sent" mark-label="Sent">Drinks · fired 12 min ago</wt-course-heading>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with the sent mark and a button moved under a title too long to sit beside them", async () => {
    const el = await mountThemed(
      '<wt-course-heading mark="sent" mark-label="Sent" style="width: 240px">Sharing plates · fired 12 min ago<button type="button" slot="end">Serve all</button></wt-course-heading>',
      theme,
    );
    const title = el.shadowRoot!.querySelector('[role="heading"]')!.getBoundingClientRect();
    const end = el.shadowRoot!.querySelector(".end")!.getBoundingClientRect();
    expect(end.top).toBeGreaterThanOrEqual(title.bottom);
    await expectNoA11yViolations(host);
  });
});
