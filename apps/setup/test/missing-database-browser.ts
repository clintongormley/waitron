import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import type { FirstSetupInspection, StartAgainSummary } from "../src/api/first-setup-types.js";
import { wizardApi } from "./first-setup-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`);
export async function click(app: SetupApp, name: string) {
  await userEvent.click(q<WtButton>(app, name)!.shadowRoot!.querySelector("button")!);
}
export const namedSummary: StartAgainSummary = { reached: "named" };
export const damagedSummary: StartAgainSummary = { ...namedSummary, recoveryRecordDamaged: true };
export async function missingDatabaseFixture(
  options: {
    intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
    summary?: StartAgainSummary;
    theme?: "light" | "dark";
    locale?: "en-GB" | "es-ES";
  } = {},
) {
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const custom = options.intercept?.(path, body, headers);
      if (custom !== undefined) return custom;
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "a".repeat(64),
          pair: "valid",
          database: "missing",
          emptyDatabase: false,
          revision: 1,
          ownerGeneration: 1,
          artifacts: [],
        } satisfies FirstSetupInspection);
      if (path.endsWith("/start-again/summary"))
        return Response.json(options.summary ?? namedSummary);
      if (path.endsWith("/start-again")) return Response.json({ restarting: true });
    },
  });
  const { el: app, host } = await mountWidget<SetupApp>(
    "setup-app",
    {
      api: fixture.api,
      browserLanguages: [options.locale ?? "en-GB"],
    },
    options.theme,
  );
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  return { app, host, ...fixture };
}
/** Presses Start again and waits for the box's answer: the ask, a refusal or an error. */
export async function openMissing(app: SetupApp) {
  await click(app, "start-again");
  await expect
    .poll(
      () =>
        q(app, "missing-reached") ??
        q(app, "start-again-refused") ??
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].find((f) => f.error) ??
        null,
    )
    .not.toBeNull();
  await app.updateComplete;
}
