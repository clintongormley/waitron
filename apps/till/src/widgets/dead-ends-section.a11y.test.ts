import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./dead-ends-section.js";
import type { TillDeadEndsSection } from "./dead-ends-section.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dead-end choices a11y (%s)", (theme) => {
  it("labels the required station and Remove control", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillDeadEndsSection>(
      "till-dead-ends-section",
      {
        answer: {
          sends: true,
          deadEnds: [
            {
              key: "0",
              name: "Cerveza",
              quantity: "2",
              stationId: "bar",
              stationName: "Bar de arriba",
              why: "closed",
            },
          ],
          stations: [
            { id: "bar", name: "Bar de arriba", open: false },
            { id: "kitchen", name: "Cocina", open: true },
          ],
        },
        allowRemove: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
