import { html, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";

// The browser entry point for the management dashboard. It paints the token layer onto the document
// root and mounts <dashboard-app> against a real, same-origin DashboardApi. The shell consumes that
// api on boot — firstUpdated → #probeSession → api.getMe() (WHOAMI) — to decide whether to open on a
// logged-in face (the business overview for a manager/supervisor/admin, self-service my-schedule for
// staff) or the login screen. Excluded from coverage (see vitest.config.ts): this runs only in a real
// browser at startup.
applyTokens(document.documentElement);

const app = document.querySelector<HTMLElement>("#app")!;
render(html`<dashboard-app .api=${new DashboardApi()}></dashboard-app>`, app);
