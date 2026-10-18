import { describe, expect, it } from "vitest";
import {
  alertMessage,
  hasAlertMessage,
  registerAlertMessages,
  registerAlertWords,
} from "./alert-messages.js";

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

registerAlertWords({
  test_colour: {
    words: { red: { en: "It is red.", es: "ES red." } },
    otherwise: { en: "It has a colour.", es: "ES colour." },
  },
});
registerAlertMessages({
  "test.colour": { en: "Look. {shade:test_colour} Done.", es: "ES look. {shade:test_colour}" },
  "test.unlisted": { en: "Shade {shade:no_such_list}.", es: "ES {shade:no_such_list}" },
});

describe("a word-list placeholder", () => {
  it("writes the listed words for the param's value, in the alert's language", () => {
    expect(alertMessage("test.colour", { shade: "red" }, "en-GB")).toBe("Look. It is red. Done.");
    expect(alertMessage("test.colour", { shade: "red" }, "es-ES")).toBe("ES look. ES red.");
  });

  it("writes the list's other words for a value it does not name, or no value, never the value", () => {
    for (const shade of ["teal", "toString", null, undefined, 3]) {
      expect(alertMessage("test.colour", { shade }, "en")).toBe("Look. It has a colour. Done.");
    }
    expect(alertMessage("test.colour", {}, "es")).toBe("ES look. ES colour.");
  });

  it("shows a dash for a list nobody registered, never the value", () => {
    expect(alertMessage("test.unlisted", { shade: "red" }, "en")).toBe("Shade —.");
  });
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

registerAlertMessages({ "test.dated": { en: "On {when:date}.", es: "ES {when:date}." } });

describe("a date placeholder", () => {
  it("writes a calendar day the way the alert's language writes it, whatever the region", () => {
    for (const l of ["en", "en-GB"]) {
      expect(alertMessage("test.dated", { when: "2026-10-25" }, l)).toBe("On 25 Oct 2026.");
    }
    for (const l of ["es", "es-ES"]) {
      expect(alertMessage("test.dated", { when: "2026-10-25" }, l)).toBe("ES 25 oct 2026.");
    }
  });

  it("writes the day the param names, not the day before or after in another time zone", () => {
    expect(alertMessage("test.dated", { when: "2026-01-01" }, "en")).toBe("On 1 Jan 2026.");
    expect(alertMessage("test.dated", { when: "2026-12-31" }, "en")).toBe("On 31 Dec 2026.");
  });

  it("shows a dash for a value that is not a YYYY-MM-DD day", () => {
    for (const when of [
      null,
      undefined,
      20261025,
      "25/10/2026",
      "2026-10-25T00:00:00Z",
      "2026-13-01",
      "2026-02-30",
      "",
    ]) {
      expect(alertMessage("test.dated", { when }, "en")).toBe("On —.");
    }
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
