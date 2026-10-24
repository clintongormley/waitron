import { describe, expect, it } from "vitest";
import { mediaTestReference } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import {
  anyHandSet,
  codeInvalid,
  handTouched,
  invalidHandCodes,
  isWaitronLook,
  openDraft,
  pickBrand,
  resetAllHand,
  sameDraft,
  setBackground,
  setLogo,
  setCorners,
  setHand,
  setTextScale,
  typeCode,
  typeHandCode,
  useWorkedOut,
  waitronLook,
  withDarkLogo,
  withLightLogo,
} from "./look-draft.js";

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: { bg: "#f8f1e1" }, dark: {} },
  textScale: 100,
};

describe("the Look card's draft", () => {
  it("opens on the stored choices with the brand colour as its code", () => {
    expect(openDraft(LUCIA)).toEqual({
      choices: LUCIA,
      code: "#1e5b3a",
      handCodes: { light: {}, dark: {} },
    });
  });

  it("opens an unreadable theme on Waitron's look", () => {
    const draft = openDraft(null);
    expect(draft).toEqual({
      choices: WAITRON_CHOICES,
      code: "",
      handCodes: { light: {}, dark: {} },
    });
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

  it("takes back the opened draft's fix when the brand colour returns to the opened one", () => {
    const opened = openDraft(LUCIA);
    const bySwatch = pickBrand(pickBrand(opened, "#b12525", opened), "#1e5b3a", opened);
    expect(bySwatch.choices.brandFix).toEqual({ dark: true });
    expect(sameDraft(bySwatch, opened)).toBe(true);
    const byCode = typeCode(typeCode(opened, "#123456", opened), "#1E5B3A", opened);
    expect(byCode.choices.brandFix).toEqual({ dark: true });
    expect(sameDraft(byCode, opened)).toBe(true);
    const viaWaitrons = pickBrand(pickBrand(opened, null, opened), "#1e5b3a", opened);
    expect(viaWaitrons.choices.brandFix).toEqual({ dark: true });
    expect(pickBrand(opened, "#b12525", opened).choices.brandFix).toEqual({});
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
    expect(draft).toEqual({
      choices: WAITRON_CHOICES,
      code: "",
      handCodes: { light: {}, dark: {} },
    });
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

  it("compares a hand-set map holding an undefined value as if the key were absent", () => {
    const plain = openDraft(LUCIA);
    const holey = openDraft({
      ...LUCIA,
      handSet: {
        light: { bg: "#f8f1e1", text: undefined } as unknown as Record<string, string>,
        dark: {},
      },
    });
    expect(sameDraft(plain, holey)).toBe(true);
    expect(sameDraft(holey, plain)).toBe(true);
    const other = openDraft({ ...LUCIA, handSet: { light: { text: "#f8f1e1" }, dark: {} } });
    expect(sameDraft(holey, other)).toBe(false);
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
      logo: null,
      background: "tinted",
      brandFix: { dark: true, light: true },
      brandColor: "#1e5b3a",
      textScale: 100,
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

describe("the Look card's draft colours set by hand", () => {
  it("sets a colour by hand in lower case, in its mode only, with no typed text", () => {
    const draft = setHand(openDraft(LUCIA), "light", "bg", "#F8F1E1");
    expect(draft.choices.handSet.light).toEqual({ bg: "#f8f1e1" });
    expect(draft.choices.handSet.dark).toEqual({});
    expect(draft.handCodes).toEqual({ light: {}, dark: {} });
  });

  it("keeps a typed code as typed, and sets the colour only once it is a whole code", () => {
    const opened = openDraft(LUCIA);
    const whole = typeHandCode(opened, "light", "bg", "#F8F1E1 ");
    expect(whole.choices.handSet.light.bg).toBe("#f8f1e1");
    expect(whole.handCodes.light.bg).toBe("#F8F1E1 ");
    expect(invalidHandCodes(whole)).toEqual([]);
    const partial = typeHandCode(opened, "light", "bg", "#12");
    expect(partial.choices).toBe(opened.choices);
    expect(partial.handCodes.light.bg).toBe("#12");
    expect(invalidHandCodes(partial)).toEqual(["handSet.light.bg"]);
    expect(invalidHandCodes(typeHandCode(opened, "light", "bg", ""))).toEqual(["handSet.light.bg"]);
  });

  it("lists invalid typed codes in theme colour order, light first", () => {
    let draft = openDraft(LUCIA);
    draft = typeHandCode(draft, "dark", "bg", "#1");
    draft = typeHandCode(draft, "light", "text", "#2");
    draft = typeHandCode(draft, "light", "bg", "#3");
    expect(invalidHandCodes(draft)).toEqual([
      "handSet.light.bg",
      "handSet.light.text",
      "handSet.dark.bg",
    ]);
  });

  it("drops a mode's brand fix when its Main buttons are set by hand, and does not bring it back", () => {
    const opened = openDraft(LUCIA);
    const set = setHand(opened, "dark", "primary", "#5fa77a");
    expect(set.choices.brandFix).toEqual({});
    const typed = typeHandCode(opened, "dark", "primary", "#5fa77a");
    expect(typed.choices.brandFix).toEqual({});
    expect(typed.choices.handSet.dark.primary).toBe("#5fa77a");
    const back = useWorkedOut(typed, "dark", "primary");
    expect(back.choices.handSet.dark.primary).toBeUndefined();
    expect(back.choices.brandFix).toEqual({});
    expect(typeHandCode(opened, "dark", "primary", "#5f").choices.brandFix).toEqual({ dark: true });
    expect(setHand(opened, "light", "bg", "#ffffff").choices.brandFix).toEqual({ dark: true });
  });

  it("does not take back the opened fix for a mode whose Main buttons are set by hand", () => {
    const opened = openDraft(LUCIA);
    const byHand = setHand(opened, "dark", "primary", "#5fa77a");
    const returned = pickBrand(pickBrand(byHand, "#b12525", opened), "#1e5b3a", opened);
    expect(returned.choices.brandFix).toEqual({});
    const control = pickBrand(pickBrand(opened, "#b12525", opened), "#1e5b3a", opened);
    expect(control.choices.brandFix).toEqual({ dark: true });
  });

  it("puts a colour back to worked out, value and typed text, and resets every one", () => {
    const opened = openDraft(LUCIA);
    const typed = typeHandCode(setHand(opened, "dark", "text", "#eeeeee"), "light", "bg", "#12");
    const back = useWorkedOut(typed, "light", "bg");
    expect(back.choices.handSet.light).toEqual({});
    expect(back.handCodes.light).toEqual({});
    expect(back.choices.handSet.dark).toEqual({ text: "#eeeeee" });
    const reset = resetAllHand(typeHandCode(typed, "dark", "bg", "#000000"));
    expect(reset.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(reset.handCodes).toEqual({ light: {}, dark: {} });
  });

  it("compares typed codes as the colour they name, and invalid ones by their trimmed text", () => {
    const opened = openDraft(LUCIA);
    expect(sameDraft(typeHandCode(opened, "light", "bg", "#F8F1E1"), opened)).toBe(true);
    expect(sameDraft(opened, typeHandCode(opened, "light", "bg", "#F8F1E1"))).toBe(true);
    const partial = typeHandCode(opened, "light", "bg", "#12");
    expect(sameDraft(partial, opened)).toBe(false);
    expect(sameDraft(opened, partial)).toBe(false);
    expect(sameDraft(typeHandCode(opened, "light", "bg", "#12 "), partial)).toBe(true);
    expect(sameDraft(typeHandCode(opened, "light", "bg", "#13"), partial)).toBe(false);
    expect(sameDraft(typeHandCode(opened, "light", "text", "#12"), partial)).toBe(false);
    expect(isWaitronLook(typeHandCode(waitronLook(), "light", "bg", "#12"))).toBe(false);
  });

  it("knows a colour touched by hand, by value or by typed text alone", () => {
    const opened = openDraft(LUCIA);
    expect(handTouched(opened, "light", "bg")).toBe(true);
    expect(handTouched(opened, "light", "text")).toBe(false);
    expect(handTouched(opened, "dark", "bg")).toBe(false);
    expect(handTouched(typeHandCode(opened, "dark", "bg", "#1"), "dark", "bg")).toBe(true);
    expect(anyHandSet(waitronLook())).toBe(false);
    expect(anyHandSet(opened)).toBe(true);
    expect(anyHandSet(typeHandCode(waitronLook(), "dark", "bg", "#1"))).toBe(true);
  });

  it("keeps the typed hand codes through a brand change", () => {
    const opened = openDraft(LUCIA);
    const typed = typeHandCode(opened, "light", "bg", "#12");
    for (const changed of [
      pickBrand(typed, "#b12525", opened),
      typeCode(typed, "#b12525", opened),
    ]) {
      expect(changed.choices.brandColor).toBe("#b12525");
      expect(changed.handCodes.light.bg).toBe("#12");
      expect(invalidHandCodes(changed)).toEqual(["handSet.light.bg"]);
      expect(sameDraft(changed, opened)).toBe(false);
    }
    const back = pickBrand(pickBrand(typed, "#b12525", opened), "#1e5b3a", opened);
    expect(sameDraft(back, opened)).toBe(false);
  });
});

describe("the Look card draft's logo", () => {
  const L = mediaTestReference("a.png");
  const D = mediaTestReference("d.png");
  const E = mediaTestReference("e.png");

  it("sets a light logo, keeps the dark one when the light one changes, and clears both", () => {
    expect(withLightLogo(null, L)).toStrictEqual({ light: L });
    expect(withLightLogo({ light: L, dark: D }, E)).toStrictEqual({ light: E, dark: D });
    expect(withLightLogo({ light: L, dark: D }, null)).toBeNull();
  });

  it("sets a dark logo only beside a light one, and clears it with no dark key left", () => {
    expect(withDarkLogo({ light: L }, D)).toStrictEqual({ light: L, dark: D });
    expect(withDarkLogo({ light: L, dark: D }, null)).toStrictEqual({ light: L });
    expect(withDarkLogo(null, D)).toBeNull();
  });

  it("counts a different logo as a change, and an absent dark logo as no dark logo", () => {
    const base = waitronLook();
    const pairs = [
      [null, { light: L }],
      [{ light: L }, { light: E }],
      [{ light: L }, { light: L, dark: D }],
    ] as const;
    for (const [a, b] of pairs) {
      expect(sameDraft(setLogo(base, a), setLogo(base, b))).toBe(false);
      expect(sameDraft(setLogo(base, b), setLogo(base, a))).toBe(false);
    }
    expect(
      sameDraft(setLogo(base, { light: L }), setLogo(base, { light: L, dark: undefined })),
    ).toBe(true);
    expect(
      sameDraft(setLogo(base, { light: L, dark: D }), setLogo(base, { light: L, dark: D })),
    ).toBe(true);
  });

  it("puts the logo in the draft's choices and keeps the rest", () => {
    const draft = setLogo(waitronLook(), { light: L });
    expect(draft.choices).toStrictEqual({ ...WAITRON_CHOICES, logo: { light: L } });
    expect(draft.code).toBe("");
  });

  it("is no longer Waitron's look once a logo is set", () => {
    expect(isWaitronLook(setLogo(waitronLook(), { light: L }))).toBe(false);
    expect(isWaitronLook(waitronLook())).toBe(true);
  });
});

describe("the Look card draft's text size", () => {
  it("a text size is part of the draft", () => {
    const larger = setTextScale(waitronLook(), 120);
    expect(larger.choices.textScale).toBe(120);
    expect(sameDraft(larger, waitronLook())).toBe(false);
    expect(isWaitronLook(larger)).toBe(false);
    const back = setTextScale(larger, 100);
    expect(sameDraft(back, waitronLook())).toBe(true);
    expect(isWaitronLook(back)).toBe(true);
  });
});
