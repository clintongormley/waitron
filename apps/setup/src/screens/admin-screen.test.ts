import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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

afterEach(cleanupWidgets);

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
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=email]")!.hasAttribute("invalid")).toBe(true);
    expect(q(el, "[data-test=displayName]")!.hasAttribute("invalid")).toBe(false);
  });

  it("blocks Next and shows a banner when a field is blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "Alba");
    // password + pin left blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    const summary = q(el, "[data-test=error]") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await summary.updateComplete;
    expect(summary.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
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

  it("clears the banner once the fields are filled and Next succeeds", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).not.toBeNull();
    await type(el, "firstNames", "Alba");
    await type(el, "lastNames", "Ramos");
    await type(el, "displayName", "Alba");
    await type(el, "email", "alba@example.com");
    await type(el, "password", "pw");
    await type(el, "pin", "1234");
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=error]")).toBeNull();
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

async function summaryItems(el: SetupAdminScreen): Promise<string[]> {
  const summary = q(el, "[data-test=error]") as
    (HTMLElement & { updateComplete: Promise<unknown> }) | null;
  if (summary === null) return [];
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((li) => li.textContent!.trim());
}

// The summary is read as rendered words, so a missing label ("Enter your undefined.") fails here.
it.each([
  ["first", "firstNames", "lastNames", "Enter your first name."],
  ["last", "lastNames", "firstNames", "Enter your last name."],
] as const)(
  "does not advance without a %s name, and names it in the summary",
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
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, `[data-test=${blank}]`)!.hasAttribute("invalid")).toBe(true);
    expect(q(el, `[data-test=${filled}]`)!.hasAttribute("invalid")).toBe(false);
    expect(await summaryItems(el)).toEqual([message]);
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
