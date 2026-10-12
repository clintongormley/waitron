import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp, type DeepPartial, type Screen } from "./setup-app.js";
import type { SetupApi, ProvisionBody } from "./api/client.js";
import type { SetupEmailScreen } from "./screens/email-screen.js";
import type { WtUnsavedChanges } from "@waitron/ui/src/components/wt-unsaved-changes.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const email = {
  server: "smtp.example.com",
  port: 587,
  encryption: "starttls" as const,
  user: "venue",
  password: "secret",
  from: "invoices@example.com",
};
type State = { screen: Screen; draft: DeepPartial<ProvisionBody> };
async function mount(runEmailTest = vi.fn().mockResolvedValue({ accepted: true })) {
  const api = {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({ environment: "production", needs: ["venue"] }),
    getVenueDefaults: vi.fn().mockResolvedValue({}),
    runEmailTest,
  } as unknown as SetupApi;
  const { el } = await mountWidget<SetupApp>("setup-app", { api });
  await vi.waitFor(() => expect((el as unknown as State).screen).toBe("mode"));
  Object.assign(el, {
    screen: "email",
    draft: {
      mode: "live",
      email,
      venue: { admin: { email: "admin@example.com" }, location: { fiscalTerritory: "ES-other" } },
    },
  });
  await el.updateComplete;
  const screen = el.shadowRoot!.querySelector<SetupEmailScreen>("setup-email-screen")!;
  await screen.updateComplete;
  return { el, screen };
}
async function change(screen: SetupEmailScreen, value: string) {
  screen
    .shadowRoot!.querySelector("[data-test=server]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await screen.updateComplete;
}
function back(screen: SetupEmailScreen) {
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
}
const warning = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
async function choose(el: SetupApp, decision: "keep" | "discard") {
  warning(el).dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

describe("Email draft protection", () => {
  it("asks before abandoning an edit, keeps it, then discards it", async () => {
    const { el, screen } = await mount();
    await change(screen, "edited.example.com");
    back(screen);
    await vi.waitFor(() => expect(warning(el).open).toBe(true));
    await choose(el, "keep");
    expect((el as unknown as State).screen).toBe("email");
    expect(leaveCoordinatorFor(screen)!.isDirty([screen])).toBe(true);
    back(screen);
    await vi.waitFor(() => expect(warning(el).open).toBe(true));
    await choose(el, "discard");
    await vi.waitFor(() => expect((el as unknown as State).screen).toBe("venue"));
    expect((el as unknown as State).draft.email).toEqual(email);
  });
  it.each(["before", "after"])("keeps an edit made %s removal dirty on reconnect", async (when) => {
    const { el, screen } = await mount();
    if (when === "before") await change(screen, "edited.example.com");
    const parent = screen.parentElement!;
    screen.remove();
    await screen.updateComplete;
    parent.append(screen);
    await screen.updateComplete;
    if (when === "after") await change(screen, "edited.example.com");
    expect(leaveCoordinatorFor(screen)!.isDirty([screen])).toBe(true);
    back(screen);
    await vi.waitFor(() => expect(warning(el).open).toBe(true));
    await choose(el, "keep");
    expect(
      (screen.shadowRoot!.querySelector("[data-test=server]") as HTMLElement & { value: string })
        .value,
    ).toBe("edited.example.com");
  });
  it("keeps failed-test edits protected and commits accepted settings on Continue", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, code: "email.test_refused" })
      .mockResolvedValue({ accepted: true });
    const { el, screen } = await mount(run);
    await change(screen, "edited.example.com");
    const test = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=test]")!;
    test.click();
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toContain(
        "refused",
      ),
    );
    expect(leaveCoordinatorFor(screen)!.isDirty([screen])).toBe(true);
    test.click();
    await vi.waitFor(() =>
      expect(
        (
          screen.shadowRoot!.querySelector("[data-test=next]") as HTMLElement & {
            disabled: boolean;
          }
        ).disabled,
      ).toBe(false),
    );
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await vi.waitFor(() => expect((el as unknown as State).screen).toBe("review"));
    expect(warning(el).open).toBe(false);
    expect((el as unknown as State).draft.email?.server).toBe("edited.example.com");
  });
});
