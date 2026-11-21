import { createRequire } from "node:module";
import { URL } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(new URL("../apps/till/package.json", import.meta.url));
const { PlaywrightBrowserProvider } = await import(require.resolve("@vitest/browser-playwright"));

function commandsContext(frames) {
  const asked = [];
  const located = [];
  const fakePage = {
    frame(name) {
      asked.push(name);
      return frames[name] ?? null;
    },
    frameLocator(selector) {
      located.push(selector);
      return { selector };
    },
  };
  const context = PlaywrightBrowserProvider.prototype.getCommandsContext.call(
    { getPage: () => fakePage, contexts: new Map() },
    "s",
  );
  return { context, asked, located };
}

it("binds a command to the named test frame present when it starts", () => {
  const testFrame = { name: "the test frame" };
  const { context, asked, located } = commandsContext({ "vitest-iframe": testFrame });
  expect(context.iframe).toBe(testFrame);
  expect(asked).toEqual(["vitest-iframe"]);
  expect(located).toEqual([]);
});

it("fails a command that starts while no test frame exists, rather than waiting for the next one", () => {
  const { context, located } = commandsContext({});
  expect(() => context.iframe).toThrow(/vitest-iframe/);
  expect(located).toEqual([]);
});
