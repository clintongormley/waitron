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
 * - gear: the Settings nav group's header icon. Generated (not hand-plotted) — an 8-tooth ring
 *   computed with trigonometry at 16x16, verified by rendering it large before use.
 * - person: the banner's account-menu trigger (head + shoulders bust). Scaled by 2/3 from Material
 *   Design's 24x24 "person" glyph's own path numbers (a uniform scale keeps its bezier curves
 *   correct), not hand-plotted.
 */
export const DASHBOARD_ICONS: Record<string, string> = {
  hamburger: "M2 3.5H14V4.8H2ZM2 7.35H14V8.65H2ZM2 11.2H14V12.5H2Z",
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  "chevron-down": "M4.9 5.7L8 8.8L11.1 5.7L12 6.7L8 10.7L4 6.7Z",
  gear: "M12.77,5.07 L15.03,6.43 L15.03,9.57 L12.77,10.93L13.45,9.31 L14.08,11.86 L11.86,14.08 L9.31,13.45L10.93,12.77 L9.57,15.03 L6.43,15.03 L5.07,12.77L6.69,13.45 L4.14,14.08 L1.92,11.86 L2.55,9.31L3.23,10.93 L0.97,9.57 L0.97,6.43 L3.23,5.07L2.55,6.69 L1.92,4.14 L4.14,1.92 L6.69,2.55L5.07,3.23 L6.43,0.97 L9.57,0.97 L10.93,3.23L9.31,2.55 L11.86,1.92 L14.08,4.14 L13.45,6.69 Z M5.6,8 a2.4,2.4 0 1,0 4.8,0 a2.4,2.4 0 1,0 -4.8,0",
  person:
    "M8,8c1.47,0 2.67,-1.19 2.67,-2.67s-1.19,-2.67 -2.67,-2.67-2.67,1.19 -2.67,2.67 1.19,2.67 2.67,2.67zm0,1.33c-1.78,0 -5.33,0.89 -5.33,2.67v1.33h10.67v-1.33c0,-1.77 -3.55,-2.67 -5.33,-2.67z",
};
