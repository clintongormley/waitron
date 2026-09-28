import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage, registerAlertMessages } from "./alert-messages.js";

registerAlertMessages({
  // Placeholder non-English text: dashboard-kit's tests are scanned by the english-only guard.
  "test.rejected": {
    en: "Rejected: {reason} (code {errorCode})",
    es: "ES rejected: {reason} (ES code {errorCode})",
  },
  "test.count": { en: "{count} payments", es: "{count} ES" },
  "test.charged": {
    en: "Charged {amount:money}, not {expected:money}; {count} tries",
    es: "ES charged {amount:money}, ES not {expected:money}; {count} ES",
  },
});

describe("a money placeholder", () => {
  it("writes a decimal amount as euros, where the alert's language writes the sign", () => {
    const params = { amount: "1279.50", expected: "9", count: "2.50" };
    expect(alertMessage("test.charged", params, "en-GB")).toBe(
      "Charged €1,279.50, not €9.00; 2.50 tries",
    );
    expect(alertMessage("test.charged", params, "es-ES")).toBe(
      "ES charged 1279,50\u00a0€, ES not 9,00\u00a0€; 2.50 ES",
    );
    expect(alertMessage("test.charged", { amount: "-5.25" }, "en")).toContain("-€5.25");
  });

  it("shows a dash for a missing amount, and a value that is not a decimal as it is", () => {
    expect(alertMessage("test.charged", { amount: null }, "en")).toBe("Charged —, not —; — tries");
    expect(alertMessage("test.charged", { amount: "12,50", expected: 12.5 }, "en")).toBe(
      "Charged 12,50, not 12.5; — tries",
    );
    expect(alertMessage("test.charged", { amount: "1.2.3", expected: ".5" }, "en")).toBe(
      "Charged 1.2.3, not .5; — tries",
    );
  });
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
