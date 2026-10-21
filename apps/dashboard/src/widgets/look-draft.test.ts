import { describe, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import {
  codeInvalid,
  isWaitronLook,
  openDraft,
  pickBrand,
  sameDraft,
  setBackground,
  setCorners,
  typeCode,
  waitronLook,
} from "./look-draft.js";

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: { bg: "#f8f1e1" }, dark: {} },
};

describe("the Look card's draft", () => {
  it("opens on the stored choices with the brand colour as its code", () => {
    expect(openDraft(LUCIA)).toEqual({ choices: LUCIA, code: "#1e5b3a" });
  });

  it("opens an unreadable theme on Waitron's look", () => {
    const draft = openDraft(null);
    expect(draft).toEqual({ choices: WAITRON_CHOICES, code: "" });
    expect(isWaitronLook(draft)).toBe(true);
  });

  it("drops the brand fix when another colour is picked, and keeps it for the same colour", () => {
    const draft = openDraft(LUCIA);
    const other = pickBrand(draft, "#b12525");
    expect(other.choices.brandColor).toBe("#b12525");
    expect(other.choices.brandFix).toEqual({});
    expect(other.code).toBe("#b12525");
    expect(other.choices.handSet).toEqual(LUCIA.handSet);
    expect(pickBrand(draft, "#1e5b3a").choices.brandFix).toEqual({ dark: true });
    const waitrons = pickBrand(draft, null);
    expect(waitrons.choices.brandColor).toBeNull();
    expect(waitrons.choices.brandFix).toEqual({});
    expect(waitrons.code).toBe("");
  });

  it("takes a typed code, trimmed and in lower case, and counts the stored colour as no change", () => {
    const draft = openDraft(LUCIA);
    const typed = typeCode(draft, " #1E5B3A ");
    expect(typed.choices.brandColor).toBe("#1e5b3a");
    expect(typed.choices.brandFix).toEqual({ dark: true });
    expect(codeInvalid(typed)).toBe(false);
    expect(sameDraft(typed, draft)).toBe(true);
    const other = typeCode(draft, "#123456");
    expect(other.choices.brandColor).toBe("#123456");
    expect(other.choices.brandFix).toEqual({});
    expect(sameDraft(other, draft)).toBe(false);
  });

  it("keeps the colour while a typed code is partial, and calls the code invalid", () => {
    const draft = typeCode(openDraft(LUCIA), "#12");
    expect(draft.choices).toEqual(LUCIA);
    expect(draft.code).toBe("#12");
    expect(codeInvalid(draft)).toBe(true);
    expect(sameDraft(draft, openDraft(LUCIA))).toBe(false);
  });

  it("calls an empty code invalid with a custom colour and valid with Waitron's", () => {
    expect(codeInvalid(typeCode(openDraft(LUCIA), ""))).toBe(true);
    expect(codeInvalid(typeCode(openDraft(LUCIA), "  "))).toBe(true);
    expect(codeInvalid(openDraft(null))).toBe(false);
    expect(codeInvalid(typeCode(openDraft(null), "#12"))).toBe(true);
  });

  it("keeps the brand fix when Background or Corners change", () => {
    const draft = setCorners(setBackground(openDraft(LUCIA), "neutral"), "square");
    expect(draft.choices).toEqual({ ...LUCIA, background: "neutral", corners: "square" });
    expect(draft.code).toBe("#1e5b3a");
  });

  it("puts everything back to Waitron's look, and knows only that draft as it", () => {
    const draft = waitronLook();
    expect(draft).toEqual({ choices: WAITRON_CHOICES, code: "" });
    expect(draft.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(isWaitronLook(draft)).toBe(true);
    expect(isWaitronLook(openDraft(LUCIA))).toBe(false);
    expect(isWaitronLook(setCorners(waitronLook(), "round"))).toBe(false);
    expect(isWaitronLook(setBackground(waitronLook(), "tinted"))).toBe(false);
    expect(isWaitronLook(pickBrand(waitronLook(), "#b12525"))).toBe(false);
    expect(isWaitronLook(typeCode(waitronLook(), "#12"))).toBe(false);
    expect(
      isWaitronLook(
        openDraft({ ...WAITRON_CHOICES, handSet: { light: {}, dark: { text: "#eeeeee" } } }),
      ),
    ).toBe(false);
  });

  it("compares by value, never by key order", () => {
    const a = openDraft({
      ...LUCIA,
      brandFix: { light: true, dark: true },
      handSet: { light: { bg: "#f8f1e1", text: "#6a6a6a" }, dark: {} },
    });
    const b = openDraft({
      handSet: { dark: {}, light: { text: "#6A6A6A", bg: "#f8f1e1" } },
      corners: "round",
      background: "tinted",
      brandFix: { dark: true, light: true },
      brandColor: "#1e5b3a",
    });
    expect(sameDraft(a, b)).toBe(true);
    expect(sameDraft(b, a)).toBe(true);
    const sameWith = (choices: Partial<ThemeChoices>) =>
      sameDraft(a, { ...a, choices: { ...a.choices, ...choices } });
    expect(sameWith({ brandFix: { light: true } })).toBe(false);
    expect(sameWith({ brandFix: { light: true, dark: true } })).toBe(true);
    expect(sameWith({ handSet: { light: { bg: "#f8f1e1", text: "#6a6a6b" }, dark: {} } })).toBe(
      false,
    );
    expect(sameWith({ handSet: { light: { bg: "#f8f1e1" }, dark: {} } })).toBe(false);
    expect(
      sameWith({ handSet: { light: { bg: "#f8f1e1", text: "#6a6a6a" }, dark: { bg: "#000000" } } }),
    ).toBe(false);
    expect(sameWith({ background: "neutral" })).toBe(false);
    expect(sameWith({ corners: "square" })).toBe(false);
    expect(sameWith({ brandColor: "#1e5b3b" })).toBe(false);
    expect(sameDraft(a, { ...a, code: "#1e5b3b" })).toBe(false);
  });
});
