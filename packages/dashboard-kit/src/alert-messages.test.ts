import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage, registerAlertMessages } from "./alert-messages.js";

registerAlertMessages({
  // Placeholder non-English text: dashboard-kit's tests are scanned by the english-only guard.
  "test.rejected": {
    en: "Rejected: {reason} (code {errorCode})",
    es: "ES rejected: {reason} (ES code {errorCode})",
  },
  "test.count": { en: "{count} payments", es: "{count} ES" },
});

describe("alertMessage", () => {
  it("fills params into the locale's sentence, stripping the region", () => {
    expect(alertMessage("test.rejected", { reason: "Tax id", errorCode: 4102 }, "es-ES")).toBe(
      "ES rejected: Tax id (ES code 4102)",
    );
    expect(alertMessage("test.count", { count: 3 }, "en-GB")).toBe("3 payments");
  });

  it("shows a dash for a null or missing param", () => {
    expect(alertMessage("test.rejected", { reason: null }, "en")).toBe("Rejected: — (code —)");
  });

  it("writes a structured param as JSON", () => {
    expect(alertMessage("test.count", { count: [1, 2] }, "en")).toBe("[1,2] payments");
  });

  it("does not read a param inherited from Object.prototype", () => {
    registerAlertMessages({ "test.proto": { en: "{constructor}", es: "{constructor}" } });
    expect(alertMessage("test.proto", {}, "en")).toBe("—");
  });

  it("gives a generic sentence for an unregistered code, including a prototype name", () => {
    expect(alertMessage("nothing.registered", {}, "en")).toBe("Something needs attention");
    expect(alertMessage("toString", {}, "es")).toBe("Algo requiere atención");
    expect(hasAlertMessage("toString")).toBe(false);
    expect(hasAlertMessage("test.count")).toBe(true);
  });
});
