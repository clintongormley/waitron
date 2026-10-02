import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./station-choice-dialog.js";
import type { TillStationChoiceDialog } from "./station-choice-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("station choice dialog a11y (%s)", (theme) => {
  it.each(["make-at", "move"] as const)(
    "has no violations in %s mode with a refusal",
    async (mode) => {
      setLocale("es");
      const { host } = await mountWidget<TillStationChoiceDialog>(
        "till-station-choice-dialog",
        {
          mode,
          dishName: "Paella",
          currentStationId: "grill",
          stations: [
            {
              id: "grill",
              name: "Parrilla",
              displayOrder: 0,
              isDefault: true,
              active: true,
              open: true,
            },
            {
              id: "bar",
              name: "Barra",
              displayOrder: 1,
              isDefault: false,
              active: true,
              open: false,
            },
          ],
          refusal: "ticket.not_sent",
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
