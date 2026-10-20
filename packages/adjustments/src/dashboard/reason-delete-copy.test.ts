import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { DeleteImpactRefusal } from "@waitron/shared";
import { reasonDeleteCopy } from "./reason-delete-copy.js";
import { ADJUSTMENTS_CODE_MESSAGES, ADJUSTMENTS_STRINGS } from "./strings.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const voidRequired = (params: DeleteImpactRefusal["params"]): DeleteImpactRefusal => ({
  code: "adjustment_reason.void_required",
  params,
  targets: [],
});

it.each(["en", "es"] as const)("writes every fixed line of the question in %s", (locale) => {
  setLocale(locale);
  const strings = ADJUSTMENTS_STRINGS[locale];
  const copy = reasonDeleteCopy();
  expect({
    heading: copy.heading,
    refusals: copy.refusals,
    ends: copy.ends,
    removes: copy.removes,
    irreversible: copy.irreversible,
    cancel: copy.cancel,
    confirm: copy.confirm,
    retry: copy.retry,
    loading: copy.loading,
  }).toEqual({
    heading: strings["adjustments.delete_heading"],
    refusals: strings["adjustments.delete_refusals"],
    ends: strings["adjustments.delete_ends"],
    removes: strings["adjustments.delete_removes"],
    irreversible: strings["adjustments.delete_irreversible"],
    cancel: strings["adjustments.cancel"],
    confirm: strings["adjustments.delete"],
    retry: strings["adjustments.delete_retry"],
    loading: strings["adjustments.delete_loading"],
  });
});

it("writes the English question in the agreed words", () => {
  setLocale("en");
  const copy = reasonDeleteCopy();
  expect([copy.heading, copy.confirm, copy.irreversible, copy.loading]).toEqual([
    "Delete reason",
    "Delete",
    "Past voids and comps keep its name. This cannot be undone.",
    "Checking whether this reason can be deleted…",
  ]);
});

it.each(["en", "es"] as const)(
  "says the venue needs a Void reason when the last one would go, in %s",
  (locale) => {
    setLocale(locale);
    const strings = ADJUSTMENTS_STRINGS[locale];
    const { refusal } = reasonDeleteCopy();
    for (const withNote of [0, false, undefined]) {
      const params: DeleteImpactRefusal["params"] =
        withNote === undefined ? {} : { withNote: withNote as number };
      expect(refusal(voidRequired(params))).toBe(strings["adjustments.error.void_required"]);
    }
  },
);

it.each(["en", "es"] as const)(
  "says the venue needs a Void reason asking for a note, whether the read says 1 or the refused delete says true, in %s",
  (locale) => {
    setLocale(locale);
    const strings = ADJUSTMENTS_STRINGS[locale];
    const { refusal } = reasonDeleteCopy();
    for (const withNote of [1, true]) {
      expect(refusal(voidRequired({ withNote: withNote as number }))).toBe(
        strings["adjustments.error.void_required_note"],
      );
    }
  },
);

it.each(["en", "es"] as const)("words any other refusal by its code in %s", (locale) => {
  setLocale(locale);
  const { refusal } = reasonDeleteCopy();
  expect(
    refusal({ code: "adjustment_reason.not_found", params: { withNote: 1 }, targets: [] }),
  ).toBe(ADJUSTMENTS_CODE_MESSAGES["adjustment_reason.not_found"]![locale]);
});

it.each(["en", "es"] as const)("names an item's targets with its count in %s", (locale) => {
  setLocale(locale);
  const { item } = reasonDeleteCopy();
  expect(
    item({
      key: "anything",
      count: 2,
      targets: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    }),
  ).toBe("A, B (2)");
});
