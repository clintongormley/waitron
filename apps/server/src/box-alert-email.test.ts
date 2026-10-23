import { describe, expect, it, vi } from "vitest";
import {
  boxEmailMessage,
  isBoxEmailCode,
  STORAGE_EMAIL_CODES,
  type BoxEmailCode,
} from "./box-alert-email.js";
import { BOX_EMAIL_WORDS } from "./i18n/box-emails.js";

const CODES = Object.keys(BOX_EMAIL_WORDS) as BoxEmailCode[];
const LANGUAGES = ["en", "es"] as const;
const CASES = CODES.flatMap((code) => LANGUAGES.map((language) => [code, language] as const));

describe("boxEmailMessage", () => {
  it.each(CASES)("words %s in %s with the venue's name", (code, language) => {
    const message = boxEmailMessage(code, language, "Corner Bistro", {
      clockAt: "2025-03-14T08:12:00.000Z",
      offsetMinutes: 60,
      lastRecordAt: "2026-10-18T21:40:00.000Z",
      lastRecordOffsetMinutes: 120,
    });
    const words = BOX_EMAIL_WORDS[code][language];
    const filled = (template: string) =>
      template
        .replaceAll("{venue}", "Corner Bistro")
        .replaceAll("{clockAt}", "14/03/2025 09:12")
        .replaceAll("{lastRecordAt}", "18/10/2026 23:40");
    expect(message).toEqual({
      subject: filled(words.subject),
      text: filled(words.text),
    });
    expect(message.subject).not.toContain("{");
    expect(message.text).not.toContain("{");
  });

  it("keeps a venue name that looks like a replacement pattern", () => {
    const message = boxEmailMessage("storage.disk_full", "en", "$& Bar");
    expect(message.subject).toContain("$& Bar");
    expect(message.text).toContain("$& Bar");
  });

  it("every code has a subject and a text in both languages, none blank", () => {
    expect(CODES.length).toBeGreaterThan(0);
    for (const code of CODES) {
      for (const language of LANGUAGES) {
        expect(BOX_EMAIL_WORDS[code][language].subject.trim()).not.toBe("");
        expect(BOX_EMAIL_WORDS[code][language].text.trim()).not.toBe("");
      }
    }
  });

  it("tells the storage codes from the rest", () => {
    expect(isBoxEmailCode("clock.unusable")).toBe(true);
    expect(isBoxEmailCode("fiscal.records_unsent")).toBe(false);
    expect(isBoxEmailCode("clock.behind_chain")).toBe(true);
    expect(STORAGE_EMAIL_CODES).toEqual(["storage.space_low", "storage.disk_full"]);
  });
});

describe("boxEmailMessage for a clock stop", () => {
  const PARAMS = {
    clockAt: "2025-03-14T08:12:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-18T21:40:00.000Z",
    lastRecordOffsetMinutes: 120,
  };

  it("writes both times, each in its own offset, in English", () => {
    expect(boxEmailMessage("clock.behind_chain", "en", "Corner Bistro", PARAMS)).toEqual({
      subject:
        "Payments stopped at Corner Bistro: the box's clock reads earlier than its last sale",
      text: "The box's clock (14/03/2025 09:12) reads earlier than its last recorded sale (18/10/2026 23:40). Since then no device can take payment. Orders can still be taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box status), which says whether payments can be restarted.",
    });
  });

  it("writes both times, each in its own offset, in Spanish", () => {
    const words = BOX_EMAIL_WORDS["clock.behind_chain"].es;
    expect(words.text).toContain("({clockAt})");
    expect(words.text).toContain("({lastRecordAt})");
    expect(boxEmailMessage("clock.behind_chain", "es", "Corner Bistro", PARAMS)).toEqual({
      subject: words.subject.replaceAll("{venue}", "Corner Bistro"),
      text: words.text
        .replaceAll("{clockAt}", "14/03/2025 09:12")
        .replaceAll("{lastRecordAt}", "18/10/2026 23:40"),
    });
  });

  it("keeps the wall clock of each offset whatever the host's zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      const { text } = boxEmailMessage("clock.behind_chain", "en", "Corner Bistro", PARAMS);
      expect(text).toContain("(14/03/2025 09:12)");
      expect(text).toContain("(18/10/2026 23:40)");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
