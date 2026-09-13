import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connection-screen.js";
import type { SetupConnectionScreen } from "./connection-screen.js";

/**
 * Every distinct rendering, in both themes. The red "not secure" words matter here: colour is the
 * one thing an axe contrast check can catch that reading the template cannot, and the dead-end state
 * removes the only focusable control after the link, so its keyboard order changes shape.
 */
const STATES: { name: string; props: Partial<SetupConnectionScreen> }[] = [
  { name: "the question alone", props: {} },
  {
    name: "a failure worth retrying",
    props: {
      errorMessage: "We could not reach the server. Check its power and your network connection.",
    },
  },
  {
    name: "a server that cannot be set up from here",
    props: {
      errorMessage: "This server is already set up. Reload to open it.",
      setupUnavailable: true,
    },
  },
  { name: "a check in flight", props: { checking: true } },
];

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("connection screen (%s)", (theme) => {
  it.each(STATES)("stays accessible showing $name", async ({ props }) => {
    const { host } = await mountWidget<SetupConnectionScreen>(
      "setup-connection-screen",
      props,
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
