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
