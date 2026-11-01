import { describe, expect, it } from "vitest";
import {
  alertMessage,
  alertWords,
  formatBytes,
  hasAlertMessage,
  registerAlertMessages,
  registerAlertWords,
} from "./alert-messages.js";
import { formatIsoMinute } from "./date-format.js";

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

registerAlertMessages({
  "test.space": { en: "Left: {free:bytes}.", es: "ES left: {free:bytes}." },
});

describe("a bytes placeholder", () => {
  it("writes gigabytes with one decimal from 1 GB, with the alert's language's decimal mark", () => {
    expect(alertMessage("test.space", { free: 1_800_000_000 }, "en-GB")).toBe("Left: 1.8 GB.");
    expect(alertMessage("test.space", { free: 1_800_000_000 }, "es-ES")).toBe("ES left: 1,8 GB.");
    expect(alertMessage("test.space", { free: 2_147_483_648 }, "en-GB")).toBe("Left: 2.1 GB.");
    expect(alertMessage("test.space", { free: 12_345_678_901 }, "en-GB")).toBe("Left: 12.3 GB.");
  });

  it("writes whole megabytes below that, and gigabytes once they would round to 1000", () => {
    expect(alertMessage("test.space", { free: 950_000_000 }, "en-GB")).toBe("Left: 950 MB.");
    expect(alertMessage("test.space", { free: 950_000_000 }, "es-ES")).toBe("ES left: 950 MB.");
    expect(alertMessage("test.space", { free: 999_499_999 }, "en-GB")).toBe("Left: 999 MB.");
    expect(alertMessage("test.space", { free: 999_500_000 }, "en-GB")).toBe("Left: 1 GB.");
    expect(alertMessage("test.space", { free: 0 }, "en-GB")).toBe("Left: 0 MB.");
    expect(alertMessage("test.space", { free: -0 }, "en-GB")).toBe("Left: 0 MB.");
  });

  it("writes a dash for anything that is not a byte count", () => {
    for (const free of ["1800000000", null, undefined, NaN, -1, Infinity, {}]) {
      expect(alertMessage("test.space", { free }, "en-GB")).toBe("Left: —.");
    }
  });
});

registerAlertMessages({
  "test.step": { en: "Moved {stepMs:duration}.", es: "ES {stepMs:duration}." },
});

describe("a duration placeholder", () => {
  const S = 1_000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;

  it("writes the two largest units a number of milliseconds holds, whichever way it points", () => {
    expect(alertMessage("test.step", { stepMs: 2 * D + 3 * H + 4 * M }, "en")).toBe(
      "Moved 2 days and 3 hours.",
    );
    expect(alertMessage("test.step", { stepMs: -(2 * D + 3 * H) }, "en")).toBe(
      "Moved 2 days and 3 hours.",
    );
    expect(alertMessage("test.step", { stepMs: D + 5 * M }, "en")).toBe(
      "Moved 1 day and 5 minutes.",
    );
    expect(alertMessage("test.step", { stepMs: H }, "en")).toBe("Moved 1 hour.");
    expect(alertMessage("test.step", { stepMs: 2 * M + 30 * S + 400 }, "en")).toBe(
      "Moved 2 minutes and 30 seconds.",
    );
    expect(alertMessage("test.step", { stepMs: 1_400 }, "en")).toBe("Moved 1 second.");
  });

  it("writes less than a second as tenths of a second", () => {
    expect(alertMessage("test.step", { stepMs: 400 }, "en")).toBe("Moved 0.4 seconds.");
    expect(alertMessage("test.step", { stepMs: 0 }, "en")).toBe("Moved 0 seconds.");
  });

  it("writes the units in the alert's language", () => {
    const english = alertMessage("test.step", { stepMs: 2 * D + 3 * H }, "en");
    const spanish = alertMessage("test.step", { stepMs: 2 * D + 3 * H }, "es");
    expect(spanish).toMatch(/^ES 2 \S+ \S+ 3 \S+\.$/);
    expect(spanish.slice(3)).not.toBe(english.slice(6));
    expect(spanish).not.toMatch(/day|hour|and/);
  });

  it("writes a dash for anything that is not a number of milliseconds", () => {
    for (const stepMs of ["1000", null, undefined, NaN, Infinity, {}]) {
      expect(alertMessage("test.step", { stepMs }, "en")).toBe("Moved —.");
    }
  });
});

