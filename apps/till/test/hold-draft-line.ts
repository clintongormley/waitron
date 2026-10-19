import type { Frame, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

export const holdDraftLine: BrowserCommand<[selector: string]> = async (context, selector) => {
  const { page, frame } = context as unknown as { page: Page; frame(): Promise<Frame> };
  const locator = (await frame()).locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`No visible draft line: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await (await frame()).locator(`${selector}[data-draft-dragging]`).waitFor({ timeout: 2_000 });
  } finally {
    await page.mouse.up();
  }
};
