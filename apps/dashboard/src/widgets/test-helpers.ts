import axe from "axe-core";
import { commands } from "vitest/browser";
import { beforeEach, expect } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import type { DocumentMember, FrozenOffer, MenuDocument } from "../api/client.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
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

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
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
    format: 1,
    menuId: "menu-lunch",
    menuName,
    root: { members },
    offers,
    homeLayouts: [{ id: "layout-home", name: "Home", tiles: [] }],
    defaultHomeLayoutId: "layout-home",
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
    active: true,
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
