import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "../src/first-setup-session.js";
import type { FirstSetupInspection, FirstSetupState } from "../src/api/first-setup-types.js";
import { initial, venue, wizardApi } from "./first-setup-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`);
export async function click(app: SetupApp, name: string) {
  await userEvent.click(q<WtButton>(app, name)!.shadowRoot!.querySelector("button")!);
}
export async function missingDatabaseFixture(
  options: {
    intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
    recoveredStatus?: FirstSetupState["status"];
    sameTab?: boolean;
    theme?: "light" | "dark";
    locale?: "en-GB" | "es-ES";
  } = {},
) {
  let recovered = false;
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const custom = options.intercept?.(path, body, headers);
      if (custom !== undefined) return custom;
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: (recovered ? "b" : "a").repeat(64),
          pair: "valid",
          database: "missing",
          emptyDatabase: false,
          password: "checkable",
          revision: recovered ? 2 : 1,
          ownerGeneration: recovered ? 2 : 1,
          repairEligible: false,
          artifacts: [],
        } satisfies FirstSetupInspection);
      if (path.endsWith("/resolution/recover")) {
        recovered = true;
        return Response.json({
          state: {
            ...initial,
            revision: 2,
            ownerGeneration: 2,
            status: options.recoveredStatus ?? "claimed",
            consumptionIntent: !["claimed", "abandoned"].includes(
              options.recoveredStatus ?? "claimed",
            ),
          },
          capability: "B".repeat(43),
          ownerGeneration: 2,
        });
      }
      if (path.endsWith("/start-again"))
        return Response.json({
          workspaceId: "successor",
          selectionGeneration: 1,
          restarting: true,
        });
    },
  });
  if (options.sameTab)
    sessionStorage.setItem(
      FIRST_SETUP_SESSION_KEY,
      JSON.stringify({
        version: 1,
        clientClaimNonce: "N".repeat(43),
        claimPending: false,
        owner: {
          attemptId: initial.attemptId,
          revision: 1,
          ownerGeneration: 1,
          capability: "A".repeat(43),
        },
      }),
    );
  const { el: app, host } = await mountWidget<SetupApp>(
    "setup-app",
    {
      api: fixture.api,
      browserLanguages: [options.locale ?? "en-GB"],
    },
    options.theme,
  );
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  return { app, host, ...fixture };
}
export async function recoverMissing(app: SetupApp) {
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
  await click(app, "resume");
  await expect
    .poll(() => JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner?.ownerGeneration)
    .toBe(2);
  await app.updateComplete;
}
