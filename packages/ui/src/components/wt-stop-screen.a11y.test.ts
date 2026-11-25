import { afterEach, describe, expect, test, vi } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-stop-screen in %s", (theme) => {
  test.each(["<p>Tell a manager.</p>", "<wt-button>Open Box status</wt-button>"])(
    "has an accessible modal with %s",
    async (body) => {
      const stop = await mountThemed(
        `<wt-stop-screen open heading="Disk full">${body}</wt-stop-screen>`,
        theme,
      );
      await vi.waitFor(() => expect(stop.shadowRoot?.querySelector("dialog:modal")).toBeTruthy());
      await expectNoA11yViolations(host);
    },
  );
});
