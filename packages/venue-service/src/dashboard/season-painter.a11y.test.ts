import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SeasonPainter } from "./season-painter.js";
import { grid, painterApi, painterModel, pick, settle } from "../testing/season-painter-fixture.js";
import "./season-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("season painter (%s)", (theme) => {
  test.each([
    "department",
    "zone",
    "zone closed behind",
    "period dialog",
    "read-only",
    "read-only zone",
  ])("%s", async (state) => {
    await mountThemed(`<season-painter></season-painter>`, theme);
    const painter = host.querySelector<SeasonPainter>("season-painter")!;
    painter.api = painterApi();
    painter.model = painterModel();
    painter.seasonId = "winter";
    painter.departmentId = "d1";
    painter.open = true;
    painter.readOnly = state.startsWith("read-only");
    await settle(painter);
    if (state === "zone" || state === "read-only zone") await pick(painter, "zone:z2");
    if (state === "zone closed behind") {
      await pick(painter, "zone:z2");
      const behind = grid(painter).shadowRoot!.querySelector(
        '.day[data-column="2"] .all-closed.behind',
      );
      expect(behind?.textContent?.trim(), "closed-behind label drawn").toBe(
        "Restaurant closed all day",
      );
    }
    if (state === "period dialog") {
      painter.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-p1"]')!.click();
      await painter.updateComplete;
      const dialog = painter.shadowRoot!.querySelector("period-dialog");
      expect(dialog, "period dialog drawn").not.toBeNull();
      await dialog!.updateComplete;
      expect(dialog!.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
