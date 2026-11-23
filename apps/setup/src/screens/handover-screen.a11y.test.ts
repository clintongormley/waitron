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
                  timeZone: "Europe/Madrid",
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
    "is accessible while the main server answers, during declaration, resume, refusal, clock check and the take's waits in %s",
    async (theme) => {
      const { page } = await import("vitest/browser");
      setLocale(locale);
      /** With VITE_EMERGENCY_SHOTS=1, saves the page as a person sees it at 400px. */
      const shoot = async (stage: string) => {
        if (import.meta.env.VITE_EMERGENCY_SHOTS !== "1") return;
        await page.viewport(400, 900);
        await page.screenshot({
          path: `__screenshots__/emergency-${stage}-${locale}-${theme}.png`,
        });
        await page.viewport(390, 2000);
      };
      try {
        await page.viewport(390, 2000);
        for (const stage of [
          "main-checking",
          "main-answering",
          "explanation",
          "declaration",
          "different-copy",
          "resume",
          "refusal",
          "clock",
          "waiting",
          "held",
        ]) {
          const api = new SetupApi("", async (input, init) => {
            if (stage.startsWith("main-") && String(input) === "/api/node/main")
              return new Response(JSON.stringify({ mainUrl: "https://main.example" }));
            if (String(input) === "/api/node/main")
              return new Response(JSON.stringify({ mainUrl: null, silentForMs: 65_000 }));
            if (String(input) === "https://main.example/api/node")
              return stage === "main-checking" ? new Promise(() => {}) : new Response(null);
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
                    timeZone: "Europe/Madrid",
                  },
                }),
              );
            if (String(input).endsWith("/followed"))
              return stage === "waiting" || stage === "different-copy"
                ? new Response(
                    JSON.stringify({ state: stage === "waiting" ? "catching-up" : "taken" }),
                  )
                : new Response(JSON.stringify({ error: { code: "handover.chain_broken" } }), {
                    status: 409,
                  });
            if (String(input).endsWith("/preview")) {
              if (stage === "refusal")
                return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
                  status: 409,
                });
              return new Response(
                JSON.stringify({
                  sourceNodeId: "old",
                  destinationNodeId: "new",
                  sourceServersUrl: "https://main.example/servers",
                  copy: {
                    ...(stage === "declaration" || stage === "different-copy"
                      ? { source: "followed-copy", sourceId: "c".repeat(64) }
                      : { source: "mirror-copy" }),
                    identifier: "a".repeat(64),
                    lastChangeAtMs: 1792147200000,
                  },
                  joinedAtMs: 1789819200000,
                  operation: ["declaration", "different-copy", "waiting", "held"].includes(stage)
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
          if (stage === "main-checking" || stage === "main-answering") {
            await vi.waitFor(() =>
              expect(
                el.shadowRoot!.querySelector(
                  stage === "main-checking" ? "wt-spinner" : "[data-test=main-check-again]",
                ),
              ).not.toBeNull(),
            );
            await expectNoA11yViolations(host);
            await shoot(stage);
            if (stage === "main-answering") {
              el.shadowRoot!.querySelector("details")!.open = true;
              await expectNoA11yViolations(host);
              await shoot(`${stage}-open`);
            }
            host.remove();
            continue;
          }
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-test=start-switching]")).not.toBeNull(),
          );
          if (stage === "explanation") {
            await expectNoA11yViolations(host);
            await shoot(stage);
            host.remove();
            continue;
          }
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=start-switching]")!.click();
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector('[name="handover-email"]')).not.toBeNull(),
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
          if (stage === "waiting")
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector('[role="status"]')).not.toBeNull(),
            );
          if (stage === "held")
            await vi.waitFor(
              () =>
                expect(el.shadowRoot!.querySelector("[data-test=emergency-held]")).not.toBeNull(),
              { timeout: 10_000 },
            );
          if (stage === "different-copy") {
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-test=emergency-copy]")).not.toBeNull(),
            );
            await el.updateComplete;
            await expectNoA11yViolations(host);
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload-backup]")!.click();
            await vi.waitFor(() =>
              expect(
                el.shadowRoot!.querySelector('wt-file-input[name="handover-backup"]'),
              ).not.toBeNull(),
            );
          }
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

