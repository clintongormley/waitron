import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./role-screen.js";
import type { SetupRoleScreen } from "./role-screen.js";

type Emitted = { kind: "goto"; detail: unknown };

/** Collects the composed navigation event the screen emits UP; it bubbles+composes to the host. */
function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-goto", (e) =>
    events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupRoleScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe("setup-role-screen", () => {
  it("renders both ways to join or recover an existing restaurant", async () => {
    const { el } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    expect(q(el, "[data-test=choose-mirror]")).not.toBeNull();
    expect(q(el, "[data-test=choose-restore]")).not.toBeNull();
  });

  it("navigates to connect on the mirror choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-mirror]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "connect" } }]);
  });

  it("navigates to restore on the backup choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-restore]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "restore" } }]);
  });
});
