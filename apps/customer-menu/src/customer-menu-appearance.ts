import { isStoredColor, type CustomerMenuAppearance } from "@waitron/shared";
import {
  contrastRatio,
  fromOklch,
  type Mode,
  toOklch,
  typefaceStack,
  WAITRON_CHOICES,
} from "@waitron/ui-core/theme";
import { deriveTheme, WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";

function menuColorScheme(pageColor?: string): Mode {
  return pageColor && contrastRatio(pageColor, "#ffffff") > contrastRatio(pageColor, "#000000")
    ? "dark"
    : "light";
}

function tintedSecondaryText(palette: Readonly<Record<string, string>>, tint: string): string {
  const muted = palette["--wt-color-text-muted"]!;
  const { L } = toOklch(muted);
  const { C, H } = toOklch(tint);
  const colored = fromOklch({ L, C: Math.min(C, 0.025), H });
  const grounds = ["--wt-color-bg", "--wt-color-surface", "--wt-color-surface-raised"];
  return grounds.every((token) => contrastRatio(colored, palette[token]!) >= 4.5) ? colored : muted;
}

function menuAppearanceTokens(
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
        ...(pageColor && { bg: pageColor, surface: pageColor }),
        ...(textColor && { text: textColor }),
      },
    },
    text: textFont ? { family: textFont } : {},
  });
  const tint = textColor ?? pageColor;
  return {
    ...palette,
    ...(tint && { "--wt-color-text-muted": tintedSecondaryText(palette, tint) }),
    "--wt-menu-heading-font": typefaceStack(headingFont ?? "system", WAITRON_DEFAULTS),
    ...(headingFont === "serif" && {
      "--wt-menu-heading-weight": "var(--wt-font-weight-normal)",
    }),
    ...(textFont === "serif" && {
      "--wt-menu-entry-weight": "var(--wt-font-weight-medium)",
    }),
    ...(headingColor && {
      "--wt-menu-heading-color": headingColor,
      "--wt-menu-current-section-text": "var(--wt-color-text)",
    }),
  };
}

const builtIn = { scheme: "light" as const, tokens: {} };

export function resolveMenuAppearance(appearance?: CustomerMenuAppearance): {
  scheme: Mode;
  tokens: Record<string, string>;
} {
  if (appearance == null) return builtIn;
  const { pageColor, textColor, headingColor, textFont, headingFont } = appearance;
  const invalidColor = [pageColor, textColor, headingColor].some(
    (color) =>
      color !== undefined && (typeof color !== "string" || !isStoredColor(color.toLowerCase())),
  );
  const invalidFont = [textFont, headingFont].some(
    (font) => font !== undefined && font !== "system" && font !== "serif",
  );
  if (invalidColor || invalidFont) return builtIn;
  const scheme = menuColorScheme(pageColor);
  return { scheme, tokens: menuAppearanceTokens(appearance, scheme) };
}
