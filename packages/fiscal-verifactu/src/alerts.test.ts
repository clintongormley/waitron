import { expect, it } from "vitest";
import { clockBehindSource } from "./clock-behind-alerts.js";
import { FISCAL_ALERTS } from "./index.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

it("claims fiscal. incidents for the fiscal area under fiscal.view and clock.behind_chain and clock.records_misdated incidents for the box area under system.manage, and contributes the submission and clock-behind sources", () => {
  expect(FISCAL_ALERTS).toEqual({
    events: [
      { prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" },
      { prefix: "clock.behind_chain", area: "box", permission: "system.manage" },
      { prefix: "clock.records_misdated", area: "box", permission: "system.manage" },
    ],
    sources: [fiscalSubmissionSource, clockBehindSource],
  });
});
