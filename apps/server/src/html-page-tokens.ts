import { ownSize, type TextSizeKey } from "@waitron/ui-core/theme";

/** Copies of `packages/ui-core/src/tokens/*.css`, as [light, dark] or one value; `scripts/guide-page-tokens.test.ts` compares them. */
export const GUIDE_PAGE_TOKENS: Readonly<Record<string, readonly [string, string] | string>> = {
  "--wt-color-bg": ["#f7f7f8", "#101216"],
  "--wt-color-surface-sunken": ["#d6d9e0", "#101216"],
  "--wt-color-border": ["#d6d9e0", "#333945"],
  "--wt-color-text": ["#231f20", "#eceef2"],
  "--wt-color-text-muted": ["#626366", "#a1a7b3"],
  "--wt-color-primary": ["#007392", "#71cfeb"],
  "--wt-color-primary-text": ["#007392", "#71cfeb"],
  "--wt-color-focus": ["#007392", "#71cfeb"],
  "--wt-color-highlight": ["#fff3b0", "#614a0f"],
  "--wt-color-on-highlight": ["#241500", "#fff3b0"],
  "--wt-color-on-primary": ["#ffffff", "#001016"],
  "--wt-color-primary-hover": ["#09607a", "#8ae2fd"],
  "--wt-color-primary-disabled": ["#7acae9", "#16353e"],
  "--wt-color-on-primary-disabled": ["#ffffff", "#91a9b2"],
  "--wt-color-danger": ["#b3261e", "#ff7f73"],
  "--wt-color-field-fill": ["#f0f1f4", "#262a33"],
  "--wt-color-field-line": ["#7d8390", "#7a8291"],
  "--wt-color-field-value": ["#000000", "#ffffff"],
  "--wt-space-1": "4px",
  "--wt-space-2": "8px",
  "--wt-space-3": "12px",
  "--wt-space-4": "16px",
  "--wt-space-5": "24px",
  "--wt-space-6": "32px",
  "--wt-radius-md": "8px",
  "--wt-focus-ring": "2px solid var(--wt-color-focus)",
  "--wt-focus-offset": "2px",
  "--wt-tap-min": "44px",
  "--wt-field-line-width": "1px",
  "--wt-field-line-width-active": "2px",
  "--wt-form-max-width": "36rem",
  "--wt-font-family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "--wt-font-size-sm": "0.75rem",
  "--wt-font-size-md": "0.875rem",
  "--wt-font-size-lg": "1.125rem",
  "--wt-font-size-xl": "1.375rem",
  "--wt-font-weight-bold": "600",
  "--wt-text-control-font-size": "max(1rem, 1em, var(--wt-font-size-md))",
};

export const fixedFontValue = (name: string, value: string): string =>
  name.startsWith("--wt-font-size-")
    ? `${ownSize(name.slice("--wt-font-size-".length) as TextSizeKey, { structure: { [name]: value } })}px`
    : value;
