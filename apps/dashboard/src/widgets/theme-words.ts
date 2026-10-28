import {
  type AgainstItem,
  type ColourWarning,
  type DerivedTheme,
  MODES,
  type Mode,
  STATIONS,
  THEME_COLOURS,
  THEME_RULES,
  type ThemeChoices,
  type ThemeColour,
  type TextScale,
  type TextSizeKey,
  type TextWarning,
  type TextWeightKey,
  type ThemeWarning,
  colourKey,
  drawnTextSize,
  groupAgainst,
  isTextWarning,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { currentContentLanguages } from "@waitron/ui";
import { catalogues, type StringKey } from "../i18n/strings.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { type AdvancedSectionId, inSection, sectionKeys } from "./advanced-sections.js";
import { countOf } from "./count-text.js";
import { TEXT_FIELDS, textSetByHand, type TextField } from "./look-draft.js";

const ZONE_TABS: ReadonlySet<string> = new Set([
  "tab-danger-tint",
  "tab-warning-tint",
  "tab-bill-tint",
  "tab-ready-tint",
  "tab-seated-tint",
]);
const THEME_KEYS: ReadonlySet<string> = new Set(THEME_COLOURS);

export function themeColourName(key: ThemeColour): string {
  return t(`appearance.colour.${key}`);
}

export function brandWarningText(mode: Mode): string {
  return t(`appearance.brand_warning_${mode}`);
}

export function brandFixLabel(mode: Mode, colour: string): string {
  return fill(`appearance.brand_fix_${mode}`, { colour });
}

export function brandFixedText(mode: Mode, colour: string): string {
  return fill(`appearance.brand_fixed_${mode}`, { colour });
}

export function fixAllText(colours: number, sizes = 0): string {
  if (sizes === 0) return fill("appearance.fix_all_count", { n: String(colours) });
  if (colours === 0) return fill("appearance.fix_all_text_count", { n: String(sizes) });
  return fill("appearance.fix_all_mixed", {
    colours: countOf("appearance.colour_count", colours),
    sizes: countOf("appearance.text_size_count", sizes),
  });
}

export function textRowName(
  field: "family" | `size.${TextSizeKey}` | `weight.${TextWeightKey}`,
): string {
  return t(`appearance.text.${field}`);
}

export const TEXT_ROWS = TEXT_FIELDS;

export function textFieldName(field: TextField): string {
  return textRowName(field.slice("text.".length) as Parameters<typeof textRowName>[0]);
}

export function textNames(choices: ThemeChoices): string[] {
  return TEXT_ROWS.filter((field) => textSetByHand(choices, field)).map(textFieldName);
}

export function textAtStep(textScale: TextScale, drawn: number): string {
  return fill("appearance.text_at_step", { step: textScaleLabel(textScale), size: String(drawn) });
}

export function textFixLabel(px: number, textScale: TextScale, drawn: number): string {
  if (textScale === 100) return fill("appearance.text_fix", { size: String(px) });
  return fill("appearance.text_fix_at", {
    size: String(px),
    drawn: String(drawn),
    step: textScaleLabel(textScale),
  });
}

export function textLargerLine(key: TextSizeKey, drawn: number): string {
  return fill("appearance.text_larger", { name: textRowName(`size.${key}`), size: String(drawn) });
}

export function textWarningLine(warning: TextWarning, choices: ThemeChoices): string {
  const key = warning.field.split(".")[2] as TextSizeKey;
  return fill("appearance.text_too_small", {
    name: textRowName(`size.${key}`),
    size: String(drawnTextSize(choices, key, WAITRON_DEFAULTS)),
  });
}

function handSetColour(warning: ColourWarning): ThemeColour {
  return warning.field.split(".")[2] as ThemeColour;
}

function screens(mode: Mode): string {
  return t(`appearance.screens.${mode}`);
}

type NamedItem = AgainstItem | { readonly kind: "zone-tabs"; readonly count: number };

function groupItems(keys: readonly string[]): NamedItem[] {
  const items: NamedItem[] = [];
  let tabs = 0;
  for (const item of groupAgainst(keys)) {
    if (item.kind !== "colour" || !ZONE_TABS.has(item.key)) {
      items.push(item);
      continue;
    }
    if (tabs === 0) items.push({ kind: "zone-tabs", count: 0 });
    tabs++;
  }
  return items.map((item) => (item.kind === "zone-tabs" ? { ...item, count: tabs } : item));
}

function counted(prefix: "stations" | "dots" | "tabs", count: number, all: number): string {
  if (count === all) return t(`appearance.against.${prefix}_all`);
  if (count === 1) return t(`appearance.against.${prefix}_one`);
  return fill(`appearance.against.${prefix}`, { n: String(count) });
}

function itemName(item: NamedItem): string {
  switch (item.kind) {
    case "colour":
      return THEME_KEYS.has(item.key)
        ? themeColourName(item.key as ThemeColour)
        : t(`appearance.against.${item.key}` as StringKey);
    case "station-fills":
      return counted("stations", item.count, STATIONS.length);
    case "station-dots":
      return counted("dots", item.count, STATIONS.length);
    case "zone-tabs":
      return counted("tabs", item.count, ZONE_TABS.size);
  }
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${t("appearance.and")} ${names.at(-1)!}`;
}

export function againstNames(keys: readonly string[]): string {
  return listOf(groupItems(keys).map(itemName));
}

/** "on": the warned colour is drawn on the key; "under": the key is drawn on it. */
function sides(warning: ColourWarning): { on: string[]; under: string[] } {
  const colour = handSetColour(warning);
  const on: string[] = [];
  const under: string[] = [];
  for (const key of warning.against) {
    const drawnOn = THEME_RULES[warning.mode].some(
      (rule) => colourKey(rule.a) === colour && colourKey(rule.b) === key,
    );
    (drawnOn ? on : under).push(key);
  }
  return { on, under };
}

function blockerText(warning: ColourWarning, choices: ThemeChoices): string {
  // `blockedBy` names only colours set by hand in the warning's mode.
  const handSet = choices.handSet[warning.mode] as Readonly<Record<string, string>>;
  return warning.blockedBy
    .map((key) =>
      fill("appearance.blocker", {
        name: themeColourName(key as ThemeColour),
        colour: handSet[key] as string,
      }),
    )
    .join(` ${t("appearance.and")} `);
}

export function handWarningLines(warning: ColourWarning, choices: ThemeChoices): string[] {
  const { on, under } = sides(warning);
  const shown = screens(warning.mode);
  if (warning.fix !== null) {
    return [
      ...(on.length > 0
        ? [fill("appearance.hand_on", { screens: shown, names: againstNames(on) })]
        : []),
      ...(under.length > 0
        ? [fill("appearance.hand_under", { screens: shown, names: againstNames(under) })]
        : []),
    ];
  }
  const blocked = warning.blockedBy.length > 0 ? "_blocked" : "";
  const blockers = blockerText(warning, choices);
  if (on.length > 0 && under.length > 0) {
    return [
      fill(`appearance.hand_none_both${blocked}`, {
        screens: shown,
        on: againstNames(on),
        under: againstNames(under),
        blockers,
      }),
    ];
  }
  const side = on.length > 0 ? "on" : "under";
  return [
    fill(`appearance.hand_none_${side}${blocked}`, {
      screens: shown,
      names: againstNames(on.length > 0 ? on : under),
      blockers,
    }),
  ];
}

export function handFixLabel(colour: string): string {
  return fill("appearance.hand_fix", { colour });
}

export function handFixedText(mode: Mode, from: string): string {
  return fill("appearance.hand_fixed", { screens: screens(mode), colour: from });
}

function handItem(key: ThemeColour, mode: Mode): string {
  return fill("appearance.hand_item", {
    name: themeColourName(key),
    mode: t(`appearance.mode.${mode}`),
  });
}

export function handNames(choices: ThemeChoices): string[] {
  return MODES.flatMap((mode) =>
    THEME_COLOURS.filter((key) => choices.handSet[mode][key] !== undefined).map((key) =>
      handItem(key, mode),
    ),
  );
}

function setByHandLine(names: readonly string[], hardToReadCount: number, none: string): string {
  const set =
    names.length === 0
      ? none
      : names.length === 1
        ? fill("appearance.advanced_set_one", { names: names[0]! })
        : fill("appearance.advanced_set", { n: String(names.length), names: names.join(", ") });
  return hardToReadCount === 0
    ? set
    : `${set} · ${countOf("appearance.hard_to_read_count", hardToReadCount)}`;
}

export function advancedSummary(choices: ThemeChoices, warnings: readonly ThemeWarning[]): string {
  return setByHandLine(
    [...handNames(choices), ...textNames(choices)],
    warnings.filter((warning) => warning.field !== "brandColor").length,
    t("appearance.advanced_none"),
  );
}

export function sectionHeading(id: AdvancedSectionId): string {
  return t(`appearance.section.${id}`);
}

function sectionNames(id: AdvancedSectionId, choices: ThemeChoices): string[] {
  if (id === "text") return textNames(choices);
  return MODES.flatMap((mode) =>
    sectionKeys(id)
      .filter((key) => choices.handSet[mode][key] !== undefined)
      .map((key) => handItem(key, mode)),
  );
}

export function sectionSummary(
  id: AdvancedSectionId,
  choices: ThemeChoices,
  warnings: readonly ThemeWarning[],
): string {
  return setByHandLine(
    sectionNames(id, choices),
    warnings.filter((warning) => inSection(id, warning)).length,
    t("appearance.section_none"),
  );
}

export function keptNote(choices: ThemeChoices): string {
  const names = handNames(choices);
  if (names.length === 0) return "";
  if (names.length === 1) return fill("appearance.kept_one", { name: names[0]! });
  return fill("appearance.kept_many", { n: String(names.length), names: names.join(", ") });
}

function hardToRead(warning: ColourWarning): string {
  return fill("appearance.hard_to_read", {
    name: themeColourName(handSetColour(warning)),
    mode: t(`appearance.mode.${warning.mode}`),
  });
}

export function saveDialogLine(warning: ThemeWarning, choices: ThemeChoices): string {
  if (isTextWarning(warning)) return textWarningLine(warning, choices);
  if (warning.field === "brandColor") return t(`appearance.dialog_brand_${warning.mode}`);
  const name = themeColourName(handSetColour(warning));
  const mode = t(`appearance.mode.${warning.mode}`);
  if (warning.fix !== null) {
    const { on, under } = sides(warning);
    return [
      ...(on.length > 0
        ? [fill("appearance.dialog_on", { name, mode, names: againstNames(on) })]
        : []),
      ...(under.length > 0
        ? [fill("appearance.dialog_under", { name, mode, names: againstNames(under) })]
        : []),
    ].join(" ");
  }
  if (warning.blockedBy.length === 0) return fill("appearance.dialog_no_shade", { name, mode });
  return fill("appearance.dialog_blocked", { name, mode, blockers: blockerText(warning, choices) });
}

export function savedWarningLine(warning: ThemeWarning, choices: ThemeChoices): string {
  if (isTextWarning(warning)) return textWarningLine(warning, choices);
  if (warning.field === "brandColor") return t(`appearance.saved_brand_${warning.mode}`);
  return hardToRead(warning);
}

export function textScaleLabel(n: number): string {
  return new Intl.NumberFormat(currentLocale(), { style: "percent" }).format(n / 100);
}

export function textScaleRow(textScale: TextScale): string {
  const size = textScaleLabel(textScale);
  return textScale === 100 ? fill("appearance.text_size_standard", { size }) : size;
}

export function textScaleSpoken(n: number): string {
  return fill("appearance.text_size_spoken", { n: String(n) });
}

function pixels(theme: Pick<DerivedTheme, "light">, size: string): string {
  const name = `--wt-font-size-${size}`;
  const value = theme.light[name];
  if (value === undefined) throw new RangeError(`missing text size: ${name}`);
  return value.replace(/px$/, "");
}

export function textSizesLine(theme: Pick<DerivedTheme, "light">): string {
  return fill("appearance.text_sizes", {
    sm: pixels(theme, "sm"),
    md: pixels(theme, "md"),
    lg: pixels(theme, "lg"),
    xl: pixels(theme, "xl"),
  });
}

/** The preview's sample name in the venue's default content language, else in the screen's. */
export function previewProductName(): { text: string; lang: string } {
  const lang = currentContentLanguages().defaultLanguage;
  const text = catalogues[lang]?.["appearance.preview_product"];
  if (text !== undefined) return { text, lang };
  return { text: t("appearance.preview_product"), lang: currentLocale() };
}
