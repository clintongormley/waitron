import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./email-screen.js";
import type { SetupEmailScreen } from "./email-screen.js";
import type { EmailSettingsDraft } from "../api/client.js";

const email: EmailSettingsDraft = {
  server: "smtp.example.com",
  port: 587,
  encryption: "starttls",
  user: "venue",
  password: "secret",
  from: "invoices@example.com",
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(runEmailTest = vi.fn().mockResolvedValue({ accepted: true })) {
  return {
    ...(await mountWidget<SetupEmailScreen>("setup-email-screen", {
      email,
      adminEmail: "admin@example.com",
      api: { runEmailTest },
    })),
    runEmailTest,
  };
}
function button(el: SetupEmailScreen, name: string) {
  return el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${name}]`)!;
}
async function change(el: SetupEmailScreen, field: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function test(el: SetupEmailScreen) {
  button(el, "test").click();
  await vi.waitFor(() => expect(button(el, "test").disabled).toBe(false));
  await el.updateComplete;
}

describe("wizard Email step", () => {
  it("requires an accepted test of the current settings before continuing", async () => {
    const { el, host, runEmailTest } = await mount();
    const patch = vi.fn(),
      goto = vi.fn();
    host.addEventListener("setup-patch", patch);
    host.addEventListener("setup-goto", goto);
    expect(button(el, "next").disabled).toBe(true);
    button(el, "next").click();
    expect(goto).not.toHaveBeenCalled();
    await test(el);
    expect(runEmailTest).toHaveBeenCalledWith(email, "admin@example.com", "live");
    expect(button(el, "next").disabled).toBe(false);
    button(el, "next").click();
    expect(patch.mock.calls[0]![0].detail.patch).toEqual({ email });
    expect(goto.mock.calls[0]![0].detail.screen).toBe("review");
    await change(el, "server", "other.example.com");
    expect(button(el, "next").disabled).toBe(true);
  });
  it("tests Prepare mode and invalidates acceptance if the mode changes", async () => {
    const { el, runEmailTest } = await mount();
    Object.assign(el, { mode: "prepare" });
    await el.updateComplete;
    await test(el);
    expect(runEmailTest).toHaveBeenCalledWith(email, "admin@example.com", "prepare");
    expect(button(el, "next").disabled).toBe(false);
    Object.assign(el, { mode: "live" });
    await el.updateComplete;
    expect(button(el, "next").disabled).toBe(true);
  });
  it.each(["email.test_refused", "email.test_timeout"])(
    "shows %s, keeps the draft and permits retry",
    async (code) => {
      const { el } = await mount(vi.fn().mockResolvedValue({ accepted: false, code }));
      await test(el);
      expect(button(el, "next").disabled).toBe(true);
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toBeTruthy();
      expect(
        (el.shadowRoot!.querySelector("[data-test=password]") as HTMLElement & { value: string })
          .value,
      ).toBe("secret");
    },
  );
  it("rejects invalid fields with a bottom message and recovers while typing", async () => {
    const { el, runEmailTest } = await mount();
    await change(el, "port", "2.5");
    button(el, "test").click();
    await el.updateComplete;
    expect(runEmailTest).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=port]")!.getAttribute("error")).toBeTruthy();
    expect(button(el, "test").disabled).toBe(true);
    await change(el, "port", "465");
    expect(button(el, "test").disabled).toBe(false);
  });
  it("does not accept an answer after the settings change in flight", async () => {
    let resolve!: (result: { accepted: true }) => void;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { el } = await mount(run);
    button(el, "test").click();
    await el.updateComplete;
    await change(el, "from", "other@example.com");
    resolve({ accepted: true });
    await vi.waitFor(() => expect(button(el, "test").disabled).toBe(false));
    expect(button(el, "next").disabled).toBe(true);
  });
  it("does not reuse acceptance after changing the administrator's address", async () => {
    const { el } = await mount();
    await test(el);
    el.adminEmail = "new-admin@example.com";
    await el.updateComplete;
    expect(button(el, "next").disabled).toBe(true);
  });
  it("maps a named server refusal to its field without disabling retry", async () => {
    const { el } = await mount(
      vi.fn().mockRejectedValue({ code: "email.settings_invalid", params: { field: "from" } }),
    );
    await test(el);
    expect(el.shadowRoot!.querySelector("[data-test=from]")!.getAttribute("error")).toBeTruthy();
    expect(button(el, "test").disabled).toBe(false);
  });
  it("renders semantic required inputs and Spanish labels", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Configura el correo electrónico");
    for (const field of ["server", "port", "from"]) {
      const input = el.shadowRoot!.querySelector(`[data-test=${field}]`)!;
      expect(input.hasAttribute("required")).toBe(true);
      expect(input.getAttribute("name")).toBe(`smtp-${field}`);
    }
  });
});

it("reveals the password only after an explicit action", async () => {
  const { el } = await mount();
  const input = () =>
    el.shadowRoot!.querySelector<HTMLElement & { type: string }>("[data-test=password]")!;
  expect(input().type).toBe("password");
  button(el, "toggle-password").click();
  await el.updateComplete;
  expect(input().type).toBe("text");
  expect(button(el, "toggle-password").getAttribute("aria-label")).toBe("Hide password");
  button(el, "toggle-password").click();
  await el.updateComplete;
  expect(input().type).toBe("password");
});
it("announces a network failure without showing raw transport details", async () => {
  const { el } = await mount(vi.fn().mockRejectedValue(new Error("secret smtp detail")));
  await test(el);
  expect(el.shadowRoot!.textContent).not.toContain("secret smtp detail");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toContain(
    "could not be completed",
  );
});
it.each([
  ["server", ""],
  ["server", "smtp://invalid"],
  ["port", "0"],
  ["port", "65536"],
  ["from", "bad"],
  ["encryption", "none"],
  ["password", ""],
  ["user", ""],
])("rejects invalid %s=%s", async (field, value) => {
  const { el, runEmailTest } = await mount();
  await change(el, field, value);
  button(el, "test").click();
  await el.updateComplete;
  expect(runEmailTest).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector(`[data-test=${field}]`)!.getAttribute("error")).toBeTruthy();
});
it("accepts a server without authentication and a TLS selection", async () => {
  const { el, runEmailTest } = await mount();
  await change(el, "user", "");
  await change(el, "password", "");
  await change(el, "encryption", "tls");
  await test(el);
  expect(runEmailTest).toHaveBeenCalledWith(
    { ...email, user: "", password: "", encryption: "tls" },
    "admin@example.com",
    "live",
  );
  expect(button(el, "next").disabled).toBe(false);
});
it("ignores a test answer after removal and allows a new request on reconnect", async () => {
  let resolve!: (value: { accepted: true }) => void;
  const run = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ accepted: true });
  const { el, host } = await mount(run);
  button(el, "test").click();
  await el.updateComplete;
  el.remove();
  host.append(el);
  await el.updateComplete;
  resolve({ accepted: true });
  await Promise.resolve();
  await el.updateComplete;
  expect(button(el, "next").disabled).toBe(true);
  await test(el);
  expect(button(el, "next").disabled).toBe(false);
});
it("does not issue simultaneous test requests or continue during one", async () => {
  let resolve!: (value: { accepted: true }) => void;
  const run = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { el } = await mount(run);
  button(el, "test").click();
  button(el, "test").click();
  await el.updateComplete;
  expect(run).toHaveBeenCalledOnce();
  expect(button(el, "test").disabled).toBe(true);
  expect(button(el, "next").disabled).toBe(true);
  resolve({ accepted: true });
  await vi.waitFor(() => expect(button(el, "next").disabled).toBe(false));
});
it("clears a field refusal when edited and returns to the supplied previous step", async () => {
  const { el, host } = await mount(
    vi.fn().mockRejectedValue({ code: "email.settings_invalid", params: { field: "from" } }),
  );
  await test(el);
  await change(el, "from", "other@example.com");
  expect(el.shadowRoot!.querySelector("[data-test=from]")!.getAttribute("error")).toBe("");
  el.backScreen = "fiscal-test";
  const goto = vi.fn();
  host.addEventListener("setup-goto", goto);
  button(el, "back").click();
  expect(goto.mock.calls[0]![0].detail.screen).toBe("fiscal-test");
});

it("sends the test from the native field with Enter", async () => {
  const { el, runEmailTest } = await mount();
  const input = el
    .shadowRoot!.querySelector("[data-test=from]")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.click(input);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(runEmailTest).toHaveBeenCalledOnce());
  expect(runEmailTest).toHaveBeenCalledWith(email, "admin@example.com", "live");
});
it.each(["edit", "recipient", "removed"])("ignores a stale refusal after %s", async (mode) => {
  let reject!: (error: Error) => void;
  const run = vi.fn().mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const { el } = await mount(run);
  button(el, "test").click();
  await el.updateComplete;
  if (mode === "edit") await change(el, "server", "other.example.com");
  else if (mode === "recipient") {
    el.adminEmail = "other@example.com";
    await el.updateComplete;
  } else el.remove();
  reject(new Error("secret stale refusal"));
  await Promise.resolve();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toBe("");
  expect(button(el, "next").disabled).toBe(true);
});

const diagnostics = [
  ["email.test_host_not_found", "server", "No mail server has this name. Check the spelling."],
  [
    "email.test_connection_refused",
    "port",
    "Check the port: nothing at this mail server accepts connections on it.",
  ],
  [
    "email.test_starttls_refused",
    null,
    "This mail server would not start encryption on this port. Try TLS on port 465 or STARTTLS on port 587, or try again later.",
  ],
  ["email.test_tls_refused", null, "This port does not start with TLS. Try STARTTLS on this port."],
  [
    "email.test_certificate_untrusted",
    "server",
    "This mail server's certificate is not trusted, so Waitron will not send it your password.",
  ],
  [
    "email.test_login_refused",
    null,
    "The mail server refused this user and password. Check both, then send the test again.",
  ],
  [
    "email.test_login_required",
    null,
    "This mail server needs a user and password. Enter both, then send the test again.",
  ],
  [
    "email.test_timeout",
    null,
    "The mail server did not answer in time. Check the port and the encryption.",
  ],
  [
    "email.test_refused",
    null,
    "The mail server refused the test message. Check the settings and try again.",
  ],
  [
    "email.test_future_provider_detail",
    null,
    "The mail server refused the test message. Check the settings and try again.",
  ],
] as const;
it.each(diagnostics)(
  "shows %s at its field or footer and permits retry",
  async (code, target, message) => {
    const { el } = await mount(vi.fn().mockResolvedValue({ accepted: false, code }));
    await test(el);
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    await actions.updateComplete;
    expect(actions.error).toBe(target ? "Correct the highlighted fields to continue." : message);
    await vi.waitFor(() =>
      expect(actions.shadowRoot!.querySelectorAll("[role=alert]")).toHaveLength(1),
    );
    for (const key of ["server", "port", "user", "password", "from"]) {
      const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=${key}]`,
      )!;
      await control.updateComplete;
      const native = control.shadowRoot!.querySelector("input")!;
      expect(native.getAttribute("aria-invalid")).toBe(key === target ? "true" : "false");
      expect(control.error).toBe(key === target ? message : "");
      if (key === target) expect(control.shadowRoot!.textContent).toContain(message);
    }
    expect(button(el, "test").disabled).toBe(false);
    expect(el.shadowRoot!.textContent).not.toContain(code);
  },
);
it("suggests a port for the encryption without replacing the entered port", async () => {
  const { el } = await mount();
  const port = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=port]")!;
  const encryption = el.shadowRoot!.querySelector("[data-test=encryption]")!;
  for (const [value, placeholder] of [
    ["starttls", "587"],
    ["tls", "465"],
  ]) {
    encryption.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await port.updateComplete;
    expect(port.shadowRoot!.querySelector("input")!.placeholder).toBe(placeholder);
    expect(port.value).toBe("587");
  }
});
it("shows one consistent port example for the selected encryption", async () => {
  const { el } = await mount();
  await change(el, "encryption", "tls");
  const port = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=port]")!;
  await port.updateComplete;
  expect(port.shadowRoot!.textContent).not.toContain("587");
  expect(port.shadowRoot!.querySelector("input")!.placeholder).toBe("465");
});
it.each([
  ["en-GB", "/help/en/email#test-results"],
  ["es-ES", "/help/es/email#test-results"],
])("links to the SMTP test guide in %s", async (locale, href) => {
  setLocale(locale);
  const { el } = await mount();
  expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe(href);
});
it("describes acceptance without promising delivery", async () => {
  const { el } = await mount();
  await test(el);
  expect(el.shadowRoot!.querySelector("[role=status]")!.textContent).toBe(
    "The mail server accepted the test message. Check your inbox.",
  );
});

