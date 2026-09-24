import type { BrowserCommand } from "vitest/node";

interface PlaywrightMousePage {
  mouse: { move(x: number, y: number): Promise<void> };
}

/**
 * Moves the real mouse cursor off every element, so nothing is left matching CSS `:hover`. The cursor
 * belongs to the page every test file in a worker shares, so an earlier test's click can leave a later
 * test's element hovered, and `wt-button`'s hover dimming then fails axe's colour-contrast check.
 *
 * `userEvent.unhover()` cannot do this: @vitest/browser implements it as a hover of `html > body`,
 * which parks the cursor in the middle of the page. Negative coordinates are outside the viewport.
 */
export const parkPointer: BrowserCommand<[]> = async (context) => {
  const { page } = context as unknown as { page: PlaywrightMousePage };
  await page.mouse.move(-1, -1);
};

/**
 * Spread into `test.browser.commands` by every config whose tests call `commands.parkPointer()`, which
 * otherwise throws `TypeError`. Guard: `scripts/park-pointer-registered.test.ts`.
 */
export const parkPointerCommands = { parkPointer };
