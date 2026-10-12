import { expect, it, vi } from "vitest";
import { capturePointer, releasePointer, DRAG_THRESHOLD_PX } from "./pointer-drag.js";
it("captures the active pointer and releases only a pointer held by that element", () => {
  const setPointerCapture = vi.fn(),
    releasePointerCapture = vi.fn(),
    hasPointerCapture = vi.fn().mockReturnValue(true);
  const el = { setPointerCapture, releasePointerCapture, hasPointerCapture } as unknown as Element;
  capturePointer(el, 8);
  releasePointer(el, 8);
  expect(setPointerCapture).toHaveBeenCalledExactlyOnceWith(8);
  expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(8);
  hasPointerCapture.mockReturnValue(false);
  releasePointer(el, 7);
  expect(releasePointerCapture).toHaveBeenCalledTimes(1);
  expect(DRAG_THRESHOLD_PX).toBe(5);
});
it("an inactive synthetic pointer or an already removed element leaves teardown usable", () => {
  const throws = () => {
    throw new Error("inactive pointer");
  };
  const el = { setPointerCapture: throws, hasPointerCapture: throws } as unknown as Element;
  expect(() => capturePointer(el, 8)).not.toThrow();
  expect(() => releasePointer(el, 8)).not.toThrow();
  const captured = {
    hasPointerCapture: () => true,
    releasePointerCapture: throws,
  } as unknown as Element;
  expect(() => releasePointer(captured, 8)).not.toThrow();
});
