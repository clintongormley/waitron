import { expect, it } from "vitest";
import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";

it("lists the translatable kinds in the order the dialog and the report show them", () =>
  expect(TRANSLATION_GAP_KINDS).toEqual([
    "product",
    "variant",
    "option_list",
    "option_label",
    "extra_list",
    "menu",
    "section",
    "included_menu",
    "unit",
  ]));
