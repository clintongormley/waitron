import { afterEach, describe, expect, test } from "vitest";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RotaPopup } from "./rota-popup.js";
import "./rota-popup.js";

afterEach(() => cleanup());

describe.each(["light", "dark"] as const)("rota-popup accessibility (%s)", (theme) => {
  test.each(["open beside", "open with a list of buttons", "sheet"])("%s", async (state) => {
    const el = (await mountThemed(
      `<div><button>+ unfilled</button><rota-popup heading="Fri 4 Dec · Sous chef · 09:00–17:00"></rota-popup></div>`,
      theme,
    )) as HTMLElement;
    const popup = el.querySelector<RotaPopup>("rota-popup")!;
    popup.innerHTML =
      state === "open beside"
        ? `<p>Fri 4 Dec · Sous chef · 09:00–17:00</p>`
        : state === "sheet"
          ? `<p>Fri 4 Dec · Sous chef · 09:00–17:00</p><ul><li><button>Ana · free · 32.5 / 40 h</button></li></ul><button>Cancel</button>`
          : `<ul><li><button>Ana · free · 32.5 / 40 h</button></li><li><button>Joan · working · 41 / 40 h</button></li><li><button>Show everyone</button></li></ul>`;
    popup.sheet = state === "sheet";
    await popup.updateComplete;
    popup.show(el.querySelector("button")!);
    expect(popup.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(el);
  });
});
