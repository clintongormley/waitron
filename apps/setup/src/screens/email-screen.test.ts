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
    expect(runEmailTest).toHaveBeenCalledWith(email, "admin@example.com");
    expect(button(el, "next").disabled).toBe(false);
    button(el, "next").click();
    expect(patch.mock.calls[0]![0].detail.patch).toEqual({ email });
    expect(goto.mock.calls[0]![0].detail.screen).toBe("review");
    await change(el, "server", "other.example.com");
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
  expect(runEmailTest).toHaveBeenCalledWith(email, "admin@example.com");
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
