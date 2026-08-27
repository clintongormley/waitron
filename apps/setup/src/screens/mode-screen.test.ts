import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./mode-screen.js";
import type { SetupModeScreen } from "./mode-screen.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

/** Collects the two composed events the screen emits UP; both bubble+compose, so the host hears them. */
function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-patch", (e) =>
    events.push({ kind: "patch", detail: (e as CustomEvent).detail }),
  );
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupModeScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe("setup-mode-screen", () => {
  it("advances to admin with mode:demo on the demo choice", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-demo]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "demo" } } },
      { kind: "goto", detail: { screen: "admin" } },
    ]);
  });

  // The live gate. Prove-by-deletion: rewire the LIVE button to `#advance("live")` and this flips red
  // — a single click would then emit `mode:live`. Today it only reveals the permanence warning.
  it("does NOT provision live on a single click — it shows the permanence warning instead", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=live-warning]")).not.toBeNull();
    // The two choices are gone; the confirm gate has replaced them.
    expect(q(el, "[data-test=choose-demo]")).toBeNull();
  });

  it("still does not emit when confirm is clicked before 'I understand' is on", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    const events = collect(host);
    // Clicking the host directly bypasses the inner disabled <button>, exercising the method guard.
    q(el, "[data-test=confirm-live]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
  });

  it("provisions live only after 'I understand' is switched on and confirm is clicked", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    const events = collect(host);
    q(el, "[data-test=understand]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    q(el, "[data-test=confirm-live]")!.click();
    expect(events).toEqual([
      { kind: "patch", detail: { patch: { mode: "live" } } },
      { kind: "goto", detail: { screen: "admin" } },
    ]);
  });

  it("cancels the live confirm back to the two choices", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    // Turn the switch on, then cancel — cancelling must also reset the switch for the next attempt.
    q(el, "[data-test=understand]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    q(el, "[data-test=live-cancel]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=choose-demo]")).not.toBeNull();
    expect(q(el, "[data-test=live-warning]")).toBeNull();
    // Re-opening the gate: the switch is back off, so confirm is blocked again.
    q(el, "[data-test=choose-live]")!.click();
    await el.updateComplete;
    expect((el as unknown as { understood: boolean }).understood).toBe(false);
  });

  it("surfaces the box environment and calls out a production box loudly", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "production",
    });
    expect(q(el, "[data-test=environment]")?.textContent).toBe("production");
    expect(q(el, "[data-test=production-warning]")).not.toBeNull();
  });

  it("shows no production warning for a preproduction box", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {
      environment: "preproduction",
    });
    expect(q(el, "[data-test=environment]")?.textContent).toBe("preproduction");
    expect(q(el, "[data-test=production-warning]")).toBeNull();
  });

  it("shows no environment line before the shell has read the status", async () => {
    const { el } = await mountWidget<SetupModeScreen>("setup-mode-screen", {});
    expect(q(el, "[data-test=environment]")).toBeNull();
  });
});
