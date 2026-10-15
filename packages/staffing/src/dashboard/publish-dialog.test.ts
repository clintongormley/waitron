import { afterEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { rotaWeek } from "../testing/rota-fixture.js";
import { PublishDialog } from "./publish-dialog.js";
let el: PublishDialog;
afterEach(() => el?.remove());
it("keeps the actual dialog open during publication and allows closing after the request", async () => {
  el = new PublishDialog();
  el.open = true;
  el.week = rotaWeek();
  el.busy = true;
  document.body.append(el);
  applyTokens(el);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  expect(await dialog.requestClose("escape")).toBe(false);
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  el.busy = false;
  await el.updateComplete;
  const close = vi.fn();
  el.addEventListener("back", close);
  const event = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  expect(await dialog.requestClose("escape")).toBe(true);
  await event;
  expect(close).toHaveBeenCalledTimes(1);
});

it("paints Back to the rota as a visible control", async () => {
  el = new PublishDialog();
  el.open = true;
  el.week = rotaWeek();
  document.body.append(el);
  applyTokens(el);
  await el.updateComplete;
  const back =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=back]")!;
  await back.updateComplete;
  await vi.waitFor(() =>
    expect(back.shadowRoot!.querySelector("button")!.getBoundingClientRect().width).toBeGreaterThan(
      0,
    ),
  );
});
