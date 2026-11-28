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
  "menu-nfc-sticker",
];

it("lists every menu icon", () => {
  expect(Object.keys(MENU_ICONS)).toEqual(ICONS);
});

it.each(ICONS)("registers %s", async (name) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  const path = icon.shadowRoot!.querySelector("svg path");
  expect(path).not.toBeNull();
  expect(path!.getAttribute("d") ?? "").not.toBe("");
});

it.each(["search", "card", "cash", "undo"])("registers the shared %s icon", async (name) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  expect(icon.shadowRoot!.querySelector("svg path")?.getAttribute("d")).toMatch(/^M/);
});

it.each([
  ["menu-section", "a folder outline, its outside and its inside", 2],
  ["menu-filter", "three bars", 3],
])("draws %s as %s", async (name, _shape, parts) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  const d = icon.shadowRoot!.querySelector("svg path")?.getAttribute("d") ?? "";
  expect(d.match(/M/g)).toHaveLength(parts);
  expect(d.match(/Z/g)).toHaveLength(parts);
});

it("draws the home icon: walls and roof inked, the door left open", async () => {
  const icon = await mount(`<wt-icon name="home"></wt-icon>`);
  const d = icon.shadowRoot!.querySelector("svg path")?.getAttribute("d") ?? "";
  expect(d).toMatch(/^M/);
  const ink = await inkAt48(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="48" height="48"><path d="${d}"/></svg>`,
  );
  // 16-grid points times 3: the left wall, the roof's peak, the door's middle.
  const alphaAt = (x: number, y: number) =>
    ink[(Math.round(y * 3) * 48 + Math.round(x * 3)) * 4 + 3]!;
  expect(alphaAt(3.3, 10)).toBeGreaterThan(127);
  expect(alphaAt(8, 2.8)).toBeGreaterThan(127);
  expect(alphaAt(8, 12)).toBeLessThan(128);
});

// The stroke icons in the till redesign's frames (docs/superpowers/specs/2026-11-26-till-handheld-redesign-design.md §12),
// on the 24 grid; each shared icon is a filled-in copy on the 16 grid, compared by its ink at 48px.
const FRAME_DRAWINGS: Record<string, string> = {
  search: `<g stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></g>`,
  card: `<g stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></g>`,
  cash: `<g stroke-width="2"><rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/></g>`,
  undo: `<g stroke-width="2.2"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-2"/></g>`,
};

async function inkAt48(svg: string): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 48;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, 48, 48);
  return context.getImageData(0, 0, 48, 48).data;
}

it.each(Object.keys(FRAME_DRAWINGS))("the shared %s icon is the frame's drawing", async (name) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  const d = icon.shadowRoot!.querySelector("svg path")!.getAttribute("d")!;
  const ours = await inkAt48(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="48" height="48"><path d="${d}"/></svg>`,
  );
  const frame = await inkAt48(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round">${FRAME_DRAWINGS[name]}</svg>`,
  );
  let frameInk = 0;
  let mismatched = 0;
  for (let i = 3; i < frame.length; i += 4) {
    if (frame[i]! > 127) frameInk += 1;
    if (frame[i]! > 127 !== ours[i]! > 127) mismatched += 1;
  }
  expect(frameInk).toBeGreaterThan(100);
  expect(mismatched / frameInk).toBeLessThan(0.05);
});
