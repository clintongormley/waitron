import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./admin-screen.js";
import type { SetupAdminScreen } from "./admin-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

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

async function type(el: SetupAdminScreen, field: string, value: string): Promise<void> {
  q(el, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** The one message above Next, as `wt-form-actions` shows it. */
async function bottomOf(el: SetupAdminScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

const FIX_FIELDS = "Correct the highlighted fields to continue.";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("setup-admin-screen", () => {
  it("renders the email field as an email-typed wt-input", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const email = q(el, "[data-test=email]");
    expect(email).not.toBeNull();
    expect(email!.tagName.toLowerCase()).toBe("wt-input");
    expect(email!.getAttribute("type")).toBe("email");
    const native = email!.shadowRoot!.querySelector("input")!;
    expect({ name: native.name, autocomplete: native.autocomplete }).toEqual({
      name: "email",
      autocomplete: "username",
    });
  });

  it("names the remaining account fields for autofill", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const field = (key: string) => q(el, `[data-test=${key}]`)!.shadowRoot!.querySelector("input")!;
    expect({
      name: field("displayName").name,
      autocomplete: field("displayName").autocomplete,
    }).toEqual({ name: "name", autocomplete: "name" });
    expect({ name: field("password").name, autocomplete: field("password").autocomplete }).toEqual({
      name: "new-password",
      autocomplete: "new-password",
    });
    expect({ name: field("pin").name, autocomplete: field("pin").autocomplete }).toEqual({
      name: "pin",
      autocomplete: "off",
    });
  });

  it("collects every field and advances to venue with the admin patch", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "firstNames", "Alba");
    await type(el, "lastNames", "Ramos");
    await type(el, "displayName", "Alba");
    await type(el, "email", "alba@example.com");
    await type(el, "password", "correct horse");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    expect(events).toEqual([
      {
        kind: "patch",
        detail: {
          patch: {
            venue: {
              admin: {
                firstNames: "Alba",
                lastNames: "Ramos",
                displayName: "Alba",
                email: "alba@example.com",
                pin: "1234",
                password: "correct horse",
              },
            },
          },
        },
      },
      { kind: "goto", detail: { screen: "venue" } },
    ]);
  });

  it("blocks Next and marks email invalid when email is left blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "firstNames", "Alba");
    await type(el, "lastNames", "Ramos");
    await type(el, "displayName", "Alba");
    await type(el, "password", "correct horse");
    await type(el, "pin", "1234");
    // email left blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    expect(q(el, "[data-test=email]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=displayName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("blocks Next and announces the message above it when a field is blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "Alba");
    // password + pin left blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.shadowRoot!.querySelector("[data-error]")!.getAttribute("role")).toBe("alert");
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

  it("clears the message above Next once the fields are filled and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    await type(el, "firstNames", "Alba");
    await type(el, "lastNames", "Ramos");
    await type(el, "displayName", "Alba");
    await type(el, "email", "alba@example.com");
    await type(el, "password", "pw");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    expect(events.some((e) => e.kind === "goto")).toBe(true);
  });

  it("steps back to mode without emitting a patch", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    q(el, "[data-test=back]")!.click();
    expect(events).toEqual([{ kind: "goto", detail: { screen: "mode" } }]);
  });

  it("seeds the editable fields from a draft so Back-then-forward is non-destructive", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      venue: {
        admin: {
          displayName: "Alba",
          email: "alba@example.com",
          password: "correct horse",
          pin: "1234",
        },
      },
    };
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
    const val = (field: string) =>
      (q(el, `[data-test=${field}]`) as unknown as { value: string }).value;
    expect(val("displayName")).toBe("Alba");
    expect(val("email")).toBe("alba@example.com");
    expect(val("password")).toBe("correct horse");
    expect(val("pin")).toBe("1234");
  });

  it("seeds only the fields a partial draft admin carries, leaving the rest blank", async () => {
    const draft: DeepPartial<ProvisionBody> = {
      venue: { admin: { displayName: "Alba" } }, // no email, no password, no pin
    };
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
    const val = (field: string) =>
      (q(el, `[data-test=${field}]`) as unknown as { value: string }).value;
    expect(val("displayName")).toBe("Alba");
    expect(val("email")).toBe("");
    expect(val("password")).toBe("");
    expect(val("pin")).toBe("");
  });

  // The shell reassigns `draft` on every merge, which must not re-seed over a local edit.
  it("seeds from the draft only once, so a later draft reassignment keeps local edits", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {
      draft: { venue: { admin: { password: "initial" } } },
    });
    const val = () => (q(el, "[data-test=password]") as unknown as { value: string }).value;
    expect(val()).toBe("initial");

    await type(el, "password", "edited");
    expect(val()).toBe("edited");

    el.draft = { venue: { admin: { password: "reseeded" } } };
    await el.updateComplete;
    expect(val()).toBe("edited");
  });
});

