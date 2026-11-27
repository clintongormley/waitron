import { afterEach, describe, test } from "vitest";
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
});
