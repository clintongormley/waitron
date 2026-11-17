import type {
  MouseDragOptions,
  MouseMoveOptions,
  TouchGesture,
} from "./vitest-pointer-gesture-types.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    mouseDrag: (selectors: string[], options?: MouseDragOptions) => Promise<void>;
    mouseMove: (selectors: string[], options?: MouseMoveOptions) => Promise<void>;
    touchGesture: (gesture: TouchGesture) => Promise<void>;
    parkTouch: () => Promise<void>;
  }
}
