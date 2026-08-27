import { afterEach, describe, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";

// A minimal real-Chromium mount, inlined rather than pulled from a shared test-helpers module (the
// dashboard's mountWidget assigns @property objects; the setup shell takes none yet). It mirrors that
// helper's shape: a fresh themed host per test, cleaned up afterwards. Importing ./setup-app.js above
// registers the `setup-app` custom element via its @customElement decorator.

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

async function mountSetupApp(): Promise<SetupApp> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);

  const el = document.createElement("setup-app") as SetupApp;
  host.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("setup-app", () => {
  it("renders the setup heading", async () => {
    const el = await mountSetupApp();
    const heading = el.shadowRoot!.querySelector("h1");
    expect(heading?.textContent).toContain("Set up this Waitron box");
  });
});
