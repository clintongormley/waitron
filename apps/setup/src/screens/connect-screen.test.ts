import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";
import type { AdoptBody, PrimaryCertificate } from "../api/client.js";

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

/** The form's one message about a failed Connect, as `wt-form-actions` shows it. */
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

const CERT: PrimaryCertificate = {
  pem: "-----BEGIN CERTIFICATE-----\nAUTHORITY-X\n-----END CERTIFICATE-----\n",
  fingerprint256:
    "3F:A1:9C:0B:7E:22:D4:51:88:6A:E0:13:BC:47:F9:2D:65:0E:A8:31:DC:74:5B:96:C2:0F:E7:38:41:AD:9B:16",
};

/** A request the shell hands back: one the person already compared. */
const REQUEST: AdoptBody = {
  primaryUrl: "https://primary.example",
  credential: { personId: "op-7", password: " secret " },
  confirmedCaPem: CERT.pem,
};

function stubApi(answer: PrimaryCertificate | null = CERT) {
  return { primaryCertificate: vi.fn().mockResolvedValue(answer) };
}

function mount(props: Partial<SetupConnectScreen> = {}) {
  return mountWidget<SetupConnectScreen>("setup-connect-screen", { api: stubApi(), ...props });
}

const pressed = async (el: SetupConnectScreen, button: string): Promise<void> => {
  q(el, `[data-test=${button}]`)!.click();
  await el.updateComplete;
};

/** The address step's Continue, then the compare step's "It matches" when it is shown. */
async function toLogin(el: SetupConnectScreen, address = VALID.primaryUrl): Promise<void> {
  await type(el, "primaryUrl", address);
  await pressed(el, "continue");
  await vi.waitFor(() =>
    expect(q(el, "[data-test=matches]") ?? q(el, "[data-test=personId]")).not.toBeNull(),
  );
  if (q(el, "[data-test=matches]") !== null) await pressed(el, "matches");
}

