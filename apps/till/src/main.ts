import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { createInstrumentedFetch, installErrorCapture } from "@waitron/diagnostics";
import { TillApi } from "./api/client.js";
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
installErrorCapture(window, diag);

const app = document.querySelector<HTMLElement>("#app")!;
render(
  html`<till-app .api=${new TillApi("", createInstrumentedFetch(fetch, diag))}></till-app>`,
  app,
);
