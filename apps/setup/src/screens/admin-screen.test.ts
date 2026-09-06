import { userEvent } from "@vitest/browser/context";
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

/** Types `value` into the wt-input at `[data-test=field]` by firing its composed `wt-change`. */
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
  });

  it("collects the four fields and advances to venue with the admin patch", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
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

  // The email non-empty guard: it is the admin's dashboard-login credential, required like the rest.
  it("blocks Next and marks email invalid when email is left blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
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

  // The non-empty guard. Prove-by-deletion: drop the `invalid.size > 0` return and this flips red —
  // a blank Next would then emit and advance.
  it("blocks Next and shows a banner when a field is blank", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {});
    const events = collect(host);
    await type(el, "displayName", "Alba");
    // password + pin left blank
    q(el, "[data-test=next]")!.click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(q(el, "[data-test=error]")).not.toBeNull();
    expect(q(el, "[data-test=error]")!.getAttribute("role")).toBe("alert");
    // The blank fields are marked invalid; the filled one is not.
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

  // Fix 1: the shell renders `<setup-admin-screen .draft>`, so a `venue`→Back→`admin` return must
  // restore the operator's typed credentials (password + PIN included) rather than blanking them.
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

  // The seed-once (`#seeded`) guard, mirroring venue-screen's. Prove-by-deletion: drop the
  // `if (this.#seeded) return; this.#seeded = true;` guard in `willUpdate` and this flips red — the
  // shell's per-merge `draft` reassignment would re-seed `password` back to "reseeded", losing the edit.
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