it("requires a new test after a previously accepted screen reconnects", async () => {
  const { el, host } = await mount();
  await test(el);
  expect(button(el, "next").disabled).toBe(false);
  el.remove();
  host.append(el);
  await el.updateComplete;
  expect(button(el, "next").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
});

it("does not revive acceptance when the administrator changes away and back", async () => {
  const { el } = await mount();
  await test(el);
  el.adminEmail = "other@example.com";
  await el.updateComplete;
  el.adminEmail = "admin@example.com";
  await el.updateComplete;
  expect(button(el, "next").disabled).toBe(true);
});
it.each(["edit", "recipient", "reconnect"])("ignores a diagnostic reply after %s", async (mode) => {
  let resolve!: (result: { accepted: false; code: "email.test_host_not_found" }) => void;
  const pending = new Promise<{ accepted: false; code: "email.test_host_not_found" }>((r) => {
    resolve = r;
  });
  const { el, host } = await mount(vi.fn().mockReturnValue(pending));
  button(el, "test").click();
  await el.updateComplete;
  if (mode === "edit") await change(el, "server", "new.example.com");
  else if (mode === "recipient") {
    el.adminEmail = "other@example.com";
    await el.updateComplete;
  } else {
    el.remove();
    host.append(el);
    await el.updateComplete;
  }
  resolve({ accepted: false, code: "email.test_host_not_found" });
  await pending;
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  const server =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=server]")!;
  await server.updateComplete;
  expect(server.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("false");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  expect(button(el, "next").disabled).toBe(true);
});

it("renders a certificate refusal in Spanish beside the native server field", async () => {
  setLocale("es-ES");
  const { el } = await mount(
    vi.fn().mockResolvedValue({ accepted: false, code: "email.test_certificate_untrusted" }),
  );
  await test(el);
  const server =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=server]")!;
  await vi.waitFor(() =>
    expect(server.error).toBe(
      "El certificado de este servidor de correo no es de confianza, por lo que Waitron no le enviará tu contraseña.",
    ),
  );
  await server.updateComplete;
  expect(server.shadowRoot!.textContent).toContain(
    "El certificado de este servidor de correo no es de confianza",
  );
  expect(server.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Corrige los campos marcados para continuar.",
  );
});
