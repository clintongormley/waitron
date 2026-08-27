import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./admin-screen.js";
import type { SetupAdminScreen } from "./admin-screen.js";

type Emitted = { kind: "patch" | "goto"; detail: unknown };

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

const q = (el: SetupAdminScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** Types `value` into the wt-input at `[data-test=field]` by firing its composed `wt-change`. */
async function type(el: SetupAdminScreen, field: string, value: string): Promise<void> {
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("setup-admin-screen", () => {
  it("collects the three fields and advances to venue with the admin patch", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "Alba");
    await type(el, "password", "correct horse");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            venue: { admin: { displayName: "Alba", pin: "1234", password: "correct horse" } },
          },
        },
      },
      { kind: "goto", detail: { screen: "venue" } },
    ]);
  });

  // The non-empty guard. Prove-by-deletion: drop the `invalid.size > 0` return and this flips red —
  // a blank Next would then emit and advance.
  it("blocks Next and shows a banner when a field is blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "Alba");
    // password + pin left blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=error]")!.getAttribute("role")).toBe("alert");
    // The blank fields are marked invalid; the filled one is not.
    expect(q(el, "[data-test=password]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=pin]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=displayName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("treats whitespace-only fields as blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "   ");
    await type(el, "password", "pw");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=displayName]")!.hasAttribute("invalid")).toBe(true);
  });

  it("clears the banner once the fields are filled and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await type(el, "displayName", "Alba");
    await type(el, "password", "pw");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(events.some((e) => e.kind === "goto")).toBe(true);
  });

  it("steps back to mode without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "mode" } }]);
  });
});