describe("formatBytes", () => {
  it("writes a byte count as an alert's bytes placeholder does, for a screen to use", () => {
    expect(formatBytes(1_800_000_000, "es")).toBe("1,8 GB");
    expect(formatBytes(950_000_000, "en")).toBe("950 MB");
    expect(formatBytes(null, "en")).toBe("—");
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

registerAlertMessages({ "test.minute": { en: "At {when:minute}.", es: "ES {when:minute}." } });

describe("a minute placeholder", () => {
  it("writes an ISO instant as the browser's local YYYY-MM-DD HH:MM, in either language", () => {
    const when = "2025-03-14T09:12:40.000Z";
    expect(alertMessage("test.minute", { when }, "en")).toBe(`At ${formatIsoMinute(when)}.`);
    expect(alertMessage("test.minute", { when }, "es")).toBe(`ES ${formatIsoMinute(when)}.`);
    expect(formatIsoMinute(when)).toMatch(/^2025-03-1[345] \d\d:\d\d$/);
  });

  it("shows a dash for a value that is not an instant, never the value", () => {
    for (const when of [
      null,
      undefined,
      1_741_943_520_000,
      {},
      "",
      "yesterday",
      "2025-13-14T09:12:00Z",
      "2025-03-14T25:12:00Z",
    ]) {
      expect(alertMessage("test.minute", { when }, "en")).toBe("At —.");
    }
  });

  it("shows a dash for a string the date parser reads but that is not an instant as written", () => {
    for (const when of ["1", "2025-02-30T09:12:00.000Z", "2025-03-14T09:12Z", "2025-03-14"]) {
      expect(alertMessage("test.minute", { when }, "en")).toBe("At —.");
    }
  });
});

registerAlertMessages({
  "test.variants": {
    en: "Found {count}.",
    es: "ES found {count}.",
    variants: {
      unknown: { mode: "replace", en: "Could not count since {when:minute}.", es: "ES unknown." },
      short: { mode: "append", en: "The count may be short.", es: "ES short." },
      late: { mode: "append", en: "It came late.", es: "ES late." },
    },
    one: { param: "count", en: "Found one.", es: "ES found one." },
  },
});

describe("a message with variants chosen by a true param", () => {
  it("writes the plain message when no variant's param is true", () => {
    for (const params of [{ count: 3 }, { count: 3, short: false, unknown: false }]) {
      expect(alertMessage("test.variants", params, "en")).toBe("Found 3.");
    }
    expect(alertMessage("test.variants", { count: 3 }, "es")).toBe("ES found 3.");
  });

  it("only a boolean true chooses a variant, never a truthy string or number", () => {
    for (const short of ["true", 1, "yes"]) {
      expect(alertMessage("test.variants", { count: 3, short }, "en")).toBe("Found 3.");
    }
  });

  it("appends each appending variant's sentence after the message, in the alert's language", () => {
    expect(alertMessage("test.variants", { count: 3, short: true }, "en")).toBe(
      "Found 3. The count may be short.",
    );
    expect(alertMessage("test.variants", { count: 3, short: true, late: true }, "es")).toBe(
      "ES found 3. ES short. ES late.",
    );
  });

  it("writes a replacing variant's sentence instead, filled from the params, with nothing appended", () => {
    const when = "2025-03-14T09:12:40.000Z";
    expect(
      alertMessage("test.variants", { count: 0, unknown: true, short: true, when }, "en"),
    ).toBe(`Could not count since ${formatIsoMinute(when)}.`);
    expect(alertMessage("test.variants", { count: 0, unknown: true }, "es")).toBe("ES unknown.");
  });
});

describe("a message with its own words for one", () => {
  it("writes the words for one when the named param is exactly 1, in the alert's language", () => {
    expect(alertMessage("test.variants", { count: 1 }, "en")).toBe("Found one.");
    expect(alertMessage("test.variants", { count: 1 }, "es")).toBe("ES found one.");
  });

  it("keeps the message's own words for any other count, or a 1 that is not a number", () => {
    for (const count of [0, 2, "1", true]) {
      expect(alertMessage("test.variants", { count }, "en")).toBe(`Found ${String(count)}.`);
    }
  });

  it("appends a variant after the words for one, and a replacing variant still stands alone", () => {
    expect(alertMessage("test.variants", { count: 1, short: true }, "en")).toBe(
      "Found one. The count may be short.",
    );
    expect(alertMessage("test.variants", { count: 1, unknown: true }, "es")).toBe("ES unknown.");
  });
});

describe("words that are not a registered alert", () => {
  it("are filled as an alert's are, dates included, in the language asked for", () => {
    const entry = { en: "On {when:date}.", es: "ES {when:date}." };
    expect(alertWords(entry, { when: "2026-10-28" }, "en")).toBe("On 28 Oct 2026.");
    expect(alertWords(entry, { when: "2026-10-28" }, "es")).toBe("ES 28 oct 2026.");
  });

  it("choose the words for one and a replacing variant as a registered alert does", () => {
    const entry = {
      en: "Found {count}.",
      es: "ES found {count}.",
      one: { param: "count", en: "Found one.", es: "ES found one." },
      variants: {
        unknown: { mode: "replace" as const, en: "Found some.", es: "ES some." },
      },
    };
    expect(alertWords(entry, { count: 1 }, "en")).toBe("Found one.");
    expect(alertWords(entry, { count: 3 }, "es")).toBe("ES found 3.");
    expect(alertWords(entry, { count: 1, unknown: true }, "en")).toBe("Found some.");
  });
});