it("Enter advances the admin step using current shadow input values", async () => {
  const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  const events = collect(host);
  for (const [field, value] of Object.entries({
    firstNames: "Alba",
    lastNames: "Ramos",
    displayName: "Alba",
    email: "alba@example.com",
    password: "secret",
    pin: "1234",
  })) {
    const control = el.shadowRoot!.querySelector(
      `wt-input[data-test=${field}]`,
    )! as import("@waitron/ui").WtInput;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  await el.updateComplete;
  q(el, "[data-test=pin]")!.shadowRoot!.querySelector<HTMLInputElement>("input")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual([
    {
      kind: "patch",
      detail: {
        patch: {
          venue: {
            admin: {
              firstNames: "Alba",
              lastNames: "Ramos",
              displayName: "Alba",
              email: "alba@example.com",
              password: "secret",
              pin: "1234",
            },
          },
        },
      },
    },
    { kind: "goto", detail: { screen: "venue" } },
  ]);
});

it.each(["password", "pin"])(
  "reveals and hides the native %s without changing its value or advancing",
  async (key) => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, key, "123456");
    const input = q(el, `[data-test=${key}]`)!;
    const toggle = input.querySelector<HTMLElement>(`[data-test=toggle-${key}]`);
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector("svg")).not.toBeNull();
    expect(toggle!.getAttribute("aria-label")).toBe(key === "pin" ? "Show PIN" : "Show password");
    toggle!.click();
    await el.updateComplete;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.type).toBe("text");
    expect(input.shadowRoot!.querySelector("input")!.value).toBe("123456");
    toggle!.click();
    await el.updateComplete;
    await (input as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.type).toBe("password");
    expect(events).toEqual([]);
  },
);

it("is titled for the person filling it in", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  expect(q(el, "h1")!.textContent!.trim()).toBe("Your account");
});

it("fills the display name in from both names while it is untouched", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "firstNames", "Clinton");
  await type(el, "lastNames", "Gormley");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe(
    "Clinton Gormley",
  );
});

it("stops following the names once the display name is edited by hand", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "firstNames", "Clinton");
  await type(el, "displayName", "Clint");
  await type(el, "lastNames", "Gormley");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe("Clint");
});

// The messages are read as rendered words, so a missing label ("Enter your undefined.") fails here.
it.each([
  ["first", "firstNames", "lastNames", "Enter your first name(s)."],
  ["last", "lastNames", "firstNames", "Enter your last name(s)."],
] as const)(
  "does not advance without a %s name, and says so under it and above Next",
  async (_which, blank, filled, message) => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(el);
    await type(el, filled, "Clinton");
    await type(el, "displayName", "Clinton");
    await type(el, "email", "clinton@example.com");
    await type(el, "password", "correct horse battery");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, `[data-test=${blank}]`)!.hasAttribute("invalid")).toBe(true);
    expect(q(el, `[data-test=${filled}]`)!.hasAttribute("invalid")).toBe(false);
    expect(q(el, `[data-test=${blank}]`)!.getAttribute("error")).toBe(message);
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
  },
);

