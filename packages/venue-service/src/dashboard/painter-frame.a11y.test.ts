import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PainterFrame } from "./painter-frame.js";
import "./painter-frame.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("painter frame (%s)", (theme) => {
  test.each(["clean", "dirty", "refused", "saving", "read-only"])("%s", async (state) => {
    await mountThemed(
      `<painter-frame heading="Winter week">
        <span slot="picker">Winter · 1 Dec – 28 Feb</span>
        <a slot="link" href="#periods">Periods</a>
        <div slot="row">Paint</div>
        <div>Grid</div>
      </painter-frame>`,
      theme,
    );
    const frame = host.querySelector<PainterFrame>("painter-frame")!;
    frame.scope = { id: {} };
    frame.dirty = state !== "clean";
    frame.busy = state === "saving";
    frame.readOnly = state === "read-only";
    if (state === "refused") frame.refusal = "The change could not be saved.";
    frame.open = true;
    await frame.updateComplete;
    await expectNoA11yViolations(host);
  });
});
