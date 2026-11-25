import { afterEach, expect, test, vi } from "vitest";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

test.each(["light", "dark"] as const)(
  "covers the viewport in danger colors (%s)",
  async (theme) => {
    const stop = await mountThemed(
      '<wt-stop-screen open heading="Disk full"><p>Tell a manager.</p></wt-stop-screen>',
      theme,
    );
    const modal = () => stop.shadowRoot?.querySelector<HTMLDialogElement>("dialog:modal");
    await vi.waitFor(() => expect(modal()).toBeTruthy());
    const dialog = modal()!;
    const danger = getComputedStyle(dialog).getPropertyValue("--wt-color-danger").trim();
    const control = document.createElement("div");
    control.style.backgroundColor = danger;
    stop.append(control);
    expect(getComputedStyle(dialog).backgroundColor).toBe(
      getComputedStyle(control).backgroundColor,
    );
    const box = dialog.getBoundingClientRect();
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, innerWidth, innerHeight]);
  },
);
