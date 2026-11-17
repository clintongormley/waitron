import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { startEn, startEs } from "../i18n/strings/start.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";

const context = {
  accountUrl: "https://cloud.example.test/account",
  copyExpiresAt: "2026-11-17T22:30:00.000Z",
};
const session = {
  personId: "owner",
  displayName: "Nora",
  copyOperationId: "copy",
  signedInAt: "2026-11-17T22:01:00.000Z",
  expiresAt: "2026-11-17T22:11:00.000Z",
  copyExpiresAt: context.copyExpiresAt,
  remainingMs: 600000,
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

async function mount(code = "management_session.required", signed = false) {
  await import("./emergency-start-screen.js");
  const requests: { path: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const path = String(input);
    requests.push({ path, init });
    if (path === "/locked-api/context") return Response.json(context);
    if (init?.method === "DELETE") return Response.json({ ok: true });
    if (init?.method === "POST" || (signed && !init?.method)) return Response.json(session);
    return Response.json({ error: { code, params: {} } }, { status: 401 });
  };
  const { el } = await mountWidget<LitElement & { transport: typeof fetch }>(
    "setup-emergency-start-screen",
    { transport },
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("h1")).not.toBeNull());
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("a")?.href).toBe(context.accountUrl));
  return { el, requests };
}
async function fill(el: LitElement, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function click(el: LitElement, action: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click();
  await el.updateComplete;
}

it("requires all three factors and sends recovery codes in place of authenticator codes", async () => {
  const { el, requests } = await mount();
  expect(requests.map((r) => r.path)).toEqual(["/locked-api/context", "/locked-api/session"]);
  expect(el.shadowRoot!.textContent).toContain(startEn["emergency.authenticator"]);
  expect(el.shadowRoot!.textContent).toContain(startEn["emergency.no_passkeys"]);
  await click(el, "sign-in");
  expect(el.shadowRoot!.querySelectorAll("wt-input[invalid]")).toHaveLength(3);
  expect(el.shadowRoot!.querySelector("wt-form-actions")?.shadowRoot?.textContent).toContain(
    startEn["emergency.fix_fields"],
  );
  await fill(el, "email", "nora@example.test");
  await fill(el, "password", " secret ");
  el.shadowRoot!.querySelector<HTMLElement>("[name=password] wt-button")!.click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[name=password]")!.shadowRoot!.querySelector("input")!.type,
  ).toBe("text");
  el.shadowRoot!.querySelector<HTMLElement>("[name=password] wt-button")!.click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[name=password]")!.shadowRoot!.querySelector("input")!.type,
  ).toBe("password");
  await click(el, "recovery");
  await fill(el, "code", "abcd-0123");
  el.shadowRoot!.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Nora"));
  const post = requests.find((r) => r.init?.method === "POST")!;
  expect(JSON.parse(String(post.init!.body))).toEqual({
    email: "nora@example.test",
    password: " secret ",
    recoveryCode: "abcd-0123",
  });
  expect(post.init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  expect(el.shadowRoot!.querySelector("time[data-copy-expiry]")?.getAttribute("datetime")).toBe(
    context.copyExpiresAt,
  );
  expect(el.shadowRoot!.querySelector("[name=password]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain(startEn["emergency.not_started"]);
});

it.each([
  "password.invalid",
  "authorization.not_permitted",
  "management_session.expired",
  "password.throttled",
  "network",
])("offers a usable next step after %s", async (code) => {
  const { el } = await mount();
  el.transport = async (input) => {
    if (String(input) === "/locked-api/context") return Response.json(context);
    if (code === "network") throw new TypeError("offline");
    return Response.json({ error: { code } }, { status: 403 });
  };
  for (const [name, value] of [
    ["email", "nora@example.test"],
    ["password", "secret"],
    ["code", "012345"],
  ])
    await fill(el, name!, value!);
  await click(el, "sign-in");
  const key =
    code === "authorization.not_permitted"
      ? "permission"
      : code === "management_session.expired"
        ? "expired"
        : code === "password.throttled"
          ? "throttled"
          : code === "network"
            ? "unavailable"
            : "invalid";
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")?.shadowRoot?.textContent).toContain(
      startEn[`emergency.${key}`],
    ),
  );
  expect(el.shadowRoot!.querySelectorAll("wt-input[invalid]")).toHaveLength(0);
  expect(el.shadowRoot!.querySelector("[data-action=sign-in]")?.hasAttribute("disabled")).toBe(
    false,
  );
  expect(el.shadowRoot!.querySelector("a")?.href).toBe(context.accountUrl);
});

it("restores a protected handoff on reload and removes it when the session expires", async () => {
  const { el } = await mount("management_session.required", true);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Nora"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    // Reconnect at a fixed time to exercise the real ten-minute session deadline.
    vi.setSystemTime(new Date(session.signedInAt));
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
    await el.updateComplete;
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Nora"));
    await vi.advanceTimersByTimeAsync(600000);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain("Nora");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")?.shadowRoot?.textContent).toContain(
        startEn["emergency.expired"],
      ),
    );
  } finally {
    vi.useRealTimers();
  }
});

it("shows Spanish sign-in words and clears a signed-in actor on sign-out", async () => {
  setLocale("es-ES");
  const { el, requests } = await mount("management_session.required", true);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Nora"));
  await click(el, "sign-out");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[name=email]")).not.toBeNull());
  expect(requests.some((r) => r.init?.method === "DELETE")).toBe(true);
  expect(el.shadowRoot!.textContent).toContain(startEs["emergency.authenticator"]);
});

it("expires a fresh sign-in without marking empty fields, even on a device with a fast clock", async () => {
  const { el } = await mount();
  for (const [name, value] of [
    ["email", "nora@example.test"],
    ["password", "secret"],
    ["code", "012345"],
  ])
    await fill(el, name!, value!);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    await click(el, "sign-in");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Nora"));
    await vi.advanceTimersByTimeAsync(1);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("Nora");
    await vi.advanceTimersByTimeAsync(600000);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("wt-input[invalid]")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector("[data-action=sign-in]")?.hasAttribute("disabled")).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});

it("returns to sign-in when the server already dropped the session", async () => {
  const { el } = await mount("management_session.required", true);
  el.transport = async () =>
    Response.json({ error: { code: "management_session.expired" } }, { status: 401 });
  await click(el, "sign-out");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[name=email]")).not.toBeNull());
  expect(el.shadowRoot!.textContent).not.toContain("Nora");
});

it("retries a failed initial read and loads only the emergency entry", async () => {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline"));
  fetcher.mockImplementation(async (input) =>
    String(input) === "/locked-api/context"
      ? Response.json(context)
      : Response.json({ error: { code: "management_session.required" } }, { status: 401 }),
  );
  try {
    await import("../emergency-main.js");
    const el = app.querySelector<LitElement>("setup-emergency-start-screen")!;
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(startEn["emergency.unavailable"]),
    );
    el.shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[name=email]")).not.toBeNull());
    await fill(el, "email", "nora");
    await click(el, "sign-in");
    const field = el.shadowRoot!.querySelector<LitElement>("[name=email]")!;
    await field.updateComplete;
    expect(field.shadowRoot!.textContent).toContain(startEn["emergency.email_invalid"]);
    expect(document.documentElement.hasAttribute("data-wt-theme-root")).toBe(true);
    expect(app.querySelector("setup-app")).toBeNull();
  } finally {
    app.remove();
  }
});
