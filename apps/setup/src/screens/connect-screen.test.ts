import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";

type Emitted = { kind: "adopt"; detail: unknown };

function collect(host: HTMLElement): Emitted[] {
  const events: Emitted[] = [];
  host.addEventListener("adopt-requested", (e) =>
    events.push({ kind: "adopt", detail: (e as CustomEvent).detail }),
  );
  return events;
}

const q = (el: SetupConnectScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

async function type(el: SetupConnectScreen, field: string, value: string): Promise<void> {
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

const VALID: Record<string, string> = {
  primaryUrl: "https://waitron.local",
  personId: "op-1",
  password: "correct horse",
};

async function fillValid(
  el: SetupConnectScreen,
  overrides: Record<string, string> = {},
): Promise<void> {
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) {
    await type(el, key, value);
  }
}

afterEach(cleanupWidgets);

describe("setup-connect-screen", () => {
  it("assembles the adopt body as a STRUCTURED credential object and emits adopt-requested", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    expect(events).toEqual([
      {
        kind: "adopt",
        detail: {
          body: {
            primaryUrl: "https://waitron.local",
            credential: { personId: "op-1", password: "correct horse" },
          },
        },
      },
    ]);
  });

  it("carries a filled TOTP into the credential object", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    await fillValid(el, { totp: "123456" });
    q(el, "[data-test=connect]")!.click();
    const body = (events[0].detail as { body: { credential: Record<string, unknown> } }).body;
    expect(body.credential).toEqual({
      personId: "op-1",
      password: "correct horse",
      totp: "123456",
    });
  });

  it("trims whitespace on primaryUrl/personId/totp but leaves the password verbatim", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    await fillValid(el, {
      primaryUrl: "  https://waitron.local  ",
      personId: "  op-1  ",
      password: "  correct horse  ",
      totp: "  123456  ",
    });
    q(el, "[data-test=connect]")!.click();
    expect((events[0].detail as { body: unknown }).body).toEqual({
      primaryUrl: "https://waitron.local",
      credential: { personId: "op-1", password: "  correct horse  ", totp: "123456" },
    });
  });

  it("connects when Enter is pressed in a field", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=password]")!.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(events).toEqual([
      {
        kind: "adopt",
        detail: {
          body: {
            primaryUrl: "https://waitron.local",
            credential: { personId: "op-1", password: "correct horse" },
          },
        },
      },
    ]);
  });

  it("renders the password field as a password input (never a plaintext one)", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    expect(q(el, "[data-test=password]")!.getAttribute("type")).toBe("password");
  });

  it.each(["primaryUrl", "personId", "password"])(
    "blocks Connect and marks %s invalid when it is blank, emitting nothing",
    async (field) => {
      const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
      const events = collect(host);
      await fillValid(el, { [field]: "   " }); // whitespace-only required field
      q(el, "[data-test=connect]")!.click();
      await el.updateComplete;
      expect(events).toEqual([]);
      expect(q(el, "[data-test=error]")).not.toBeNull();
      const summary = el.shadowRoot!.querySelector("wt-form-error-summary") as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await summary.updateComplete;
      expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
      expect(q(el, `[data-test=${field}]`)!.hasAttribute("invalid")).toBe(true);
    },
  );

  it("allows a blank TOTP — it is optional and does not block Connect", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(q(el, "[data-test=error]")).toBeNull();
  });

  it("renders a routed-back server error banner when errorMessage is set (no client banner yet)", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      errorMessage: "Couldn't reach the primary server.",
    });
    const banner = q(el, "[data-test=server-error]")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("reach the primary");
    expect(q(el, "[data-test=error]")).toBeNull();
  });

  it("renders exactly one role=alert (the client message) when a server error and a client error coincide", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      errorMessage: "Couldn't reach the primary server.",
    });
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    const summary = el.shadowRoot!.querySelector("wt-form-error-summary") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await summary.updateComplete;
    const alerts = [
      ...el.shadowRoot!.querySelectorAll("[role=alert]"),
      ...summary.shadowRoot!.querySelectorAll("[role=alert]"),
    ];
    expect(alerts.length).toBe(1);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=server-error]")).toBeNull();
  });

  it("clears the client banner once the form is valid and Connect succeeds", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
    expect(events).toHaveLength(1);
  });

  it("steps back to the role screen without emitting an adopt", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events: { kind: string; detail: unknown }[] = [];
    host.addEventListener("setup-goto", (e) =>
      events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
    );
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "role" } }]);
  });
});
