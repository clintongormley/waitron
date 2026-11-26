import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cameraFilming } from "../../test/qr-camera.js";
import "../index.js";
import type { WtQrScanner } from "./wt-qr-scanner.js";

let filming: { stop: () => void } | undefined;

afterEach(() => {
  cleanup();
  filming?.stop();
  filming = undefined;
  vi.restoreAllMocks();
});

const SCANNER =
  '<wt-qr-scanner label="Camera" hint="Hold the code up to the camera" unavailable="The camera did not start"></wt-qr-scanner>';

describe.each(["light", "dark"] as const)("QR scanner accessibility (%s)", (theme) => {
  test.each(["filming", "message", "unavailable"] as const)("%s", async (state) => {
    if (state === "unavailable") {
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
        new DOMException("Permission denied", "NotAllowedError"),
      );
    } else {
      const camera = cameraFilming("hello");
      filming = camera;
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
    }
    const el = (await mountThemed(SCANNER, theme)) as WtQrScanner;
    const message = () =>
      el.shadowRoot!.querySelector("[data-scanner-message]")?.textContent?.trim();
    if (state === "unavailable") {
      await expect.poll(message).toBe("The camera did not start");
    } else {
      await expect.poll(() => el.shadowRoot!.querySelector("video")).not.toBeNull();
      if (state === "message") {
        el.message = "That is not the code";
        await el.updateComplete;
        expect(message()).toBe("That is not the code");
      }
    }
    await expectNoA11yViolations(host);
  });
});
