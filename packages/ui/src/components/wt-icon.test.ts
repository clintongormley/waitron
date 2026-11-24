import { afterEach, expect, it } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { MENU_ICONS } from "./wt-icon.js";

afterEach(cleanup);

const ICONS = [
  "kebab",
  "menu-open",
  "menu-edit",
  "menu-rename",
  "menu-copy",
  "menu-default",
  "menu-up",
  "menu-down",
  "menu-move",
  "menu-settings",
  "menu-details",
  "menu-translations",
  "menu-variants",
  "menu-add",
  "menu-invite",
  "menu-resend",
  "menu-reset-login",
  "menu-reset-pin",
  "menu-account",
  "menu-logout",
  "menu-undo",
  "menu-fire",
  "menu-bill",
  "menu-remove",
  "menu-disable",
  "menu-delete",
  "menu-print",
  "menu-archive",
  "menu-clear",
  "menu-follow-season",
  "menu-cancel-publication",
  "menu-credit",
  "menu-disconnect",
  "menu-pair",
  "menu-merge",
  "menu-split",
  "menu-discount",
  "menu-unpaid",
  "menu-finish",
  "menu-cash",
  "menu-drawer",
  "menu-report",
  "menu-clock-in",
  "menu-start-break",
  "menu-end-break",
  "menu-retry",
  "menu-hours",
  "menu-list",
  "menu-map",
  "menu-reset-plan",
  "menu-check",
  "menu-download",
  "menu-equipment-label",
];

it("lists every icon it registers", () => {
  expect(Object.keys(MENU_ICONS)).toEqual(ICONS);
});

it.each(ICONS)("registers %s", async (name) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  const path = icon.shadowRoot!.querySelector("svg path");
  expect(path).not.toBeNull();
  expect(path!.getAttribute("d") ?? "").not.toBe("");
});
