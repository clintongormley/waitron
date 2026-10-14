import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ModuleRouteContext } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import { STAFFING_ROUTES } from "./routes.js";

describe("STAFFING_ROUTES", () => {
  it("mounts no route yet", () => {
    const app = new Hono();
    STAFFING_ROUTES.mount(app, {} as ModuleRouteContext, {} as Logger);
    expect(app.routes).toEqual([]);
  });
});
