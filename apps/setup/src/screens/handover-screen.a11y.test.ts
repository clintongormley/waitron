import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { SetupHandoverScreen } from "./handover-screen.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
describe.each(["en-GB", "es-ES"])("handover page %s", (locale) => {
  it.each(["light", "dark"] as const)(
    "is accessible while waiting, ready, refused and complete in %s",
    async (theme) => {
      setLocale(locale);
      for (const value of [
        { state: "prepared", waitingReason: "handover.no_room_to_place" },
        { state: "filing_assumed", copyPlaced: true },
        { state: "activated" },
        { state: "abandoned" },
      ]) {
        const fetcher = vi.fn<typeof fetch>(
          async () =>
            new Response(
              JSON.stringify({
                body: {
                  operationId: "move",
                  role: "destination",
                  scenario: "controlled",
                  sourceNodeId: "old",
                  destinationNodeId: "new",
                  waitingReason: null,
                  ...value,
                },
              }),
            ),
        );
        const { el, host } = await mountWidget<SetupHandoverScreen>(
          "setup-handover-screen",
          { api: new SetupApi("", fetcher), operationId: "move" },
          theme,
        );
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector('[role="status"], wt-input')).not.toBeNull(),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
        await expectNoA11yViolations(host);
        host.remove();
      }
    },
  );
});

describe.each(["en-GB", "es-ES"])("emergency handover %s", (locale) => {
  it.each(["light", "dark"] as const)(
    "is accessible during declaration, resume, refusal and clock check in %s",
    async (theme) => {
      const { page } = await import("vitest/browser");
      setLocale(locale);
      try {
        await page.viewport(390, 2000);
        for (const stage of ["declaration", "resume", "refusal", "clock"]) {
          const api = new SetupApi("", async (input, init) => {
            if (init?.method === "GET")
              return new Response(
                JSON.stringify({
                  body: {
                    operationId: "emergency",
                    role: "destination",
                    scenario: "emergency",
                    state: "emergency_declared",
                    sourceNodeId: "old",
                    destinationNodeId: "new",
                    waitingReason: null,
                  },
                }),
              );
            if (String(input).endsWith("/preview")) {
              if (stage === "refusal")
                return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
                  status: 409,
                });
              return new Response(
                JSON.stringify({
                  sourceNodeId: "old",
                  destinationNodeId: "new",
                  sourceServersUrl: "https://main.example/manage/servers",
                  copy: {
                    source: "mirror-copy",
                    identifier: "a".repeat(64),
                    lastChangeAtMs: 1792147200000,
                  },
                  operation:
                    stage === "declaration"
                      ? null
                      : {
                          operationId: "emergency",
                          reason: "The old box has failed",
                          declaredAtMs: 1792147200000,
                        },
                }),
              );
            }
            throw new Error(`Unexpected request ${String(input)}`);
          });
          const { el, host } = await mountWidget<SetupHandoverScreen>(
            "setup-handover-screen",
            { api, emergency: true },
            theme,
          );
          for (const [name, value] of [
            ["email", "owner@example.com"],
            ["password", "synthetic-password"],
          ]) {
            const field = el.shadowRoot!.querySelector<
              HTMLElement & { updateComplete: Promise<unknown> }
            >(`[name="handover-${name}"]`)!;
            await field.updateComplete;
            const input = field.shadowRoot!.querySelector("input")!;
            input.value = value!;
            input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            await el.updateComplete;
          }
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=emergency-preview]")!.click();
          await vi.waitFor(() => expect(Reflect.get(el, "busy")).toBe(false));
          await el.updateComplete;
          if (stage === "clock") {
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=authenticate]")!.click();
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("vf-recovery-hour")).not.toBeNull(),
            );
          }
          await expectNoA11yViolations(host);
          if (
            import.meta.env.VITE_A1018_VISUAL === "1" &&
            ["declaration", "clock"].includes(stage)
          ) {
            for (const width of [390, 1280]) {
              await page.viewport(width, 2000);
              expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
              await page.screenshot({
                path: `__screenshots__/a1018-emergency-${locale}-${theme}-${stage}-${width}.png`,
              });
            }
            await page.viewport(390, 2000);
          }
          host.remove();
        }
      } finally {
        await page.viewport(1280, 720);
      }
    },
  );
});
