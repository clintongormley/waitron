import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./image-upload.js";
import type { ImageUpload } from "./image-upload.js";
import type { DashboardApi } from "../api/client.js";

/**
 * Mounted with a stub `api` and a PRE-SET `image` so axe sees the full surface — the labelled file
 * input AND the preview `<img>` (which must carry `alt`) — in BOTH themes, against the themed host so
 * a color-contrast check means what it means in the app. The upload path is never driven here (the
 * behaviour suite covers it); the a11y contract is that the input is labelled and the preview has alt.
 */
function stubApi(): DashboardApi {
  return {
    uploadImage: vi.fn().mockResolvedValue({ image: "abc.png" }),
  } as unknown as DashboardApi;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("image-upload a11y (%s theme)", (theme) => {
  it("renders accessibly with a preview", async () => {
    const { host } = await mountWidget<ImageUpload>(
      "dashboard-image-upload",
      { api: stubApi(), image: "abc.png" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
