import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "lit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import { active, committed, prepared } from "../../test/conflict-browser-fixture.js";
import type { ConflictRequest } from "../conflict-recovery-contract.js";
import type { ConflictRecovery } from "./conflict-recovery.js";

const size = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  render(null, host);
  cleanup();
  sessionStorage.removeItem("vf-conflict-attempt");
  await page.viewport(size.width, size.height);
});

describe.each(["light", "dark"] as const)("conflict recovery accessibility %s", (theme) => {
  it.each(["en", "es"] as const)(
    "%s renders the public procedure at phone and desktop widths",
    async (locale) => {
      for (const width of [390, 1280]) {
        await page.viewport(width, 1000);
        for (const mode of [
          "initial",
          "conflict",
          "waiting",
          "selected",
          "busy",
          "complete",
          "restart",
          "uncertain",
          "key-refused",
          "rate-limited",
          "clock-refused",
        ] as const) {
          sessionStorage.removeItem("vf-conflict-attempt");
          await mountThemed("<div></div>", theme);
          const request: DashboardRequest = async <T>(
            _path: string,
            _method: string,
            raw?: unknown,
            options?: import("@waitron/dashboard-kit").RequestOptions,
          ) => {
            const body = raw as ConflictRequest;
            if (mode === "key-refused") throw { code: "promotion.break_glass_invalid" };
            if (mode === "rate-limited") throw { code: "recovery.rate_limited" };
            if (body.command.kind === "status") {
              if (mode === "uncertain" && body.conflict !== undefined)
                throw { code: "connection.failed" };
              return {
                kind: "status",
                active: [active],
                event: { kind: mode === "restart" ? "restart-required" : "none" },
              } as T;
            }
            if (body.command.kind === "activate") {
              if (mode === "busy")
                return new Promise<T>((_resolve, reject) =>
                  options!.signal!.addEventListener(
                    "abort",
                    () => reject({ code: "connection.cancelled" }),
                    { once: true },
                  ),
                );
              if (mode === "uncertain") throw { code: "connection.failed" };
              return {
                kind: "committed",
                result: { ...committed, activationEventId: body.eventId },
              } as T;
            }
            if (mode === "waiting" && body.command.proposal.action === "select")
              return {
                kind: "prepared",
                value: { status: "waiting", remainingMs: 120000, targetMs: Date.now() + 120000 },
              } as T;
            if (mode === "clock-refused" && body.command.proposal.action === "compare-clocks")
              return {
                kind: "prepared",
                value: {
                  id: "comparison-1",
                  clock: {
                    usable: [],
                    unavailable: [],
                    secondClock: false,
                    disagreement: false,
                    releaseBlocked: false,
                    rangeBlocked: false,
                  },
                },
              } as T;
            return prepared(body) as T;
          };
          render(VERIFACTU_DASHBOARD.publicPages![0]!.create({ request, locale }).render(), host);
          const screen = host.querySelector("vf-conflict-recovery") as ConflictRecovery;
          await screen.updateComplete;
          const q = (action: string) =>
            screen.shadowRoot!.querySelector<HTMLElement>(`[data-action=${action}]`)!;
          if (mode !== "initial") {
            const field = screen.shadowRoot!.querySelector("wt-input")!;
            await (field as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
            await userEvent.fill(field.shadowRoot!.querySelector("input")!, "CURRENT_PRIVATE_KEY");
            await userEvent.click(q("inspect"));
            if (!["key-refused", "rate-limited"].includes(mode))
              await vi.waitFor(() =>
                expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
              );
            else
              await vi.waitFor(() =>
                expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
              );
            if (
              ["waiting", "selected", "busy", "complete", "uncertain", "clock-refused"].includes(
                mode,
              )
            ) {
              for (const field of screen.shadowRoot!.querySelectorAll("wt-switch")) {
                await field.updateComplete;
                await userEvent.click(field.shadowRoot!.querySelector("input")!);
              }
              await userEvent.click(q("compare"));
              if (mode === "waiting")
                await vi.waitFor(() =>
                  expect(screen.shadowRoot!.querySelector("[data-wait]")).not.toBeNull(),
                );
              else if (mode === "clock-refused")
                await vi.waitFor(() =>
                  expect(screen.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
                );
              else await vi.waitFor(() => expect(q("switch")).not.toBeNull());
              if (mode === "complete" || mode === "uncertain" || mode === "busy") {
                await userEvent.click(q("switch"));
                await vi.waitFor(() =>
                  expect(
                    screen.shadowRoot!.querySelector(
                      mode === "complete"
                        ? "[data-complete]"
                        : mode === "busy"
                          ? "[data-action=switch][loading]"
                          : "[data-action=inspect]",
                    ),
                  ).not.toBeNull(),
                );
              }
            }
          }
          await screen.updateComplete;
          await expectNoA11yViolations(host);
          expect(screen.getBoundingClientRect().width).toBeLessThanOrEqual(width);
          expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth);
          expect(screen.shadowRoot!.innerHTML).not.toContain("CURRENT_PRIVATE_KEY");
          await page.screenshot({
            path: `__screenshots__/w41s7-${locale}-${theme}-${width}-${mode}.png`,
          });
          render(null, host);
          cleanup();
        }
      }
    },
    120000,
  );
});
