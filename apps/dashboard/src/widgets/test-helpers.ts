import axe from "axe-core";
import { commands, page } from "vitest/browser";
import { beforeEach, expect, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import type { DocumentMember, FrozenOffer, MenuDocument } from "../api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
    emulateReducedMotion: (reducedMotion: "reduce" | "no-preference" | null) => Promise<void>;
  }
}

/**
 * Mounts by ASSIGNING PROPERTIES rather than parsing an HTML string: dashboard widgets take their data
 * as `@property({ attribute: false })` objects, which cannot travel through markup.
 */

// Standalone widget fixtures use a Spanish venue; app roots replace this with their API configuration.
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

/**
 * The cursor belongs to the shared page, not to the test that moved it, and it outlives the file that
 * moved it. Without this an a11y scan can catch a button dimmed by `wt-button`'s hover rule and report
 * a colour-contrast violation nobody can see in the app.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;

export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
  theme?: Theme,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  paintCanvas(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/**
 * Paints the page CANVAS (`<body>` and `<html>`) with `host`'s resolved theme background, as
 * `index.html` does in the app. axe-core composites the background of any element it cannot trace
 * back to `host` (e.g. one pushed off-viewport by a wide header) against that canvas, and the default
 * WHITE canvas reads as a false color-contrast failure for the dark theme's light text.
 * `<body>`/`<html>` are not themselves theme roots, so read the concrete colour off `host` rather than
 * passing the `var()`.
 */
function paintCanvas(host: HTMLElement): void {
  const bg = getComputedStyle(host).backgroundColor;
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}

export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

/**
 * Resolves once every `<dialog>` close already queued has been delivered. The browser reports a
 * close in a later task, which a zero-delay timer can run ahead of, so this closes a throwaway
 * dialog and waits for ITS report, queued behind the rest.
 */
export async function closeReportsDelivered(): Promise<void> {
  const probe = document.createElement("dialog");
  document.body.append(probe);
  probe.show();
  const reported = new Promise((resolve) =>
    probe.addEventListener("close", resolve, { once: true }),
  );
  probe.close();
  await reported;
  probe.remove();
}

/**
 * The RGBA values Chromium PAINTED at each viewport point, read from a screenshot of `frame`, which
 * must contain every point. A colour input's computed `backgroundColor`, and its swatch's, did not
 * change with the chosen colour, so these tests read the painted pixels instead.
 */
