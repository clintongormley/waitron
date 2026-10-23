import {
  type AgainstItem,
  MODES,
  type Mode,
  STATIONS,
  THEME_COLOURS,
  THEME_RULES,
  type ThemeChoices,
  type ThemeColour,
  type ThemeWarning,
  colourKey,
  groupAgainst,
} from "@waitron/ui-core/theme";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";
import { countOf } from "./count-text.js";

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

export function fixAllText(count: number): string {
  return fill("appearance.fix_all_count", { n: String(count) });
}

function handSetColour(warning: ThemeWarning): ThemeColour {
  return warning.field.split(".")[2] as ThemeColour;
}

function screens(mode: Mode): string {
  return t(`appearance.screens.${mode}`);
}

type NamedItem = AgainstItem | { readonly kind: "zone-tabs"; readonly count: number };

/** `groupAgainst`, with the zone tab tints folded into one counted item where the first stood. */
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
function sides(warning: ThemeWarning): { on: string[]; under: string[] } {
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

function blockerText(warning: ThemeWarning, choices: ThemeChoices): string {
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

export function handWarningLines(warning: ThemeWarning, choices: ThemeChoices): string[] {
  const { on, under } = sides(warning);
  const values = { screens: screens(warning.mode), names: "" };
  if (warning.fix !== null) {
    return [
      ...(on.length > 0
        ? [fill("appearance.hand_on", { ...values, names: againstNames(on) })]
        : []),
      ...(under.length > 0
        ? [fill("appearance.hand_under", { ...values, names: againstNames(under) })]
        : []),
    ];
  }
  const blocked = warning.blockedBy.length > 0 ? "_blocked" : "";
  const blockers = blockerText(warning, choices);
  if (on.length > 0 && under.length > 0) {
    return [
      fill(`appearance.hand_none_both${blocked}`, {
        screens: values.screens,
        on: againstNames(on),
        under: againstNames(under),
        blockers,
      }),
    ];
  }
  const side = on.length > 0 ? "on" : "under";
  return [
    fill(`appearance.hand_none_${side}${blocked}`, {
      ...values,
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

export function handNames(choices: ThemeChoices): string[] {
  return MODES.flatMap((mode) =>
    THEME_COLOURS.filter((key) => choices.handSet[mode][key] !== undefined).map((key) =>
      fill("appearance.hand_item", {
        name: themeColourName(key),
        mode: t(`appearance.mode.${mode}`),
      }),
    ),
  );
}

export function advancedSummary(choices: ThemeChoices, warnings: readonly ThemeWarning[]): string {
  const names = handNames(choices);
  const set =
    names.length === 0
      ? t("appearance.advanced_none")
      : names.length === 1
        ? fill("appearance.advanced_set_one", { names: names[0]! })
        : fill("appearance.advanced_set", { n: String(names.length), names: names.join(", ") });
  const hardToReadCount = warnings.filter((warning) => warning.field !== "brandColor").length;
  return hardToReadCount === 0
    ? set
    : `${set} · ${countOf("appearance.hard_to_read_count", hardToReadCount)}`;
}

export function keptNote(choices: ThemeChoices): string {
  const names = handNames(choices);
  if (names.length === 0) return "";
  if (names.length === 1) return fill("appearance.kept_one", { name: names[0]! });
  return fill("appearance.kept_many", { n: String(names.length), names: names.join(", ") });
}

function hardToRead(warning: ThemeWarning): string {
  return fill("appearance.hard_to_read", {
    name: themeColourName(handSetColour(warning)),
    mode: t(`appearance.mode.${warning.mode}`),
  });
}

export function saveDialogLine(warning: ThemeWarning, choices: ThemeChoices): string {
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

export function savedWarningLine(warning: ThemeWarning): string {
  if (warning.field === "brandColor") return t(`appearance.saved_brand_${warning.mode}`);
  return hardToRead(warning);
}
