import type { Mode, ThemeChoices, ThemeColour, ThemeWarning } from "@waitron/ui-core/theme";
import { fill, t } from "../i18n/t.js";

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

function hardToRead(warning: ThemeWarning): string {
  return fill("appearance.hard_to_read", {
    name: themeColourName(handSetColour(warning)),
    mode: t(`appearance.mode.${warning.mode}`),
  });
}

export function saveDialogLine(warning: ThemeWarning, choices: ThemeChoices): string {
  if (warning.field === "brandColor") return t(`appearance.dialog_brand_${warning.mode}`);
  if (warning.fix !== null) return hardToRead(warning);
  const name = themeColourName(handSetColour(warning));
  const mode = t(`appearance.mode.${warning.mode}`);
  if (warning.blockedBy.length === 0) return fill("appearance.dialog_no_shade", { name, mode });
  // `blockedBy` names only colours set by hand in the warning's mode.
  const handSet = choices.handSet[warning.mode] as Readonly<Record<string, string>>;
  const blockers = warning.blockedBy
    .map((key) =>
      fill("appearance.blocker", {
        name: themeColourName(key as ThemeColour),
        colour: handSet[key] as string,
      }),
    )
    .join(` ${t("appearance.and")} `);
  return fill("appearance.dialog_blocked", { name, mode, blockers });
}

export function savedWarningLine(warning: ThemeWarning): string {
  if (warning.field === "brandColor") return t(`appearance.saved_brand_${warning.mode}`);
  return hardToRead(warning);
}
