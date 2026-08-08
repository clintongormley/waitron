import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import "./dashboard-app.js";

// The browser entry point for the management dashboard. It paints the token layer onto the document
// root and mounts <dashboard-app>. Task 2 adds ./api/client.js and wires `.api=${new DashboardApi()}`
// here; until that module exists, mounting the bare element keeps this task's `tsc` clean. Excluded
// from coverage (see vitest.config.ts): this runs only in a real browser at startup.
applyTokens(document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<dashboard-app></dashboard-app>`, app);
