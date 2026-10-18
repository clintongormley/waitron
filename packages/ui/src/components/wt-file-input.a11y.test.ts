import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "../index.js";
import { setHelpMode } from "../help-mode.js";
afterEach(cleanup);
afterEach(() => setHelpMode(false));
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

  test("with a help-mode badge, help off", async () => {
    await mountThemed(
      '<wt-file-input name="photo" label="Photo"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Photo">Shown on the menu.</wt-help-tooltip></wt-file-input>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    await mountThemed(
      '<wt-file-input name="photo" label="Photo"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Photo">Shown on the menu.</wt-help-tooltip></wt-file-input>',
      theme,
    );
    const badge = host.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