it("carries both names up in the patch", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  const events = collect(el);
  await type(el, "firstNames", "Clinton");
  await type(el, "lastNames", "Gormley");
  await type(el, "email", "clinton@example.com");
  await type(el, "password", "correct horse battery");
  await type(el, "pin", "1234");
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  const patch = events.find((e) => e.kind === "patch")!.detail as {
    patch: { venue: { admin: Record<string, string> } };
  };
  expect(patch.patch.venue.admin).toMatchObject({
    firstNames: "Clinton",
    lastNames: "Gormley",
    displayName: "Clinton Gormley",
  });
});

it("restores both names when the operator steps back", async () => {
  const draft: DeepPartial<ProvisionBody> = {
    venue: { admin: { firstNames: "Clinton", lastNames: "Gormley", displayName: "Clint" } },
  };
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
  const value = (key: string) =>
    (q(el, `[data-test=${key}]`) as HTMLElement & { value: string }).value;
  expect([value("firstNames"), value("lastNames"), value("displayName")]).toEqual([
    "Clinton",
    "Gormley",
    "Clint",
  ]);
});

it("keeps a display name that came from the draft when a name is corrected", async () => {
  const draft: DeepPartial<ProvisionBody> = {
    venue: { admin: { firstNames: "Clinton", lastNames: "Gormley", displayName: "Clint" } },
  };
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
  await type(el, "lastNames", "Gormsley");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe("Clint");
});

it("regenerates an auto-filled display name from the draft when a name changes on the way back", async () => {
  const draft: DeepPartial<ProvisionBody> = {
    venue: {
      admin: { firstNames: "Clinton", lastNames: "Gormley", displayName: "Clinton Gormley" },
    },
  };
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", { draft });
  await type(el, "lastNames", "Smith");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe(
    "Clinton Smith",
  );
});

it("resumes generating the display name after it is cleared", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "firstNames", "Clinton");
  await type(el, "lastNames", "Gormley");
  await type(el, "displayName", "");
  await type(el, "firstNames", "Alba");
  expect((q(el, "[data-test=displayName]") as HTMLElement & { value: string }).value).toBe(
    "Alba Gormley",
  );
});

it("labels the account form and names a blank field in Spanish", async () => {
  setLocale("es-ES");
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  expect(q(el, "h1")!.textContent!.trim()).toBe("Tu cuenta");
  expect(q(el, "[data-test=firstNames]")!.getAttribute("label")).toBe("Nombre(s)");
  expect(q(el, "[data-test=toggle-pin]")!.getAttribute("aria-label")).toBe("Mostrar PIN");
  expect(q(el, "[data-test=next]")!.textContent!.trim()).toBe("Siguiente");
  await type(el, "firstNames", "Clinton");
  await type(el, "displayName", "Clinton");
  await type(el, "email", "clinton@example.com");
  await type(el, "password", "correct horse battery");
  await type(el, "pin", "1234");
  q(el, "[data-test=next]")!.click();
  await el.updateComplete;
  expect(await bottomOf(el)).toBe("Corrige los campos marcados para continuar.");
  expect(q(el, "[data-test=lastNames]")!.getAttribute("error")).toBe("Introduce tus apellidos.");
});

it("switches language while mounted and keeps what was typed", async () => {
  const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
  await type(el, "email", "alba@example.com");
  setLocale("es-ES");
  await el.updateComplete;
  expect(q(el, "h1")!.textContent!.trim()).toBe("Tu cuenta");
  expect(q(el, "[data-test=email]")!.getAttribute("label")).toBe("Correo electrónico");
  expect((q(el, "[data-test=email]") as HTMLElement & { value: string }).value).toBe(
    "alba@example.com",
  );
});