async function fillValid(
  el: SetupConnectScreen,
  overrides: Record<string, string> = {},
): Promise<void> {
  const { primaryUrl, ...login } = { ...VALID, ...overrides };
  if (q(el, "[data-test=continue]") !== null) await toLogin(el, primaryUrl);
  for (const [key, value] of Object.entries(login)) {
    await type(el, key, value);
  }
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("setup-connect-screen", () => {
  it("assembles the adopt body as a STRUCTURED credential object and emits adopt-requested", async () => {
    const { el, host } = await mount();
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
            confirmedCaPem: CERT.pem,
          },
        },
      },
    ]);
  });

  it("carries a filled TOTP into the credential object", async () => {
    const { el, host } = await mount();
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
    const { el, host } = await mount();
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
      confirmedCaPem: CERT.pem,
    });
  });

  it("connects when Enter is pressed in a field", async () => {
    const { el, host } = await mount();
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
            confirmedCaPem: CERT.pem,
          },
        },
      },
    ]);
  });

  it("renders the password field as a password input (never a plaintext one)", async () => {
    const { el } = await mount();
    await toLogin(el);
    expect(q(el, "[data-test=password]")!.getAttribute("type")).toBe("password");
  });

  it("blocks Continue and marks primaryUrl invalid when it is blank, reading nothing", async () => {
    const api = stubApi();
    const { el, host } = await mount({ api });
    const events = collect(host);
    await type(el, "primaryUrl", "   ");
    await pressed(el, "continue");
    expect(events).toEqual([]);
    expect(api.primaryCertificate).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=continue]")!.hasAttribute("disabled")).toBe(true);
  });

  it.each(["personId", "password"])(
    "blocks Connect and marks %s invalid when it is blank, emitting nothing",
    async (field) => {
      const { el, host } = await mount();
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
    const { el, host } = await mount();
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(await bottomOf(el)).toBe("");
  });

  it("shows a routed-back server error above Connect as one alert, leaving Connect working", async () => {
    const { el } = await mount({
      errorMessage: "Couldn't reach the primary server.",
      request: REQUEST,
    });
    expect(await bottomOf(el)).toBe("Couldn't reach the primary server.");
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.shadowRoot!.querySelector("[data-error]")!.getAttribute("role")).toBe("alert");
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(false);
  });

  it.each([1280, 390])(
    "puts a routed-back server error on its own line at the form's left edge, between the last field and the buttons (%ipx)",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const { el } = await mount({
          errorMessage: "Couldn't reach the primary server.",
          request: REQUEST,
        });
        const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
        await actions.updateComplete;
        const message = actions.shadowRoot!.querySelector("[data-error]")!;
        const lastField = q(el, "[data-test=totp]")!.getBoundingClientRect();
        const box = message.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(lastField.bottom);
        for (const button of ["back", "connect"]) {
          expect(box.bottom).toBeLessThanOrEqual(
            q(el, `[data-test=${button}]`)!.getBoundingClientRect().top,
          );
        }
        expect(box.left).toBeCloseTo(lastField.left, 0);
        expect(box.right).toBeCloseTo(lastField.right, 0);
        expect(getComputedStyle(message).textAlign).toBe("start");
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  it("shows a request refusal of one field under that field and focuses it, leaving Continue working", async () => {
    const { el } = await mount({ invalidField: "primaryUrl" });
    await new Promise((resolve) => setTimeout(resolve));
    const url = q(el, "[data-test=primaryUrl]")!;
    expect(url.hasAttribute("invalid")).toBe(true);
    expect(url.getAttribute("error")).toBe("Check the primary server address.");
    expect(url.shadowRoot!.activeElement).toBe(url.shadowRoot!.querySelector("input"));
    expect(q(el, "[data-test=personId]")).toBeNull();
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await alerts(el)).toHaveLength(1);
    expect((q(el, "[data-test=continue]") as HTMLElement & { disabled: boolean }).disabled).toBe(
      false,
    );

    await type(el, "primaryUrl", "https://primary.example");
    expect(url.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe("");
  });

  it("fills every field from a request the shell hands back that carries no one-time code", async () => {
    const { el, host } = await mount({ request: REQUEST });
    const events = collect(host);
    const value = (field: string) =>
      (q(el, `[data-test=${field}]`) as HTMLElement & { value: string }).value;
    expect([value("primaryUrl"), value("personId"), value("password"), value("totp")]).toEqual([
      "https://primary.example",
      "op-7",
      " secret ",
      "",
    ]);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(events).toEqual([
      {
        kind: "adopt",
        detail: {
          body: {
            primaryUrl: "https://primary.example",
            credential: { personId: "op-7", password: " secret " },
            confirmedCaPem: CERT.pem,
          },
        },
      },
    ]);
  });

  it("leaves the one-time code blank when the request the shell hands back carries one", async () => {
    const { el } = await mount({
      request: {
        ...REQUEST,
        credential: { personId: "op-7", password: " secret ", totp: "123456" },
      },
    });
    const value = (field: string) =>
      (q(el, `[data-test=${field}]`) as HTMLElement & { value: string }).value;
    expect([value("primaryUrl"), value("personId"), value("password"), value("totp")]).toEqual([
      "https://primary.example",
      "op-7",
      " secret ",
      "",
    ]);
  });

  it("drops a field refusal on the next press and sends the form", async () => {
    const { el, host } = await mount({ invalidField: "totp", request: REQUEST });
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
    const { el } = await mount({
      errorMessage: "Couldn't reach the primary server.",
      request: REQUEST,
    });
    await type(el, "personId", "");
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await alerts(el)).toHaveLength(1);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("clears the client message once the form is valid and Connect succeeds", async () => {
    const { el, host } = await mount();
    const events = collect(host);
    await toLogin(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await fillValid(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    expect(events).toHaveLength(1);
  });

  it("says nothing and leaves Continue working before the first press", async () => {
    const { el } = await mount();
    await type(el, "primaryUrl", "");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=continue]")!.hasAttribute("disabled")).toBe(false);
  });

  it("on a failed press marks each blank field, focuses the first and disables Connect", async () => {
    const { el } = await mount();
    await toLogin(el, "https://waitron.local");
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
    const { el, host } = await mount();
    const events = collect(host);
    await pressed(el, "continue");

    await type(el, "primaryUrl", " ");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe(
      "Check the primary server address.",
    );

    await type(el, "primaryUrl", "https://waitron.local");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=continue]")!.hasAttribute("disabled")).toBe(false);

    await toLogin(el);
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(true);

    await fillValid(el);
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=connect]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=connect]")!.click();
    expect(events).toHaveLength(1);
  });

  it("steps back to the role screen without emitting an adopt", async () => {
    const { el, host } = await mount();
    const events: { kind: string; detail: unknown }[] = [];
    host.addEventListener("setup-goto", (e) =>
      events.push({ kind: "goto", detail: (e as CustomEvent).detail }),
    );
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "role" } }]);
  });
});

