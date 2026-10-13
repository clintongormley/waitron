import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SeasonPainter } from "./season-painter.js";
import { painterApi, painterModel, pick, settle } from "../testing/season-painter-fixture.js";
import "./season-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("season painter (%s)", (theme) => {
  test.each(["department", "zone", "period editor"])("%s", async (state) => {
    await mountThemed(`<season-painter></season-painter>`, theme);
    const painter = host.querySelector<SeasonPainter>("season-painter")!;
    painter.api = painterApi();
    painter.model = painterModel();
    painter.seasonId = "winter";
    painter.departmentId = "d1";
    painter.open = true;
    await settle(painter);
    if (state === "zone") await pick(painter, "zone:z2");
    if (state === "period editor") {
      painter.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-p1"]')!.click();
      await painter.updateComplete;
      await painter.shadowRoot!.querySelector("period-editor")!.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
