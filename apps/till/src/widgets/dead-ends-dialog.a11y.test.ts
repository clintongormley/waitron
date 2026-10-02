import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./dead-ends-dialog.js";
import type { TillDeadEndsDialog } from "./dead-ends-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dead ends dialog a11y (%s)", (theme) => {
  it("names the question and its required choice in both languages", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillDeadEndsDialog>(
      "till-dead-ends-dialog",
      {
        allowRemove: true,
        answer: {
          sends: true,
          deadEnds: [
            {
              key: "0",
              name: "Cerveza",
              quantity: "2",
              stationId: "bar",
              stationName: "Bar",
              why: "closed",
            },
          ],
          stations: [{ id: "kitchen", name: "Cocina", open: true }],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
