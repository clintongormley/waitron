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
  "--wt-space-1": "4px",
  "--wt-space-2": "8px",
  "--wt-space-3": "12px",
  "--wt-space-4": "16px",
  "--wt-space-5": "24px",
  "--wt-space-6": "32px",
  "--wt-radius-md": "8px",
  "--wt-focus-ring": "2px solid var(--wt-color-focus)",
  "--wt-focus-offset": "2px",
  "--wt-font-family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "--wt-font-size-md": "0.875rem",
  "--wt-font-size-lg": "1.125rem",
  "--wt-font-size-xl": "1.375rem",
};

export const fixedFontValue = (name: string, value: string): string =>
  name.startsWith("--wt-font-size-")
    ? `${ownSize(name.slice("--wt-font-size-".length) as TextSizeKey, { structure: { [name]: value } })}px`
    : value;