async function paintedPixels(
  frame: Element,
  points: { x: number; y: number }[],
): Promise<number[][]> {
  const tester = window.frameElement;
  const scale = tester?.parentElement?.getAttribute("data-scale");
  if (Number(scale) !== 1) {
    throw new Error(
      `paintedPixels needs the test frame at one screenshot pixel per CSS pixel, and Vitest has it scaled by ${scale}; make the viewport fit the page.`,
    );
  }
  const png = await page.screenshot({ element: frame, save: false });
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${png}`)).blob(),
  );
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  // Playwright crops at the floor of the element's box in the TOP page (`enclosingIntRect`), so a
  // point's pixel is its own floor there less the crop's, not the floor of its offset in the box.
  const offset = tester!.getBoundingClientRect();
  const box = frame.getBoundingClientRect();
  const left = Math.floor(offset.left + box.left + 1e-3);
  const top = Math.floor(offset.top + box.top + 1e-3);
  return points.map(({ x, y }) => [
    ...context.getImageData(
      Math.floor(offset.left + x) - left,
      Math.floor(offset.top + y) - top,
      1,
      1,
    ).data,
  ]);
}

/** The RGBA a CSS colour string paints as. */
function rgba(color: string): number[] {
  const context = new OffscreenCanvas(1, 1).getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
}

/**
 * What the colour field's Custom square paints at its centre, in the middle of its left border, and
 * beside it on the same row, plus the RGBA of its computed border colour. `row` and `column` are
 * every pixel from its left and its top edge in to its centre, and `ringColor` the RGBA of the
 * selected ring's `--wt-color-primary`.
 */
export async function customSquarePixels(root: ParentNode): Promise<{
  inside: number[];
  border: number[];
  borderColor: number[];
  beside: number[];
  row: number[][];
  column: number[][];
  ringColor: number[];
}> {
  // Vitest shrinks the test frame to fit Playwright's page, so a frame taller than the page is
  // screenshotted below one pixel per CSS pixel and a 1px border blurs. 560 fits under the page's
  // default height; `paintedPixels` refuses a frame that is still shrunk.
  const [width, height] = [innerWidth, innerHeight];
  const shorter = Math.min(height, 560);
  await page.viewport(width, shorter);
  try {
    await vi.waitFor(() => expect(innerHeight).toBe(shorter));
    const label = root.querySelector(".custom")!;
    label.scrollIntoView({ block: "center" });
    const input = label.querySelector('input[type="color"]')!;
    const square = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    const y = square.top + square.height / 2;
    const x = square.left + square.width / 2;
    const inward = (length: number) =>
      Array.from({ length: Math.floor(length / 2) }, (_, i) => i + 0.5);
    const rowPoints = inward(square.width).map((i) => ({ x: square.left + i, y }));
    const columnPoints = inward(square.height).map((i) => ({ x, y: square.top + i }));
    const [inside, border, beside, ...edges] = await paintedPixels(label, [
      { x, y },
      { x: square.left + parseFloat(style.borderLeftWidth) / 2, y },
      { x: square.right + square.width / 2, y },
      ...rowPoints,
      ...columnPoints,
    ]);
    return {
      inside: inside!,
      border: border!,
      borderColor: rgba(style.borderLeftColor),
      beside: beside!,
      row: edges.slice(0, rowPoints.length),
      column: edges.slice(rowPoints.length),
      ringColor: rgba(style.getPropertyValue("--wt-color-primary").trim()),
    };
  } finally {
    await page.viewport(width, height);
  }
}

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

// The reasons in axe's colour-contrast messages (`locales/_template.json`) counted as being about
// the colours themselves. axe 4.13.0 never sets `fgAlpha`.
const UNDECIDED_COLOUR_READINGS = new Set(["equalRatio", "fgAlpha", "colorParse"]);

function undecidedColourReadings(incomplete: axe.Result[]): string[] {
  return incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) =>
      result.nodes.flatMap((node) =>
        node.any
          .filter((check) =>
            UNDECIDED_COLOUR_READINGS.has(
              (check.data as { messageKey?: string } | null)?.messageKey ?? "",
            ),
          )
          .map(
            (check) =>
              `${result.id} [undecided]: ${check.message}\n  targets: ${node.target.join(" ")}`,
          ),
      ),
    );
}

/**
 * Runs the full default axe ruleset against `context` and fails the test on any violation, or on a
 * colour-contrast check axe left undecided for a reason about the colours themselves (`equalRatio`,
 * `fgAlpha`, `colorParse`).
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}

export function documentProduct(menuItemId: string, productId: string): DocumentMember {
  return { kind: "product", menuItemId, productId };
}

export function documentSection(
  sectionId: string,
  internalName: string,
  members: DocumentMember[],
): DocumentMember {
  return {
    kind: "section",
    sectionId,
    internalName,
    names: { es: `${internalName} para clientes` },
    image: null,
    color: null,
    members,
  };
}

/**
 * A published-menu document holding `members` at its top level, with one offer per product it
 * holds, named `names[productId]`. The offer's customer and kitchen names read differently, so a view
 * showing either fails rather than passing by coincidence.
 */
export function menuDocument(
  members: DocumentMember[],
  names: Record<string, string>,
  menuName = "Lunch Menu",
): MenuDocument {
  const offers: Record<string, FrozenOffer> = {};
  const walk = (list: DocumentMember[]): void => {
    for (const member of list)
      if (member.kind === "section") walk(member.members);
      else offers[member.menuItemId] = frozenOffer(member, names[member.productId]!, menuName);
  };
  walk(members);
  return {
    format: 3,
    menuId: "menu-lunch",
    menuName,
    root: { members },
    offers,
    home: {
      shortcuts: [],
      handheld: HOME_DISPLAY_DEFAULTS.handheld,
      till: HOME_DISPLAY_DEFAULTS.till,
    },
  };
}

function frozenOffer(
  member: Extract<DocumentMember, { kind: "product" }>,
  name: string,
  menuName: string,
): FrozenOffer {
  return {
    id: member.menuItemId,
    menuId: "menu-lunch",
    productId: member.productId,
    grossPrice: null,
    unitPrice: "3.00",
    menuName,
    name,
    customerName: { es: `${name} para clientes` },
    kitchenName: `${name.toUpperCase()} COCINA`,
    unit: {
      id: "unit-each",
      name: { en: "Each" },
      precision: 0,
      abbreviation: { en: "ea" },
      hardwareUnit: null,
    },
    vatClass: "reduced",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    image: null,
    description: null,
    variants: [],
    placements: [],
    offeredModifiers: [],
  };
}

export function combinedFixture(
  productId: string,
  price: string,
  variants: { variantId: string; price: string | null }[] = [],
  ownPrice: string | null = null,
  cataloguePrice = price,
  catalogueVariants: Record<string, string | null> = {},
): import("@waitron/catalogue/src/menu-combine-types.js").CombinedOffer {
  type Decimal = import("@waitron/shared").Decimal;
  type Setting<T> = import("@waitron/catalogue/src/menu-combine-types.js").Setting<T>;
  const decided = <T>(
    value: T,
    kind: "own" | "product" | "parent" = "product",
    otherwise: Setting<T> | null = null,
  ): Setting<T> => ({ state: "decided", value, source: { kind }, otherwise });
  const product = decided(cataloguePrice as Decimal);
  const productPrice = ownPrice === null ? product : decided(price as Decimal, "own", product);
  return {
    productId,
    price: productPrice,
    variants: variants.map((v) => {
      const catalogue = catalogueVariants[v.variantId] ?? null;
      const parent = decided(
        price as Decimal,
        "parent",
        ownPrice === null ? null : decided(cataloguePrice as Decimal, "parent"),
      );
      const fallback = catalogue === null ? parent : decided(catalogue as Decimal);
      return {
        variantId: v.variantId,
        price: {
          ...(v.price === null ? fallback : decided(v.price as Decimal, "own", fallback)),
          level: v.price !== null || catalogue !== null ? "size" : "product",
        },
      };
    }),
  };
}
