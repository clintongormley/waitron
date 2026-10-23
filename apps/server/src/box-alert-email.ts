import { BOX_EMAIL_WORDS } from "./i18n/box-emails.js";

export type BoxEmailCode = keyof typeof BOX_EMAIL_WORDS;

/** The codes the duty reads from the stop and the warning; every other code from module notices. */
export const STORAGE_EMAIL_CODES = ["storage.space_low", "storage.disk_full"] as const;

export function isBoxEmailCode(code: string): code is BoxEmailCode {
  return Object.hasOwn(BOX_EMAIL_WORDS, code);
}

/** The subject and text for `code` in `language`, `{venue}` replaced by the venue's name. */
export function boxEmailMessage(
  code: BoxEmailCode,
  language: "en" | "es",
  venue: string,
): { subject: string; text: string } {
  const words = BOX_EMAIL_WORDS[code][language];
  // A function replacement, so a name such as "$&" is not read as a pattern.
  const named = (template: string) => template.replaceAll("{venue}", () => venue);
  return { subject: named(words.subject), text: named(words.text) };
}
