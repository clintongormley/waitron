import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "../index.js";
afterEach(cleanup);
describe.each(["light", "dark"] as const)("file field accessibility (%s)", (theme) => {
  test.each([
    "empty",
    "selected",
    "required",
    "invalid",
    "disabled",
    "multiple",
    "compact",
    "dragging",
    "focused",
  ])("%s", async (state) => {
    const el = await mountThemed(
      `<wt-file-input name="photo" label="Photo" hint="JPEG, PNG or WebP" ${state === "required" ? "required" : state === "disabled" ? "disabled" : state === "multiple" ? "multiple" : state === "compact" ? "compact" : ""}></wt-file-input>`,
      theme,
    );
    expect(el.shadowRoot?.querySelector("input")).toBeInstanceOf(HTMLInputElement);
    if (state === "invalid") Object.assign(el, { error: "Choose a photo." });
    if (state === "selected")
      Object.assign(el, { files: [new File(["image"], "bread.png", { type: "image/png" })] });
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    if (state === "dragging") {
      const data = new DataTransfer();
      data.items.add(new File(["image"], "bread.png", { type: "image/png" }));
      el.shadowRoot!.querySelector("input")!.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer: data }),
      );
      await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    }
    if (state === "focused") el.focus();
    await expectNoA11yViolations(host);
  });
});
