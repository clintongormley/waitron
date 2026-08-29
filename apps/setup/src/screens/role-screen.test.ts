import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./role-screen.js";
import type { SetupRoleScreen } from "./role-screen.js";

type Emitted = { kind: "role"; detail: unknown };

/** Collects the single composed event the screen emits UP; it bubbles+composes, so the host hears it. */
function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("setup-role", (e) =>
    events.push({ kind: "role", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupRoleScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(cleanupWidgets);

describe("setup-role-screen", () => {
  it("renders both role choices", async () => {
    const { el } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    expect(q(el, "[data-test=choose-primary]")).not.toBeNull();
    expect(q(el, "[data-test=choose-mirror]")).not.toBeNull();
  });

  it("emits role:primary on the primary choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-primary]")!.click();
    expect(events).toEqual([{ kind: "role", detail: { role: "primary" } }]);
  });

  it("emits role:mirror on the mirror choice", async () => {
    const { el, host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {});
    const events = collect(host);
    q(el, "[data-test=choose-mirror]")!.click();
    expect(events).toEqual([{ kind: "role", detail: { role: "mirror" } }]);
  });
});
