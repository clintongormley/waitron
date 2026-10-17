import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import "./photo-framing-dialog.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  cleanup();
  setLocale(locale);
  vi.restoreAllMocks();
});
describe.each(["light", "dark"] as const)("photo framing accessibility (%s)", (theme) => {
  it.each(["default", "changed", "focus", "drag", "loading", "failure", "maximum"])(
    "%s",
    async (state) => {
      await mountThemed("<div></div>", theme);
      const c = document.createElement("canvas");
      c.width = 80;
      c.height = 160;
      c.getContext("2d")!.fillStyle = "green";
      c.getContext("2d")!.fillRect(0, 0, 80, 160);
      if (state === "loading") {
        const NativeImage = Image;
        vi.spyOn(window, "Image").mockImplementation(function () {
          const image = new NativeImage();
          Object.defineProperty(image, "src", { set() {} });
          return image;
        });
      }
      const el = document.createElement("media-photo-framing-dialog");
      el.source = state === "failure" ? "data:image/png;base64,invalid" : c.toDataURL();
      el.framing =
        state === "changed"
          ? { x: 3000, y: 7000, zoom: 200 }
          : { x: 5000, y: 5000, zoom: state === "maximum" ? 400 : 100 };
      host.append(el);
      await el.updateComplete;
      await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
      if (state === "failure")
        await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
      else if (state !== "loading")
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector("wt-slider")!.disabled).toBe(false),
        );
      const frame = el.shadowRoot!.querySelector<HTMLElement>("[data-test=frame]")!;
      if (state === "focus") frame.focus();
      if (state === "drag") {
        vi.spyOn(frame, "setPointerCapture").mockImplementation(() => {});
        frame.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0 }));
        await el.updateComplete;
      }
      el.style.setProperty("--wt-color-border", "rgb(19, 31, 47)");
      expect(getComputedStyle(frame).borderTopColor).toBe("rgb(19, 31, 47)");
      const done = el.shadowRoot!.querySelector("[data-test=done]")!;
      expect(done.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(
        el.shadowRoot!.querySelector("[data-test=reset]")!.getBoundingClientRect().width,
      ).toBeGreaterThan(0);
      await expectNoA11yViolations(host);
    },
  );
});
