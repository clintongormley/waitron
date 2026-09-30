import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
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

/** The one message beside the reset button, as `wt-form-actions` shows it. */
async function bottomOf(el: SetupResetScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

/** Every alert in the screen and in its action row. */
async function alerts(el: SetupResetScreen): Promise<Element[]> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions");
  await actions?.updateComplete;
  return [
    ...el.shadowRoot!.querySelectorAll("[role=alert]"),
    ...(actions?.shadowRoot!.querySelectorAll("[role=alert]") ?? []),
  ];
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

const REJECTED =
  "That person ID and password are not the admin login used to connect this server. Check them and try again.";

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe("setup-reset-screen", () => {
  it("says what the reset does to this server and that it changes nothing on the primary", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reset this server");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("half-finished join");
    expect(text).toContain("Nothing on the primary server is changed");
  });

  it("says how to take this server off the primary's list", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(
      "To take it off that list, open the primary's dashboard, then Settings, then Servers, open this server's row menu and choose Remove, then open the row menu again and choose Clear from list.",
    );
    expect(text).toContain("If its row already says Removed, only Clear from list is needed.");
    expect(text).toContain(
      "Do this before you join this server again: otherwise the new join adds a second row that is hard to tell apart from this one, or is refused if the list is full.",
    );
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
      expect(await bottomOf(el)).toBe(FIX_FIELDS);
      expect(await alerts(el)).toHaveLength(1);
    },
  );

  it("clears the client message once a valid reset is submitted", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await fillValid(el);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
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

  it("marks no field and names the refused login beside the reset button when the login was refused", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      credentialsRejected: true,
    });
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=password]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe(REJECTED);
    expect(await alerts(el)).toHaveLength(1);
  });

  // Owner rule (A153, 2026-09-30): a refused login marks no field, so it cannot say which part was
  // wrong; only a missing or malformed value is marked.
  it("marks no field on a refused login, says so once beside the reset button and focuses the password", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    await fillValid(el);
    el.credentialsRejected = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    for (const field of ["personId", "password"]) {
      const input = q(el, `[data-test=${field}]`)!;
      expect(input.getAttribute("error")).toBe("");
      expect(input.hasAttribute("invalid")).toBe(false);
    }
    expect(await bottomOf(el)).toBe(REJECTED);
    expect(await bottomOf(el)).not.toContain(FIX_FIELDS);
    expect(await alerts(el)).toHaveLength(1);
    const password = q(el, "[data-test=password]")!;
    expect(el.shadowRoot!.activeElement).toBe(password);
    expect(password.shadowRoot!.activeElement).toBe(password.shadowRoot!.querySelector("input"));
  });

  it("shows a routed-back message as one alert beside the reset button, leaving it working", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "Too many attempts. Wait 30 seconds, then try again.",
    });
    expect(await bottomOf(el)).toBe("Too many attempts. Wait 30 seconds, then try again.");
    expect(await alerts(el)).toHaveLength(1);
    expect(q(el, "[data-test=personId]")).not.toBeNull();
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(false);
  });

  it("drops a routed-back message for the client message when a press finds blank fields", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "The server could not be reset.",
    });
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("Enter the admin person ID.");
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("Enter the admin password.");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(await alerts(el)).toHaveLength(1);
  });

  it("drops a routed-back message when the reset is asked for again", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      errorMessage: "The server could not be reset.",
    });
    const events = collect(host);
    await fillValid(el);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(await bottomOf(el)).toBe("");
  });

  it("says nothing and leaves the reset button working before the first press", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    await type(el, "personId", "");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(false);
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(false);
  });

  it("on a failed press focuses the first blank field and disables the reset button", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    await type(el, "personId", "op-1");
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    const password = q(el, "[data-test=password]")!;
    expect(password.getAttribute("error")).toBe("Enter the admin password.");
    expect(password.shadowRoot!.activeElement).toBe(password.shadowRoot!.querySelector("input"));
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(true);
  });

  it("re-checks each change after a failed press, and the reset works again once both are filled", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;

    await type(el, "personId", "op-1");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(true);

    await type(el, "personId", " ");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("Enter the admin person ID.");

    await fillValid(el);
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=reset]")!.click();
    expect(events).toHaveLength(1);
  });

  it("leaves the reset button working under a refused login, and focuses the password when it arrives", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await fillValid(el);
    el.credentialsRejected = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const password = q(el, "[data-test=password]")!;
    expect(password.shadowRoot!.activeElement).toBe(password.shadowRoot!.querySelector("input"));
    expect((q(el, "[data-test=reset]") as HTMLElement & { disabled: boolean }).disabled).toBe(
      false,
    );
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(events).toEqual([{ credential: { personId: "op-1", password: "correct horse" } }]);
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("shows a request refusal of one field under that field, leaving the reset button working", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await fillValid(el);
    el.invalidField = "password";
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    const password = q(el, "[data-test=password]")!;
    expect(password.shadowRoot!.activeElement).toBe(password.shadowRoot!.querySelector("input"));
    expect(q(el, "[data-test=password]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("Check the admin password.");
    expect(q(el, "[data-test=personId]")!.hasAttribute("invalid")).toBe(false);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect((q(el, "[data-test=reset]") as HTMLElement & { disabled: boolean }).disabled).toBe(
      false,
    );

    await type(el, "password", "battery staple");
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
    el.invalidField = undefined;
    await el.updateComplete;
    el.invalidField = "personId";
    await el.updateComplete;
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(events).toHaveLength(1);
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
  });

  it("withdraws a refused login's message once either field changes, and the reset then sends the new login", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    const events = collect(host);
    await fillValid(el);
    el.credentialsRejected = true;
    await el.updateComplete;

    await type(el, "password", "battery staple");
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=reset]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=reset]")!.click();
    expect(events).toEqual([{ credential: { personId: "op-1", password: "battery staple" } }]);
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

  it("shows the form in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restablecer este servidor");
    const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("No se cambia nada en el servidor principal");
    expect(q(el, "[data-test=personId]")!.getAttribute("label")).toBe(
      "Inicio de sesión del administrador (ID de persona)",
    );
    expect(q(el, "[data-test=password]")!.getAttribute("label")).toBe(
      "Contraseña del administrador",
    );
    expect(q(el, "[data-test=toggle-password]")!.getAttribute("aria-label")).toBe(
      "Mostrar contraseña",
    );
    expect(q(el, "[data-test=back]")!.textContent!.trim()).toBe("Volver");
    expect(q(el, "[data-test=reset]")!.textContent!.trim()).toBe("Restablecer este servidor");
  });

  it("explains missing fields in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    q(el, "[data-test=reset]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=personId]")!.getAttribute("error")).toBe(
      "Introduce el ID de persona del administrador.",
    );
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe(
      "Introduce la contraseña del administrador.",
    );
    expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  });

  it("names a refused login in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {
      credentialsRejected: true,
    });
    expect(q(el, "[data-test=password]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe(
      "Ese ID de persona y esa contraseña no son el inicio de sesión de administrador que se usó para conectar este servidor. Revísalos e inténtalo de nuevo.",
    );
  });

  it("shows the in-flight button and the outcome in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", { busy: true });
    expect(q(el, "[data-test=reset]")!.textContent!.trim()).toBe("Restableciendo…");
    el.outcome = { kind: "resetting", message: "El servidor se está restableciendo." };
    await el.updateComplete;
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restableciendo este servidor");
    expect(q(el, "[data-test=reload]")!.textContent!.trim()).toBe("Recargar");
  });

  it("redraws in Spanish on a live language switch and keeps what was typed", async () => {
    const { el } = await mountWidget<SetupResetScreen>("setup-reset-screen", {});
    await type(el, "personId", "op-7");
    expect(q(el, "h1")!.textContent!.trim()).toBe("Reset this server");
    setLocale("es-ES");
    await el.updateComplete;
    expect(q(el, "h1")!.textContent!.trim()).toBe("Restablecer este servidor");
    expect(q(el, "[data-test=personId]")!.getAttribute("label")).toBe(
      "Inicio de sesión del administrador (ID de persona)",
    );
    const input = q(el, "[data-test=personId]") as HTMLElement & { value: string };
    expect(input.value).toBe("op-7");
  });
});