describe.each(["en-GB", "es-ES"])("emergency switch pages %s", (locale) => {
  it.each(["light", "dark"] as const)(
    "Preparing the venue while it works and when done, Ready to switch, and a reopened switch are accessible in %s",
    async (theme) => {
      const { page } = await import("vitest/browser");
      setLocale(locale);
      /** With VITE_EMERGENCY_SHOTS=1, saves the page as a person sees it at 400px. */
      const shoot = async (stage: string) => {
        if (import.meta.env.VITE_EMERGENCY_SHOTS !== "1") return;
        await page.viewport(400, 900);
        await page.screenshot({ path: `__screenshots__/3c-${stage}-${locale}-${theme}.png` });
      };
      let takes = 0;
      const statusBody = {
        operationId: "emergency",
        role: "destination",
        scenario: "emergency",
        state: "emergency_declared",
        sourceNodeId: "old",
        destinationNodeId: "new",
        waitingReason: null,
        timeZone: "Europe/Madrid",
      };
      const api = new SetupApi("", async (input, init) => {
        const path = String(input);
        if (path === "/api/node/main")
          return new Response(JSON.stringify({ mainUrl: null, silentForMs: 65_000 }));
        if (init?.method === "GET") return new Response(JSON.stringify({ body: statusBody }));
        if (path.endsWith("/followed"))
          return new Response(JSON.stringify({ state: takes++ < 1 ? "catching-up" : "taken" }));
        if (path.endsWith("/preview"))
          return new Response(
            JSON.stringify({
              sourceNodeId: "old",
              destinationNodeId: "new",
              sourceServersUrl: "https://main.example/servers",
              copy: {
                source: "followed-copy",
                sourceId: "c".repeat(64),
                identifier: "a".repeat(64),
                lastChangeAtMs: 1792147200000,
              },
              joinedAtMs: 1789819200000,
              operation: null,
            }),
          );
        throw new Error(`Unexpected request ${path}`);
      });
      try {
        await page.viewport(400, 2000);
        const { el, host } = await mountWidget<SetupHandoverScreen>(
          "setup-handover-screen",
          { api, emergency: true },
          theme,
        );
        const root = el.shadowRoot!;
        await vi.waitFor(() =>
          expect(root.querySelector("[data-test=start-switching]")).not.toBeNull(),
        );
        root.querySelector<HTMLElement>("[data-test=start-switching]")!.click();
        await vi.waitFor(() =>
          expect(root.querySelector('[name="handover-email"]')).not.toBeNull(),
        );
        for (const [name, value] of [
          ["email", "owner@example.com"],
          ["password", "synthetic-password"],
        ]) {
          const field = root.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
            `[name="handover-${name}"]`,
          )!;
          await field.updateComplete;
          const input = field.shadowRoot!.querySelector("input")!;
          input.value = value!;
          input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          await el.updateComplete;
        }
        root.querySelector<HTMLElement>("[data-test=emergency-preview]")!.click();
        await vi.waitFor(() =>
          expect(
            root.querySelector('[data-test=step-follow][data-state="working"]'),
          ).not.toBeNull(),
        );
        await expectNoA11yViolations(host);
        await shoot("06-preparing");
        await vi.waitFor(() => expect(root.querySelector("[data-test=proceed]")).not.toBeNull(), {
          timeout: 5000,
        });
        await el.updateComplete;
        await expectNoA11yViolations(host);
        await shoot("06-done");
        root.querySelector<HTMLElement>("[data-test=upload-backup]")!.click();
        await vi.waitFor(() =>
          expect(root.querySelector('wt-file-input[name="handover-backup"]')).not.toBeNull(),
        );
        await expectNoA11yViolations(host);
        await shoot("06-backup");
        root.querySelector<HTMLElement>("[data-test=proceed]")!.click();
        await vi.waitFor(() =>
          expect(root.querySelector("[data-test=emergency-ready]")).not.toBeNull(),
        );
        await el.updateComplete;
        await expectNoA11yViolations(host);
        await shoot("07-ready");
        host.remove();
        const reopened = await mountWidget<SetupHandoverScreen>(
          "setup-handover-screen",
          { api, operationId: "emergency" },
          theme,
        );
        await vi.waitFor(() =>
          expect(reopened.el.shadowRoot!.querySelector('[name="handover-email"]')).not.toBeNull(),
        );
        await expectNoA11yViolations(reopened.host);
        await shoot("12-reopened");
        reopened.host.remove();
      } finally {
        await page.viewport(1280, 720);
      }
    },
  );
});
