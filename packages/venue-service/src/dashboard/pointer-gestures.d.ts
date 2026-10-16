import type { TouchGesture } from "@waitron/ui/src/vitest-pointer-gestures.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    /** `packages/ui/src/vitest-pointer-gestures.ts`. */
    mouseDrag: (selectors: string[]) => Promise<void>;
    touchGesture: (gesture: TouchGesture) => Promise<void>;
  }
}
