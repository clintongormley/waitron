import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { LoginScreen } from "./login-screen.js";

afterEach(cleanupWidgets);

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    ...overrides,
  } as unknown as DashboardApi;
}

describe("login-screen", () => {
  it("loads the roster and logs in the picked person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r)); // let getStaffRoster resolve
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    // select person p1, type password, submit
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect((await loggedIn).personId).toBe("p1");
    expect(api.login).toHaveBeenCalledWith({
      personId: "p1",
      password: "correct horse",
      totp: undefined,
    });
  });

  it("shows an error key when login is rejected", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("password.invalid");
  });

  // Drives the three field handlers through the DOM (the two tests above assign state directly, so
  // they never fire `@change`/`@wt-change`), and — by typing a code — exercises the non-empty TOTP
  // branch that passes `totp` through instead of `undefined`.
  it("reads the person, password and TOTP from the fields", async () => {
    const api = stubApi({
      getStaffRoster: vi.fn().mockResolvedValue([
        { personId: "p1", displayName: "Ada" },
        { personId: "p2", displayName: "Ben" },
      ]),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;

    const select = el.shadowRoot!.querySelector("select")!;
    select.value = "p2";
    select.dispatchEvent(new Event("change"));
    const [password, totp] = el.shadowRoot!.querySelectorAll("wt-input");
    password.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "hunter2" } }));
    totp.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "123456" } }));
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    expect(api.login).toHaveBeenCalledWith({
      personId: "p2",
      password: "hunter2",
      totp: "123456",
    });
  });

  // The guard on `#loadRoster`: a rejected roster fetch must become the error banner, never an
  // unhandled promise rejection (the whole suite runs with pristine output, which pins that). Also
  // covers the `.code` path of `#loadRoster`'s catch.
  it("shows an error key when the roster fetch is rejected (and never rejects)", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain("server.internal");
  });

  it("falls back to server.internal when a rejected roster fetch carries no code", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("selects nothing when the roster is empty", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { selected: string }).selected).toBe("");
  });

  it("falls back to server.internal when the rejection carries no code", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    await el.updateComplete;
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });
});
