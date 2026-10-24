import { afterEach, describe, it, vi } from "vitest";
import { startVenueTheme, VENUE_THEME_STORAGE_KEY } from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-lock-screen.js";
import type { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";

const roster: StaffMember[] = [
  { personId: "p1", displayName: "Ana" },
  { personId: "p2", displayName: "Ben" },
];

function stubApi(overrides: Partial<Record<"listStaff" | "login", unknown>> = {}): TillApi {
  return {
    listStaff: vi.fn().mockResolvedValue(roster),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillLockScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function enterPin(el: TillLockScreen, digits: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>('wt-button.operator-button[data-person="p1"]')!.click();
  await el.updateComplete;
  for (const digit of digits) {
    const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
    await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!.click();
    await el.updateComplete;
  }
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-lock-screen a11y (%s theme)", (theme) => {
  it("has no violations on the staff-picker view", async () => {
    const { el, host } = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the PIN entry view", async () => {
    const { el, host } = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>(
      'wt-button.operator-button[data-person="p1"]',
    )!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the empty-roster state", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the load-failed banner (.status + .error, its own colour combo)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the server-status line (two rows + waiting, role=status)", async () => {
    const { el, host } = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      {
        api: stubApi(),
        serverStatuses: [
          {
            url: "https://box.deli.test",
            label: "box.deli.test",
            state: "unreachable",
            term: null,
          },
          { url: "https://cloud.deli.test", label: "cloud.deli.test", state: "standby", term: 2 },
        ],
        serverWaiting: true,
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the PIN-error banner", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "pin.invalid" }) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await enterPin(el, "9999");
    el.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "till-lock-screen a11y with a venue logo (%s theme)",
  (theme) => {
    afterEach(() => {
      localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
      startVenueTheme(document.documentElement, {
        fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
      });
    });

    async function mountWithLogo() {
      const answer = {
        ...FIXTURE_ANSWER,
        hash: "logo-hash",
        logo: { light: png(120, 40), dark: null },
      };
      localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
      startVenueTheme(document.documentElement, {
        fetchImpl: () => new Promise<Response>(() => {}),
      });
      const loads = nextLogoLoad();
      const mounted = await mountWidget<TillLockScreen>(
        "till-lock-screen",
        { api: stubApi(), legalName: "Bar Pepe SL" },
        theme,
      );
      await flush(mounted.el);
      await loads;
      return mounted;
    }

    it("has no violations on the staff-picker view with a logo and Powered by", async () => {
      const { el, host } = await mountWithLogo();
      await el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "wt-powered-by",
      )!.updateComplete;
      await expectNoA11yViolations(host);
    });

    it("has no violations on the PIN entry view with a logo and Powered by", async () => {
      const { el, host } = await mountWithLogo();
      el.shadowRoot!.querySelector<HTMLElement>(
        'wt-button.operator-button[data-person="p1"]',
      )!.click();
      await el.updateComplete;
      await expectNoA11yViolations(host);
    });
  },
);
