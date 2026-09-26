import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./reset-screen.js";
import type { SetupResetScreen } from "./reset-screen.js";

const q = (el: SetupResetScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

function collect(host: HTMLElement): unknown[] {
  const events: unknown[] = [];
  host.addEventListener("reset-requested", (e) => events.push((e as CustomEvent).detail));
  return events;
}

async function type(el: SetupResetScreen, field: string, value: string): Promise<void> {
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function fillValid(
  el: SetupResetScreen,
  overrides: Record<string, string> = {},
): Promise<void> {
  for (const [key, value] of Object.entries({
    personId: "op-1",
    password: "correct horse",
    ...overrides,
  })) {
    await type(el, key, value);
  }
}

async function summary(el: SetupResetScreen): Promise<HTMLElement | null> {
  const found = el.shadowRoot!.querySelector("wt-form-error-summary") as
    (HTMLElement & { updateComplete: Promise<unknown> }) | null;
  await found?.updateComplete;
  return found;
}

async function alerts(el: SetupResetScreen): Promise<Element[]> {
  const inner = await summary(el);
  return [
    ...el.shadowRoot!.querySelectorAll("[role=alert]"),
    ...(inner?.shadowRoot!.querySelectorAll("[role=alert]") ?? []),
  ];
}

const REJECTED =
  "That person ID and password are not the admin login used to connect this server. Check them and try again.";

afterEach(cleanupWidgets);

describe("setup-reset-screen", () => {
  it("says what the reset does to this server and that it changes nothing on the primary", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reset this server");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("half-finished join");
    expect(text).toContain("Nothing on the primary server is changed");
  });

  it("emits reset-requested with the trimmed person ID and the password as typed", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await fillValid(el, { personId: "  op-1  ", password: "  correct horse  " });
    q(el, "[data-test=reset]")!.click();
    expect(events).toEqual([{ credential: { personId: "op-1", password: "  correct horse  " } }]);
  });

  it("resets when Enter is pressed in a field", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=password]")!.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(events).toEqual([{ credential: { personId: "op-1", password: "correct horse" } }]);
  });

  it("names both fields semantically, marks them required and gives them login autocomplete", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const personId = q(el, "[data-test=personId]")!;
    const password = q(el, "[data-test=password]")!;
    expect(personId.getAttribute("name")).toBe("personId");
    expect(personId.getAttribute("autocomplete")).toBe("username");
    expect(personId.hasAttribute("required")).toBe(true);
    expect(password.getAttribute("name")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(password.hasAttribute("required")).toBe(true);
    expect(password.getAttribute("type")).toBe("password");
  });

  it("reveals and hides the password without changing it or resetting", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await type(el, "password", "correct horse");
    const input = q(el, "[data-test=password]")! as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    const toggle = input.querySelector<HTMLElement>("[data-test=toggle-password]")!;
    expect(toggle.getAttribute("aria-label")).toBe("Show password");
    toggle.click();
    await el.updateComplete;
    await input.updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.type).toBe("text");
    expect(input.shadowRoot!.querySelector("input")!.value).toBe("correct horse");
    expect(toggle.getAttribute("aria-label")).toBe("Hide password");
    toggle.click();
    await el.updateComplete;
    await input.updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.type).toBe("password");
    expect(events).toEqual([]);
  });

  it.each([
    ["personId", "Enter the admin person ID."],
    ["password", "Enter the admin password."],
  ])(
    "blocks the reset and explains %s when it is blank, emitting nothing",
    async (field, sentence) => {
      const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
      const events = collect(host);
      await fillValid(el, { [field]: field === "password" ? "" : "   " });
      q(el, "[data-test=reset]")!.click();
      await el.updateComplete;
      expect(events).toEqual([]);
      const input = q(el, `[data-test=${field}]`)!;
      expect(input.hasAttribute("invalid")).toBe(true);
      expect(input.getAttribute("error")).toBe(sentence);
      const shown = await summary(el);
      expect((shown as unknown as { errors: string[] }).errors).toEqual([sentence]);
      expect(await alerts(el)).toHaveLength(1);
    },
  );

  it("clears the client summary once a valid reset is submitted", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(await summary(el)).not.toBeNull();
    await fillValid(el);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(await summary(el)).toBeNull();
    expect(events).toHaveLength(1);
  });

  it("disables the reset button and reads Resetting… while the reset is in flight", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", { busy: true });
    const events = collect(host);
    await fillValid(el);
    const reset = q(el, "[data-test=reset]")!;
    expect(reset.hasAttribute("disabled")).toBe(true);
    expect(reset.textContent!.trim()).toBe("Resetting…");
    reset.click();
    q(el, "[data-test=password]")!.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(events).toEqual([]);
  });

  it("marks both fields and names the refused login in the summary when the login was refused", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      credentialsRejected: true,
    });
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("Check the admin person ID.");
    expect(q(el, "[data-test=password]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("Check the admin password.");
    const shown = await summary(el);
    expect((shown as unknown as { errors: string[] }).errors).toEqual([REJECTED]);
    expect(await alerts(el)).toHaveLength(1);
  });

  it("shows a routed-back message as one alert beside the form", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "Too many attempts. Wait 30 seconds, then try again.",
    });
    const banner = q(el, "[data-test=server-error]")!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("Wait 30 seconds");
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=personId]")).not.toBeNull();
  });

  it("shows only the client summary when it and a routed-back message coincide", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "The server could not be reset.",
      credentialsRejected: true,
    });
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=server-error]")).toBeNull();
    const shown = await summary(el);
    expect((shown as unknown as { errors: string[] }).errors).toEqual([
      "Enter the admin person ID.",
      "Enter the admin password.",
    ]);
    expect(await alerts(el)).toHaveLength(1);
  });

  it("keeps a field's wt-change inside the screen", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const escaped: Event[] = [];
    host.addEventListener("wt-change", (e) => escaped.push(e));
    await type(el, "personId", "op-1");
    expect(escaped).toEqual([]);
  });

  it("steps back to the provisioning message without resetting", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    const gotos: unknown[] = [];
    host.addEventListener("setup-goto", (e) => gotos.push((e as CustomEvent).detail));
    expect(q(el, "[data-test=back]")!.getAttribute("variant")).toBe("ghost");
    q(el, "[data-test=back]")!.click();
    expect(gotos).toEqual([{ screen: "provisioning" }]);
    expect(events).toEqual([]);
  });

  it("replaces the form with the restart message and a Reload once the reset is staged", async () => {
    const reload = vi.fn();
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      outcome: { kind: "resetting", message: "The server is resetting and will restart." },
      reload,
    });
    const status = q(el, "[data-test=outcome]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("resetting and will restart");
    expect(q(el, "[data-test=personId]")).toBeNull();
    expect(q(el, "[data-test=back]")).toBeNull();
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("replaces the form with a refusal alert and a Reload when the reset cannot run", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      outcome: { kind: "refused", message: "There is no half-finished join to reset." },
      reload: vi.fn(),
    });
    const alert = q(el, "[data-test=outcome]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("no half-finished join");
    expect(q(el, "[data-test=personId]")).toBeNull();
    expect(q(el, "[data-test=reload]")!.textContent!.trim()).toBe("Reload");
  });
});
