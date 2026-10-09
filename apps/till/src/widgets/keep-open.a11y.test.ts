import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpen } from "./keep-open.js";
import "./keep-open.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("keep-open flow %s", (theme) => {
  it.each(["ready", "absent", "refusal", "manager"])("has no violations when %s", async (state) => {
    const fetcher = vi.fn(
      async (_p: string | URL | Request, i?: RequestInit) =>
        new Response(
          JSON.stringify(
            state === "refusal"
              ? { error: { code: "time_zone.unreadable", params: {} } }
              : i!.method === "PUT"
                ? { error: { code: "authorization.not_permitted", params: {} } }
                : String(_p).endsWith("authorizers")
                  ? [{ personId: "ana", displayName: "Ana" }]
                  : {
                      period: {
                        id: "lunch",
                        name: "Comida",
                        endsAt: "14:00",
                        running: true,
                        extendedUntil: null,
                        dayEndsAt: "05:00",
                        choices: ["14:30", "05:00"],
                        next: null,
                      },
                    },
          ),
          {
            status: state === "refusal" || i!.method === "PUT" ? 403 : 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const { el, host } = await mountWidget<TillKeepOpen>(
      "till-keep-open",
      {
        api: new TillApi("", fetcher),
        zoneId: "z",
        keepOpen:
          state === "absent"
            ? null
            : {
                periodId: "lunch",
                periodName: "Comida",
                endsAt: "14:00",
                running: true,
                extendedUntil: null,
              },
      },
      theme,
    );
    expect(el.shadowRoot).not.toBeNull();
    if (state === "refusal" || state === "manager") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
      if (state === "refusal")
        await expect.poll(() => el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
      else {
        await expect
          .poll(() => el.shadowRoot!.querySelector("till-keep-open-dialog"))
          .not.toBeNull();
        const d = el.shadowRoot!.querySelector("till-keep-open-dialog")!;
        await d.updateComplete;
        d.selected = "14:30";
        await d.updateComplete;
        d.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
        await expect
          .poll(() => el.shadowRoot!.querySelector("till-supervisor-override-dialog"))
          .not.toBeNull();
      }
    }
    await expectNoA11yViolations(host);
  });
});
