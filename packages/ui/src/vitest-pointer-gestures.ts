import type { BrowserCommand } from "vitest/node";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlaywrightFrame {
  locator(selector: string): { boundingBox(): Promise<Box | null> };
}

interface CdpSession {
  send(method: "Input.dispatchTouchEvent", params: TouchEventParams): Promise<unknown>;
  detach(): Promise<void>;
}

interface TouchEventParams {
  type: "touchStart" | "touchMove" | "touchEnd";
  touchPoints: { x: number; y: number }[];
}

interface PlaywrightPage {
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
  context(): { newCDPSession(page: PlaywrightPage): Promise<CdpSession> };
}

/** Only the playwright provider's command context carries these, hence the cast. */
interface PlaywrightCommandContext {
  page: PlaywrightPage;
  frame(): Promise<PlaywrightFrame>;
}

interface Point {
  x: number;
  y: number;
}

const MOVE_STEPS = 5;

/** The centre of the test page's element, in the outer page's coordinates, which is what the
 * mouse and the DevTools input events use. Playwright's CSS reaches into open shadow roots. */
async function centreOf(context: PlaywrightCommandContext, selector: string): Promise<Point> {
  const box = await (await context.frame()).locator(selector).boundingBox();
  if (box === null) throw new Error(`no visible element for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses the real mouse on the first element's centre, moves through each next centre in
 * several steps, and releases on the last. */
export const mouseDrag: BrowserCommand<[selectors: string[]]> = async (context, selectors) => {
  const ctx = context as unknown as PlaywrightCommandContext;
  const [first, ...rest] = selectors;
  if (first === undefined) throw new Error("mouseDrag needs at least one selector");
  const start = await centreOf(ctx, first);
  await ctx.page.mouse.move(start.x, start.y);
  await ctx.page.mouse.down();
  for (const selector of rest) {
    const next = await centreOf(ctx, selector);
    await ctx.page.mouse.move(next.x, next.y, { steps: MOVE_STEPS });
  }
  await ctx.page.mouse.up();
};

export interface TouchGesture {
  at: string;
  holdMs?: number;
  moveTo?: string;
  moveBy?: { x: number; y: number };
}

/** One finger, through Chromium's DevTools input: down on `at`'s centre, held `holdMs` of real
 * time, then moved in steps to `moveTo`'s centre or by `moveBy`, then lifted. */
export const touchGesture: BrowserCommand<[gesture: TouchGesture]> = async (context, gesture) => {
  const ctx = context as unknown as PlaywrightCommandContext;
  const start = await centreOf(ctx, gesture.at);
  const end =
    gesture.moveTo !== undefined
      ? await centreOf(ctx, gesture.moveTo)
      : gesture.moveBy !== undefined
        ? { x: start.x + gesture.moveBy.x, y: start.y + gesture.moveBy.y }
        : start;
  const session = await ctx.page.context().newCDPSession(ctx.page);
  try {
    const touch = (type: TouchEventParams["type"], point: Point | null) =>
      session.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: point === null ? [] : [point],
      });
    await touch("touchStart", start);
    if (gesture.holdMs !== undefined && gesture.holdMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, gesture.holdMs));
    }
    if (end !== start) {
      for (let step = 1; step <= MOVE_STEPS; step++) {
        await touch("touchMove", {
          x: start.x + ((end.x - start.x) * step) / MOVE_STEPS,
          y: start.y + ((end.y - start.y) * step) / MOVE_STEPS,
        });
      }
    }
    await touch("touchEnd", null);
  } finally {
    await session.detach();
  }
};

/**
 * Spread into `test.browser.commands` by every config whose tests call `mouseDrag` or
 * `touchGesture`. Guard: `scripts/park-pointer-registered.test.ts`.
 */
export const pointerGestureCommands = { mouseDrag, touchGesture };
