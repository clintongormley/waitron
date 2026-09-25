import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { TillApi } from "./api/client.js";
import { withDevDeviceHeader } from "./api/dev-device.js";
import { ServerRouter, withServerTarget } from "./api/server-router.js";
import { diag } from "./diagnostics.js";
import { isTrustBroken } from "./trust-check.js";
import "./till-app.js";

applyTokens(document.documentElement);

installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;

void bootTill();

async function bootTill(): Promise<void> {
  if (await isTrustBroken()) {
    render(trustInstructions(), app);
    return;
  }
  const router = new ServerRouter({ origin: location.origin, fetchImpl: fetch });
  const fetchImpl = createInstrumentedFetch(
    withDevDeviceHeader(withServerTarget(fetch, router)),
    diag,
  );
  router.start();

  render(html`<till-app .api=${new TillApi("", fetchImpl)} .router=${router}></till-app>`, app);
}

// Links to the landing page on the default port: a non-default landing port cannot be recovered here.
function trustInstructions() {
  return html`
    <main style="max-width:32rem;margin:4rem auto;padding:0 1.5rem;font:inherit">
      <h1>This device hasn't trusted the till yet</h1>
      <p>
        The till is served over HTTPS with the venue box's own certificate, which this device does
        not recognise yet. Install the box's certificate, then reopen the till.
      </p>
      <p><a href="http://${location.hostname}/">Open the setup page for instructions</a></p>
    </main>
  `;
}
