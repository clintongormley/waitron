import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { TillApi } from "./api/client.js";
import { withDevDeviceHeader } from "./api/dev-device.js";
import { ServerRouter, withServerTarget } from "./api/server-router.js";
import { diag } from "./diagnostics.js";
import "./till-app.js";

// The browser entry point for the Counter POS till. It paints the token layer onto the document root
// and mounts <till-app> — the root element that runs the whole walk-up sale (lock → counter → ticket →
// new sale) against a real, same-origin TillApi. No icons are registered: nothing in the till renders
// an <wt-icon> yet, so there is none to preload. Excluded from coverage (see vitest.config.ts): this
// runs only in a real browser at startup, not under the test runner.
applyTokens(document.documentElement);

// Crash capture + an instrumented fetch feed the one per-session diagnostics trail: window errors and
// every API round trip land in `diag`, shared with <till-app>'s nav logging via ./diagnostics.js.
// The fetch chain wraps the raw `fetch` inside-out: `withServerTarget` (innermost) rewrites a relative
// `/api/...` path onto the router's current server just before the real call; `withDevDeviceHeader` adds
// the dev per-tab device override (SP-C); `createInstrumentedFetch` (outermost) records the round trip.
// Instrumentation and the dev header therefore see the request as TillApi composed it — the relative
// path — and the router's origin rewrite is the last step. The trail logs the masked PATHNAME (e.g.
// `/api/node`), never the origin, so which server answered a rerouted request is not visible in the log.
// The dev override is inert unless this tab has stored a device id in sessionStorage.
installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;
// The till holds one router (till-reroute §4.1): it probes the venue's servers and points `current` at
// the one accepting sales, and `withServerTarget` retargets each request onto it. `start()` after the
// chain is built so the first probe round runs.
const router = new ServerRouter({ origin: location.origin, fetchImpl: fetch });
const fetchImpl = createInstrumentedFetch(
  withDevDeviceHeader(withServerTarget(fetch, router)),
  diag,
);
router.start();

// ONE boot path (device-enrolment §3.1): always mount <till-app>. The device front door — the dev
// device chooser and the enrolment screen — lives inside the app's boot decision now, not a separate
// `?dev` mount, so a fresh browser, a dev tab and an enrolled device all enter through the same element.
render(html`<till-app .api=${new TillApi("", fetchImpl)} .router=${router}></till-app>`, app);
