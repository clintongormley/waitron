import { html, render } from "lit";
import { applyTokens, startThemeChoice, startVenueTheme } from "@waitron/ui";
import {
  BUILD_CHANGED_EVENT,
  createInstrumentedFetch,
  installErrorCapture,
  watchBuild,
} from "@waitron/diagnostics";
import { TillApi } from "./api/client.js";
import { withDevDeviceHeader } from "./api/dev-device.js";
import { ServerRouter, withServerTarget } from "./api/server-router.js";
import { diag } from "./diagnostics.js";
import { isTrustBroken } from "./trust-check.js";
import "./till-app.js";

const watchedFetch = watchBuild(fetch, {
  origin: location.origin,
  onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
});
applyTokens(document.documentElement);
// `/api/theme` reads no session or device and is asked of the page's own origin, so its fetch
// skips the router and the dev device header.
startVenueTheme(document.documentElement, {
  fetchImpl: createInstrumentedFetch(watchedFetch, diag),
});
startThemeChoice(document.documentElement);

installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;

void bootTill();

async function bootTill(): Promise<void> {
  if (await isTrustBroken()) {
    render(trustInstructions(), app);
    return;
  }
  const router = new ServerRouter({ origin: location.origin, fetchImpl: watchedFetch });
  const fetchImpl = createInstrumentedFetch(
    withDevDeviceHeader(withServerTarget(watchedFetch, router)),
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
