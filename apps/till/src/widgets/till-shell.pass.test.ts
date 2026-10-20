import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { TillShell } from "./till-shell.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
it("A738 the native till Pass action emits one composed event to its parent", async () => {
  const { el, host } = await mountWidget<TillShell>("till-shell", {
    formFactor: "till",
    affordances: ["expo"],
  });
  const seen: unknown[] = [];
  host.addEventListener("show-expo", (event) =>
    seen.push({ target: event.target, bubbles: event.bubbles, composed: event.composed }),
  );
  expect(el.shadowRoot!.querySelectorAll(".expo")).toHaveLength(1);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".till-strip .expo")!);
  expect(seen).toEqual([{ target: el, bubbles: true, composed: true }]);
});