describe("setup-admin-screen form messages", () => {
  const next = (el: SetupAdminScreen) => q(el, "[data-test=next]")!;

  async function fillAll(el: SetupAdminScreen): Promise<void> {
    await type(el, "firstNames", "Alba");
    await type(el, "lastNames", "Ramos");
    await type(el, "displayName", "Alba");
    await type(el, "email", "alba@example.com");
    await type(el, "password", "correct horse");
    await type(el, "pin", "1234");
  }

  it("says nothing and leaves Next working before the first press", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    expect(await bottomOf(el)).toBe("");
    expect(q(el, "[data-test=firstNames]")!.getAttribute("error")).toBe("");
    expect(q(el, "[data-test=firstNames]")!.hasAttribute("invalid")).toBe(false);
    expect(next(el).hasAttribute("disabled")).toBe(false);
    await type(el, "firstNames", "");
    expect(q(el, "[data-test=firstNames]")!.getAttribute("error")).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
  });

  it("on a failed press marks each blank field, says so above Next, focuses the first and disables Next", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    await type(el, "firstNames", "Alba");
    await type(el, "displayName", "Alba");
    next(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));

    expect(q(el, "[data-test=lastNames]")!.getAttribute("error")).toBe("Enter your last name(s).");
    expect(q(el, "[data-test=email]")!.getAttribute("error")).toBe("Enter your email.");
    expect(q(el, "[data-test=firstNames]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe(FIX_FIELDS);
    const lastNames = q(el, "[data-test=lastNames]")!;
    expect(lastNames.shadowRoot!.activeElement).toBe(lastNames.shadowRoot!.querySelector("input"));
    expect(next(el).hasAttribute("disabled")).toBe(true);
  });

  it("re-checks each change after a failed press, and Next works again once every field is fixed", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    next(el).click();
    await el.updateComplete;

    await type(el, "firstNames", "Alba");
    expect(q(el, "[data-test=firstNames]")!.getAttribute("error")).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(true);

    await type(el, "firstNames", " ");
    expect(q(el, "[data-test=firstNames]")!.getAttribute("error")).toBe(
      "Enter your first name(s).",
    );

    await fillAll(el);
    expect(q(el, "[data-test=pin]")!.getAttribute("error")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(next(el).hasAttribute("disabled")).toBe(false);
    next(el).click();
    expect(events.map((e) => e.kind)).toEqual(["patch", "goto"]);
  });
});

describe("setup-admin-screen layout", () => {
  const top = (el: SetupAdminScreen, field: string) =>
    q(el, `[data-test=${field}]`)!.getBoundingClientRect().top;

  it("explains each field with a hint in the field, and no help buttons", async () => {
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const hints = Object.fromEntries(
      ["firstNames", "lastNames", "displayName", "email", "password", "pin"].map((field) => [
        field,
        q(el, `[data-test=${field}]`)!.getAttribute("hint"),
      ]),
    );
    expect(hints).toEqual({
      firstNames: "As on your ID",
      lastNames: "As on your ID",
      displayName: "The name colleagues see",
      email: "To sign in and recover your account",
      password: "To sign in to the dashboard",
      pin: "Digits, to sign in at the till",
    });
    expect(el.shadowRoot!.querySelector("wt-help-tooltip")).toBeNull();
  });

  it("explains each field in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    expect(q(el, "[data-test=firstNames]")!.getAttribute("hint")).toBe("Como en tu documento");
    expect(q(el, "[data-test=displayName]")!.getAttribute("hint")).toBe(
      "El nombre que ven tus compañeros",
    );
    expect(q(el, "[data-test=email]")!.getAttribute("hint")).toBe(
      "Para entrar y recuperar tu cuenta",
    );
    expect(q(el, "[data-test=password]")!.getAttribute("hint")).toBe("Para entrar en el panel");
    expect(q(el, "[data-test=pin]")!.getAttribute("hint")).toBe("Cifras, para entrar en la caja");
  });

  it("puts first and last name side by side, and password and PIN, where there is room", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    host.style.width = "620px";
    expect(top(el, "lastNames")).toBe(top(el, "firstNames"));
    expect(top(el, "pin")).toBe(top(el, "password"));
    expect(top(el, "displayName")).toBeGreaterThan(top(el, "firstNames"));
    expect(top(el, "email")).toBeGreaterThan(top(el, "displayName"));
  });

  it("stacks every field at phone width", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    host.style.width = "330px";
    expect(top(el, "lastNames")).toBeGreaterThan(top(el, "firstNames"));
    expect(top(el, "pin")).toBeGreaterThan(top(el, "password"));
  });

  it("shows the intro in the muted text colour", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
    expect(getComputedStyle(q(el, ".intro")!).color).toBe("rgb(7, 8, 9)");
  });
});
