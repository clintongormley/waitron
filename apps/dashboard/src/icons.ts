/**
 * The dashboard's registered icon set — see registerIcons() in @waitron/ui and "Icons" in
 * docs/developers/design-system.md. Each is a plain geometric shape at wt-icon's 16x16 viewBox, not
 * borrowed from an external icon library, so there is nothing to attribute or keep in sync.
 *
 * - hamburger: the sidebar drawer toggle (three bars — opens the whole app's navigation).
 * - kebab: wt-row-actions' per-row "more actions" trigger (three dots — a small, local menu, not
 *   the same thing a hamburger means; wt-row-actions requires its consuming app to register this).
 * - chevron-down: a collapsible section header's disclosure indicator, rotated via CSS to point up
 *   when expanded rather than needing a second registered icon.
 */
export const DASHBOARD_ICONS: Record<string, string> = {
  hamburger: "M2 3.5H14V4.8H2ZM2 7.35H14V8.65H2ZM2 11.2H14V12.5H2Z",
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  "chevron-down": "M4.9 5.7L8 8.8L11.1 5.7L12 6.7L8 10.7L4 6.7Z",
};
