import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./image-upload.js";
import type { ImageUpload } from "./image-upload.js";
import type { DashboardApi } from "../api/client.js";

function stubApi(): DashboardApi {
  return {
    imageLibraryRequest: vi.fn().mockResolvedValue({ image: "abc.png" }),
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
