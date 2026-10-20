import { expect, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import { wizardApi, venue } from "./first-setup-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const selection = {
  inspectionId: "a".repeat(64),
  revision: 7,
  ownerGeneration: 3,
  workspaceId: "683b117f-b8b2-4609-b5a1-509b45671a86",
  selectionGeneration: 2,
};
export const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`);
export async function click(app: SetupApp, name: string) {
  await userEvent.click(q<WtButton>(app, name)!.shadowRoot!.querySelector("button")!);
}
export async function enterPassword(app: SetupApp) {
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
}
export async function selectionFixture(
  options: {
    intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
    locale?: "en-GB" | "es-ES";
    theme?: "light" | "dark";
    wait?: boolean;
  } = {},
) {
  const fixture = wizardApi({
    intercept(path, body, headers) {
      const custom = options.intercept?.(path, body, headers);
      if (custom !== undefined) return custom;
      if (path.endsWith("/first-setup/status"))
        return Response.json({ claimed: true, resolution: true });
      if (path.endsWith("/resolution/selection")) return Response.json(selection);
      if (path.endsWith("/resolution/resume-selection"))
        return Response.json({
          workspaceId: selection.workspaceId,
          selectionGeneration: 2,
          restarting: true,
        });
      if (path.endsWith("/resolution"))
        return Response.json(
          { error: { code: "setup.attempt_uncertain", params: {} } },
          { status: 409 },
        );
    },
  });
  const selectionRead = vi.spyOn(fixture.api, "inspectFirstSetupWorkspaceSelection");
  const { el: app, host } = await mountWidget<SetupApp>(
    "setup-app",
    { api: fixture.api, browserLanguages: [options.locale ?? "en-GB"] },
    options.theme,
  );
  if (options.wait !== false) await expect.poll(() => q(app, "screen-first-owner")).not.toBeNull();
  await app.updateComplete;
  return { app, host, selectionRead, ...fixture };
}
