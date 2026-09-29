import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
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

/** The one message beside Connect, as `wt-form-actions` shows it. */
async function bottomOf(el: SetupConnectScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

/** Every alert in the screen and in its action row. */
async function alerts(el: SetupConnectScreen): Promise<Element[]> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return [
    ...el.shadowRoot!.querySelectorAll("[role=alert]"),
    ...actions.shadowRoot!.querySelectorAll("[role=alert]"),
  ];
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

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

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

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
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(await alerts(el)).toHaveLength(1);
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
    expect(await bottomOf(el)).toBe("");
  });

  it("shows a routed-back server error beside Connect as one alert, leaving Connect working", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      errorMessage: "Couldn't reach the primary server.",
    });
    expect(await bottomOf(el)).toBe("Couldn't reach the primary server.");
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.shadowRoot!.querySelector("[data-error]")!.getAttribute("role")).toBe("alert");
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(false);
  });

  it("shows a request refusal of one field under that field and focuses it, leaving Connect working", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      invalidField: "primaryUrl",
    });
    await new Promise((resolve) => setTimeout(resolve));
    const url = q(el, "[data-test=primaryUrl]")!;
    expect(url.hasAttribute("invalid")).toBe(true);
    expect(url.getAttribute("error")).toBe("Check the primary server address.");
    expect(url.shadowRoot!.activeElement).toBe(url.shadowRoot!.querySelector("input"));
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await alerts(el)).toHaveLength(1);
    expect((q(el, "[data-test=connect]") as HTMLElement & { disabled: boolean }).disabled).toBe(
      false,
    );

    await type(el, "primaryUrl", "https://primary.example");
    expect(url.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe("");
  });

  it("drops a field refusal on the next press and sends the form", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      invalidField: "totp",
    });
    const events = collect(host);
    await fillValid(el);
    expect(q(el, "[data-test=totp]")!.hasAttribute("invalid")).toBe(true);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(q(el, "[data-test=totp]")!.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe("");
  });

  it("renders exactly one role=alert (the client message) when a server error and a client error coincide", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {
      errorMessage: "Couldn't reach the primary server.",
    });
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await alerts(el)).toHaveLength(1);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("clears the client message once the form is valid and Connect succeeds", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    expect(events).toHaveLength(1);
  });

  it("says nothing and leaves Connect working before the first press", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    await type(el, "primaryUrl", "");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(false);
  });

  it("on a failed press marks each blank field, focuses the first and disables Connect", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    await type(el, "primaryUrl", "https://waitron.local");
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe(
      "Check the admin login (person id).",
    );
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("Check the admin password.");
    expect(q(el, "[data-test=totp]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    const personId = q(el, "[data-test=personId]")!;
    expect(personId.shadowRoot!.activeElement).toBe(personId.shadowRoot!.querySelector("input"));
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(true);
  });

  it("re-checks each change after a failed press, and Connect works again once every field is fixed", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    const events = collect(host);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;

    await type(el, "primaryUrl", "https://waitron.local");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(true);

    await type(el, "primaryUrl", " ");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe(
      "Check the primary server address.",
    );

    await fillValid(el);
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=connect]")!.click();
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

describe("setup-connect-screen in Spanish", () => {
  const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();

  it("labels the form and explains a blank field in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    expect(text(q(el, "h1")!)).toBe("Conectar con el servidor principal");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("label")).toBe(
      "Dirección del servidor principal",
    );
    expect(text(q(el, "[data-test=connect]")!)).toBe("Conectar");
    await fillValid(el, { personId: "" });
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe(
      "Revisa el usuario administrador (ID de persona).",
    );
  });

  it("switches language while mounted and keeps what was typed", async () => {
    const { el } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {});
    await type(el, "primaryUrl", "https://waitron.local");
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "h1")!)).toBe("Conectar con el servidor principal");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("label")).toBe(
      "Dirección del servidor principal",
    );
    expect((q(el, "[data-test=primaryUrl]") as HTMLElement & { value: string }).value).toBe(
      "https://waitron.local",
    );
  });
});
