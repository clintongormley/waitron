import { DROPDOWN_ICONS } from "@waitron/ui";

/**
 * Paths for wt-icon's 16x16 viewBox. `kebab` (wt-row-actions), wt-combobox's `DROPDOWN_ICONS`,
 * `close` (wt-toast) and `minus` and `plus` (wt-number-stepper) are drawn by shared primitives,
 * which need their consuming app to register them.
 *
 * Attribution: some of these are adapted from Google's Material Symbols icon set, Copyright
 * Google, licensed under the Apache License, Version 2.0
 * (https://www.apache.org/licenses/LICENSE-2.0), published at https://fonts.google.com/icons.
 */
export const DASHBOARD_ICONS: Record<string, string> = {
  clock:
    "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11A5.5 5.5 0 0 1 8 2.5ZM7.25 4H8.75V7.5L11 9 10.2 10.2 7.25 8.25Z",
  folder: "M1 3h5l2 2h7v8H1Z",
  hamburger: "M2 3.5H14V4.8H2ZM2 7.35H14V8.65H2ZM2 11.2H14V12.5H2Z",
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  ...DROPDOWN_ICONS,
  gear: "M12.77,5.07 L15.03,6.43 L15.03,9.57 L12.77,10.93L13.45,9.31 L14.08,11.86 L11.86,14.08 L9.31,13.45L10.93,12.77 L9.57,15.03 L6.43,15.03 L5.07,12.77L6.69,13.45 L4.14,14.08 L1.92,11.86 L2.55,9.31L3.23,10.93 L0.97,9.57 L0.97,6.43 L3.23,5.07L2.55,6.69 L1.92,4.14 L4.14,1.92 L6.69,2.55L5.07,3.23 L6.43,0.97 L9.57,0.97 L10.93,3.23L9.31,2.55 L11.86,1.92 L14.08,4.14 L13.45,6.69 Z M5.6,8 a2.4,2.4 0 1,0 4.8,0 a2.4,2.4 0 1,0 -4.8,0",
  person:
    "M8,8c1.47,0 2.67,-1.19 2.67,-2.67s-1.19,-2.67 -2.67,-2.67-2.67,1.19 -2.67,2.67 1.19,2.67 2.67,2.67zm0,1.33c-1.78,0 -5.33,0.89 -5.33,2.67v1.33h10.67v-1.33c0,-1.77 -3.55,-2.67 -5.33,-2.67z",
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
  minus: "M2.5 7.25H13.5V8.75H2.5Z",
  bin: "M6 1.75H10V3.25H13.5V4.75H2.5V3.25H6ZM3.75 4.75H12.25V13a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1ZM5 4.75V12.75H11V4.75ZM6.5 6.5H7.5V11H6.5ZM8.5 6.5H9.5V11H8.5Z",
  grip: "M6 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0",
  bell: "M8 14.5a1.5 1.5 0 0 0 1.5-1.5h-3A1.5 1.5 0 0 0 8 14.5ZM12.5 10.5V7.25c0-2.2-1.2-4-3.25-4.5V2.25a1.25 1.25 0 0 0-2.5 0v.5C4.7 3.25 3.5 5.05 3.5 7.25v3.25L2 12v.5h12V12Z",
  close:
    "M3.7 2.6 8 6.9l4.3-4.3 1.1 1.1L9.1 8l4.3 4.3-1.1 1.1L8 9.1l-4.3 4.3-1.1-1.1L6.9 8 2.6 3.7Z",
  "select-rows":
    "M1 1h6v6H1Z M2 2v4h4V2Z M2.8 4.2l.7-.7.9.9 1.6-1.6.7.7-2.3 2.3Z M9 3h6v2H9Z M1 9h6v6H1Z M2 10v4h4v-4Z M9 11h6v2H9Z",
};
