import { afterEach, expect, it } from "vitest";
import { SetupApi } from "../api/client.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "../first-setup-session.js";
import { initial, venue } from "../../test/first-setup-browser.js";
import { mountWidget, cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import { InitialSetupScreen } from "./initial-setup-screen.js";
const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  cleanupWidgets();
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en", "es"] as const)
    for (const stage of ["normal", "proof", "unavailable", "recovery"] as const) {
      it(`${locale} ${theme} ${stage} exposes the generic shell accessibly`, async () => {
        const api = new SetupApi("", async () =>
          Response.json({ state: initial, capability: "A".repeat(43), ownerGeneration: 1 }),
        );
        const session = new FirstSetupSession(api);
        sessions.push(session);
        await session.open();
        await session.claim(venue);
        const { el, host } = await mountWidget<InitialSetupScreen>(
          "setup-initial-setup-screen",
          {
            session,
            locale,
            offerings: [{ module: "fiscal-verifactu", version: "0.0.0" }],
            contributions: stage === "unavailable" ? [] : SETUP_MODULES,
          },
          theme,
        );
        if (stage === "proof") Object.assign(el, { proof: "activation", attempted: true });
        if (stage === "recovery") Object.assign(el, { recovery: true });
        await el.updateComplete;
        await expectNoA11yViolations(host);
        expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
      });
    }