describe("setup-connect-screen: comparing the primary server's fingerprint", () => {
  const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();

  it("asks the person to compare the fingerprint before the password is sent", async () => {
    const api = stubApi();
    const { el, host } = await mount({ api });
    const events = collect(host);
    expect(q(el, "[data-test=password]")).toBeNull();
    expect(q(el, "[data-test=personId]")).toBeNull();

    await type(el, "primaryUrl", "  https://waitron.local  ");
    await pressed(el, "continue");
    await vi.waitFor(() => expect(q(el, "[data-test=fingerprint]")).not.toBeNull());
    expect(api.primaryCertificate).toHaveBeenCalledExactlyOnceWith("https://waitron.local");
    expect(text(q(el, "[data-test=fingerprint]")!)).toBe(CERT.fingerprint256);
    expect(text(q(el, "[data-test=compare]")!)).toContain("Servers screen");
    expect(q(el, "[data-test=password]")).toBeNull();
    expect(q(el, "[data-test=connect]")).toBeNull();
    expect(events).toEqual([]);

    await pressed(el, "matches");
    expect(q(el, "[data-test=fingerprint]")).toBeNull();
    expect(q(el, "[data-test=primaryUrl]")!.hasAttribute("readonly")).toBe(true);
    await type(el, "personId", "op-1");
    await type(el, "password", "correct horse");
    await pressed(el, "connect");
    expect(events).toEqual([
      {
        kind: "adopt",
        detail: {
          body: {
            primaryUrl: "https://waitron.local",
            credential: { personId: "op-1", password: "correct horse" },
            confirmedCaPem: CERT.pem,
          },
        },
      },
    ]);
  });

  it("stops when the fingerprint does not match, sending nothing, and lets the person check the address", async () => {
    const api = stubApi();
    const { el, host } = await mount({ api });
    const events = collect(host);
    await type(el, "primaryUrl", "https://waitron.local");
    await pressed(el, "continue");
    await vi.waitFor(() => expect(q(el, "[data-test=mismatch]")).not.toBeNull());
    await pressed(el, "mismatch");

    expect(text(q(el, "[data-test=stopped]")!)).toBe(
      "The fingerprints don't match, so this may not be your primary server. Nothing was sent to it. Check the address and compare again, or go back.",
    );
    expect(q(el, "[data-test=password]")).toBeNull();
    expect(q(el, "[data-test=fingerprint]")).toBeNull();
    expect(events).toEqual([]);

    await pressed(el, "check-address");
    const url = q(el, "[data-test=primaryUrl]") as HTMLElement & { value: string };
    expect(url.value).toBe("https://waitron.local");
    expect(url.hasAttribute("readonly")).toBe(false);
    await type(el, "primaryUrl", "https://waitron-main.local");
    await pressed(el, "continue");
    await vi.waitFor(() => expect(api.primaryCertificate).toHaveBeenCalledTimes(2));
    expect(api.primaryCertificate).toHaveBeenLastCalledWith("https://waitron-main.local");
  });

  it("goes straight to the login step for a plain-http address, sending no certificate", async () => {
    const { el, host } = await mount({ api: stubApi(null) });
    const events = collect(host);
    await type(el, "primaryUrl", "http://127.0.0.1:8080");
    await pressed(el, "continue");
    await vi.waitFor(() => expect(q(el, "[data-test=personId]")).not.toBeNull());
    expect(q(el, "[data-test=fingerprint]")).toBeNull();
    await fillValid(el);
    await pressed(el, "connect");
    expect((events[0]!.detail as { body: AdoptBody }).body).toEqual({
      primaryUrl: "http://127.0.0.1:8080",
      credential: { personId: "op-1", password: "correct horse" },
    });
  });

  it("reads the certificate once while a read is under way", async () => {
    let answer!: (value: PrimaryCertificate) => void;
    const api = {
      primaryCertificate: vi.fn(
        () =>
          new Promise<PrimaryCertificate>((resolve) => {
            answer = resolve;
          }),
      ),
    };
    const { el } = await mount({ api });
    await type(el, "primaryUrl", "https://waitron.local");
    await pressed(el, "continue");
    await pressed(el, "continue");
    expect(api.primaryCertificate).toHaveBeenCalledOnce();
    answer(CERT);
    await vi.waitFor(() => expect(q(el, "[data-test=fingerprint]")).not.toBeNull());
  });

  it.each([
    [
      { code: "mirror.bundle_fetch_failed", params: {}, status: 502 },
      "Couldn't read the primary server's certificate. Check the address and that the primary server is on, then try again.",
    ],
    [
      new TypeError("network"),
      "Couldn't read the primary server's certificate. Check the address and that the primary server is on, then try again.",
    ],
  ])("says a failed certificate read %o stops on the address step", async (refusal, sentence) => {
    const api = { primaryCertificate: vi.fn().mockRejectedValue(refusal) };
    const { el } = await mount({ api });
    await type(el, "primaryUrl", "https://waitron.local");
    await pressed(el, "continue");
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(sentence));
    expect(q(el, "[data-test=personId]")).toBeNull();
    expect(q(el, "[data-test=continue]")!.hasAttribute("disabled")).toBe(false);
  });

  it.each([
    [{ code: "mirror.primary_url_invalid", params: {}, status: 400 }],
    [{ code: "setup.request_invalid", params: { field: "primaryUrl" }, status: 400 }],
  ])("marks the address when the certificate read refuses it (%o)", async (refusal) => {
    const api = { primaryCertificate: vi.fn().mockRejectedValue(refusal) };
    const { el } = await mount({ api });
    await type(el, "primaryUrl", "ftp://waitron.local");
    await pressed(el, "continue");
    const url = q(el, "[data-test=primaryUrl]")!;
    await vi.waitFor(() =>
      expect(url.getAttribute("error")).toBe("Check the primary server address."),
    );
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  });

  it("opens the address step for a handed-back https request that carries no confirmed certificate", async () => {
    const { el } = await mount({
      request: { primaryUrl: "https://primary.example", credential: REQUEST.credential },
      errorMessage: "Compare the certificate first.",
    });
    expect(q(el, "[data-test=personId]")).toBeNull();
    expect((q(el, "[data-test=primaryUrl]") as HTMLElement & { value: string }).value).toBe(
      "https://primary.example",
    );
    expect(await bottomOf(el)).toBe("Compare the certificate first.");
  });

  it("opens the login step for a handed-back plain-http request", async () => {
    const { el } = await mount({
      request: { primaryUrl: "http://127.0.0.1:8080", credential: REQUEST.credential },
    });
    expect(q(el, "[data-test=personId]")).not.toBeNull();
  });

  it("asks for the comparison in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    await type(el, "primaryUrl", "https://waitron.local");
    expect(text(q(el, "[data-test=continue]")!)).toBe("Continuar");
    await pressed(el, "continue");
    await vi.waitFor(() => expect(q(el, "[data-test=fingerprint]")).not.toBeNull());
    expect(text(q(el, "[data-test=compare]")!)).toBe(
      "En un dispositivo ya vinculado a tu servidor principal, abre la pantalla Servidores del panel. Su huella del certificado público debe coincidir con esta.",
    );
    expect(text(q(el, "[data-test=matches]")!)).toBe("Coincide");
    expect(text(q(el, "[data-test=mismatch]")!)).toBe("No coincide");
    await pressed(el, "mismatch");
    expect(text(q(el, "[data-test=stopped]")!)).toBe(
      "Las huellas no coinciden, así que puede que este no sea tu servidor principal. No se le ha enviado nada. Revisa la dirección y vuelve a comparar, o vuelve atrás.",
    );
    expect(text(q(el, "[data-test=check-address]")!)).toBe("Revisar la dirección");
  });
});

describe("setup-connect-screen in Spanish", () => {
  const text = (node: Element): string => node.textContent!.replace(/\s+/g, " ").trim();

  it("labels the form and explains a blank field in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    expect(text(q(el, "h1")!)).toBe("Conectar con el servidor principal");
    expect(q(el, "[data-test=primaryUrl]")!.getAttribute("label")).toBe(
      "Dirección del servidor principal",
    );
    await fillValid(el, { personId: "" });
    expect(text(q(el, "[data-test=connect]")!)).toBe("Conectar");
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe(
      "Revisa el usuario administrador (ID de persona).",
    );
  });

  it("switches language while mounted and keeps what was typed", async () => {
    const { el } = await mount();
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
