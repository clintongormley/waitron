import { Hono } from "hono";
import { expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { run } from "./till-api.js";

it.each(["unchecked", "missing", "invalid", "restart_required"] as const)(
  "answers zone admission %s as a conflict with bounded params",
  async (reason) => {
    const app = new Hono();
    app.post("/economic-write", (c) =>
      run(
        c,
        () => {},
        async () => {
          throw new AppError("venue.time_zone_not_ready", { reason });
        },
      ),
    );
    const response = await app.request("/economic-write", { method: "POST" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "venue.time_zone_not_ready", params: { reason } },
    });
  },
);
