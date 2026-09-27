import axe from "axe-core";
import { commands } from "vitest/browser";
import { beforeEach, expect } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import type { DocumentMember, ServedMenu } from "@waitron/catalogue/src/menu-document-types.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
  }
}

/**
 * Mounts by ASSIGNING PROPERTIES, where `packages/ui/src/test-helpers.ts` parses an HTML string: till
 * widgets take objects as `@property({ attribute: false })`, which cannot travel through markup.
 */

// Standalone widget fixtures use a Spanish venue; app roots replace this with their API configuration.
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

/**
 * Starts every test with the mouse cursor off the page, so nothing inherits a `:hover` that an
 * earlier test's click or hover left behind — the cursor belongs to the shared page, not to the test
 * that moved it, and it outlives the file that moved it. Without this an a11y scan can catch a button
 * dimmed by `wt-button`'s hover rule and report a colour-contrast violation nobody can see in the app.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;

/** The element under test plus the themed host it was mounted into (pass the host to axe). */
export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Mounts a custom element `tag` with `props` assigned before connection, inside a fresh themed
 * host, and waits for its first render. It paints the host's `--wt-color-bg` as a real deployment
 * does. Pass `theme` to pin `data-theme` so a color-contrast a11y check means what it means in the app;
 * omit it to render in whatever theme the environment resolves to.
 */
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
 * Paints the page canvas as `index.html` does in the app. The harness themes only `host`, and axe
 * composites any element it cannot trace back to `host` (one pushed off-viewport, say) against the page
 * canvas — white by default, a false contrast failure for the dark theme. `<body>`/`<html>` are not theme
 * roots, so the concrete colour is read off `host` rather than passing the `var()`.
 */
function paintCanvas(host: HTMLElement): void {
  const bg = getComputedStyle(host).backgroundColor;
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

/** Runs the full default axe ruleset against `context` and fails the test on any violation. */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

type ServedFields = Pick<
  ServedMenu,
  "structure" | "homeLayouts" | "defaultHomeLayoutId" | "homeLayoutId" | "layoutFallback"
>;

/** An offer a {@link servedMenus} structure lists; with `section`, inside a section of that name. */
export interface ServedOffer {
  id: string;
  menuId: string;
  productId: string;
  section?: string;
}

/**
 * Gives each menu what a zone-offers body serves beside it: a structure listing that menu's own
 * offers in order, a section placed where its first offer falls, under a default layout with no
 * shortcuts, so a menu browser shows each offer once. With `shortcuts`, each menu also has a layout
 * `<menu id>-shortcuts` whose tiles are its offers; a menu's own `homeLayoutId` picks the layout the
 * device shows, the default otherwise.
 */
export function servedMenus<M extends { id: string; homeLayoutId?: string }>(
  menus: readonly M[],
  offers: readonly ServedOffer[],
  { shortcuts = false }: { shortcuts?: boolean } = {},
): (M & ServedFields)[] {
  return menus.map((menu) => {
    const own = offers.filter((offer) => offer.menuId === menu.id);
    const members: DocumentMember[] = [];
    for (const offer of own) {
      const placed: DocumentMember = {
        kind: "product",
        menuItemId: offer.id,
        productId: offer.productId,
      };
      if (offer.section === undefined) {
        members.push(placed);
        continue;
      }
      const sectionId = `${menu.id}/${offer.section}`;
      let section = members.find(
        (member): member is Extract<DocumentMember, { kind: "section" }> =>
          member.kind === "section" && member.sectionId === sectionId,
      );
      if (section === undefined) {
        section = {
          kind: "section",
          sectionId,
          internalName: offer.section,
          names: { en: offer.section },
          image: null,
          color: null,
          members: [],
        };
        members.push(section);
      }
      section.members.push(placed);
    }
    const home = `${menu.id}-home`;
    return {
      ...menu,
      structure: { members },
      homeLayouts: [
        { id: home, name: "Home", tiles: [] },
        ...(shortcuts
          ? [
              {
                id: `${menu.id}-shortcuts`,
                name: "Shortcuts",
                tiles: own.map((offer) => ({
                  kind: "product" as const,
                  productId: offer.productId,
                })),
              },
            ]
          : []),
      ],
      defaultHomeLayoutId: home,
      homeLayoutId: menu.homeLayoutId ?? home,
      layoutFallback: null,
    };
  });
}
