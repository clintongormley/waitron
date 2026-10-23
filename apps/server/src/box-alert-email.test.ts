import { describe, expect, it } from "vitest";
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
    const message = boxEmailMessage(code, language, "Corner Bistro");
    const words = BOX_EMAIL_WORDS[code][language];
    expect(message).toEqual({
      subject: words.subject.replaceAll("{venue}", "Corner Bistro"),
      text: words.text.replaceAll("{venue}", "Corner Bistro"),
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
    expect(isBoxEmailCode("clock.behind_chain")).toBe(false);
    expect(STORAGE_EMAIL_CODES).toEqual(["storage.space_low", "storage.disk_full"]);
  });
});
