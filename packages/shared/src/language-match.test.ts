import { expect, it } from "vitest";
import { matchLanguage } from "./language-match.js";

it.each([
  [["ca"], ["es", "ca-ES-valencia"], "ca-ES-valencia"],
  [["ca", "es"], ["es", "ca-ES-valencia"], "ca-ES-valencia"],
  [["en"], ["es", "en-US"], "en-US"],
  [["en-US"], ["en", "en-US"], "en-US"],
  [["en-GB", "es"], ["es", "en-US"], "en-US"],
  [["en-GB"], ["es", "en-US", "en"], "en"],
  [["ca-Latn-ES-valencia"], ["es", "ca-Latn-ES"], "ca-Latn-ES"],
  [["ca-ES-valencia"], ["es", "ca"], "ca"],
  [["ca-valencia"], ["es", "ca", "ca-ES-valencia"], "ca"],
  [["fr"], ["es", "en"], undefined],
  [["", "invalid_tag", "*", "EN-us-u-nu-latn"], ["es", "en-US"], "en-US"],
  [["de", "en"], ["en", "de"], "de"],
  [["en-AU"], ["en-GB", "en-US"], "en-GB"],
  [[], ["es", "en"], undefined],
  [["en"], [], undefined],
])("matches %j against %j as %s", (preferences, offered, expected) => {
  expect(matchLanguage(preferences, offered)).toBe(expected);
});
