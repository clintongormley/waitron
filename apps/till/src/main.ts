import { html, render } from "lit";
import {
  applyTokens,
  setMediaServer,
  startWithPopover,
  startThemeChoice,
  startVenueTheme,
} from "@waitron/ui";
import {
  BUILD_CHANGED_EVENT,
  createInstrumentedFetch,
  installErrorCapture,
  watchBuild,
} from "@waitron/diagnostics";
import { TillApi } from "./api/client.js";
import { withDevDeviceHeader } from "./api/dev-device.js";
import { ServerRouter, withServerTarget } from "./api/server-router.js";
import { diag, setReportBuild } from "./diagnostics.js";
import { installPressBuzz } from "./press-buzz.js";
import { watchKeyboardInsets } from "./state/keyboard-inset.js";
import { isTrustBroken } from "./trust-check.js";
import { trustInstructions } from "./trust-instructions.js";
import "./till-app.js";

const watchedFetch = watchBuild(fetch, {
  origin: location.origin,
  onFirstBuild: setReportBuild,
  onChange: () => window.dispatchEvent(new Event(BUILD_CHANGED_EVENT)),
});
const router = new ServerRouter({ origin: location.origin, fetchImpl: watchedFetch });
setMediaServer(router.current);
router.addEventListener("server-changed", () => setMediaServer(router.current));
applyTokens(document.documentElement);
// `/api/theme` reads no session or device, so its fetch skips the dev device header.
startVenueTheme(document.documentElement, {
  fetchImpl: createInstrumentedFetch(withServerTarget(watchedFetch, router), diag),
});
startThemeChoice(document.documentElement);

installErrorCapture(window, diag);
installPressBuzz(document);
watchKeyboardInsets(window, document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;

startWithPopover(
  () => {
    void bootTill();
  },
  (error) =>
    diag.record("error", "ui.popover_load_failed", {
      errorType: error instanceof Error ? error.name : "Unknown",
    }),
);

async function bootTill(): Promise<void> {
  if (await isTrustBroken()) {
    render(trustInstructions(), app);
    return;
  }
  const fetchImpl = createInstrumentedFetch(
    withDevDeviceHeader(withServerTarget(watchedFetch, router)),
    diag,
  );
  router.start();

  render(html`<till-app .api=${new TillApi("", fetchImpl)} .router=${router}></till-app>`, app);
}
