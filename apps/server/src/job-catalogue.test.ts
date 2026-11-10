import { describe, expect, it } from "vitest";
import { JOB_CATALOGUE, JOB_NAMES } from "./job-catalogue.js";

describe("job catalogue", () => {
  it("every entry stops at stepdown or says why it keeps running", () => {
    expect(JOB_NAMES.filter((name) => "stop" in JOB_CATALOGUE[name].stepdown).sort()).toEqual([
      "attendance.end_of_day",
      "box.alert_mail",
      "card.follow_up",
      "clock.watch",
      "cloud.connection",
      "cloud.suggestions",
      "demo.printer",
      "fiscal.certificate_reminders",
      "fiscal.drain",
      "fiscal.reconciliation",
      "housekeeping",
      "mail.send",
      "menu.activation",
      "payments.reconcile",
    ]);
    for (const entry of Object.values(JOB_CATALOGUE)) {
      if ("keepRunning" in entry.stepdown) expect(entry.stepdown.keepRunning.trim()).not.toBe("");
    }
  });

  it("the bucket copy is a service that keeps running until the close", () => {
    expect(JOB_CATALOGUE.stream).toEqual({
      kind: "service",
      stepdown: { keepRunning: "stops last, after anything that may still write venue.db" },
    });
  });
});
