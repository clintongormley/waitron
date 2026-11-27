import type { CustomerMenuAppearance } from "@waitron/shared";
import { contrastRatio, type Mode, typefaceStack, WAITRON_CHOICES } from "@waitron/ui-core/theme";
import { deriveTheme, WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";

export function menuColorScheme(pageColor?: string): Mode {
  return pageColor && contrastRatio(pageColor, "#ffffff") > contrastRatio(pageColor, "#000000")
    ? "dark"
    : "light";
}

export function menuAppearanceTokens(
  appearance: CustomerMenuAppearance,
  scheme: Mode,
): Record<string, string> {
  const { pageColor, textColor, headingColor, textFont, headingFont } = appearance;
  const { [scheme]: palette } = deriveTheme({
    ...WAITRON_CHOICES,
    brandColor: headingColor ?? null,
    brandFix: { [scheme]: true },
    handSet: {
      ...WAITRON_CHOICES.handSet,
      [scheme]: {
        ...(pageColor && { bg: pageColor }),
        ...(textColor && { text: textColor }),
      },
    },
    text: textFont ? { family: textFont } : {},
  });
  return {
    ...palette,
    "--wt-menu-heading-font": typefaceStack(headingFont ?? "system", WAITRON_DEFAULTS),
    ...(headingColor && { "--wt-menu-heading-color": headingColor }),
  };
}
