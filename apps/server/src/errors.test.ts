import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createErrorBoundary } from "@waitron/server-kit";
import "./errors.js";

// Each case constructs a code with the params errors.ts declares for it. That typechecks only
// because the side-effect import above loads errors.ts's `declare module` augmentation; AppError
// does no runtime validation of the code, so a missing registration fails the typecheck, not the run.
describe("the zone error codes carry their declared params", () => {
  it("constructs zone.not_found with the qualified zoneId, matching table.not_found's shape", () => {
    const zoneId = "11111111-1111-1111-1111-111111111111";
    const error = new AppError("zone.not_found", { zoneId });
    expect(error.code).toBe("zone.not_found");
    expect(error.params).toEqual({ zoneId });
  });

  it("constructs zone.name_taken with the operator-supplied name, matching table.label_taken's shape", () => {
    const error = new AppError("zone.name_taken", { name: "Terraza" });
    expect(error.code).toBe("zone.name_taken");
    expect(error.params).toEqual({ name: "Terraza" });
  });
});

// `placement.invalid` carries the field NAME only, never the offending value.
describe("the placement error code carries its declared params", () => {
  it("constructs placement.invalid naming the offending field, never the value", () => {
    const error = new AppError("placement.invalid", { field: "posX" });
    expect(error.code).toBe("placement.invalid");
    expect(error.params).toEqual({ field: "posX" });
  });
});

describe("the station error codes carry their declared params", () => {
  it("constructs station.name_taken with the operator-supplied name, matching zone.name_taken's shape", () => {
    const error = new AppError("station.name_taken", { name: "Cocina" });
    expect(error.code).toBe("station.name_taken");
    expect(error.params).toEqual({ name: "Cocina" });
  });

  it("constructs station.not_found with the qualified stationId, matching zone.not_found's shape", () => {
    const stationId = "22222222-2222-2222-2222-222222222222";
    const error = new AppError("station.not_found", { stationId });
    expect(error.code).toBe("station.not_found");
    expect(error.params).toEqual({ stationId });
  });

  it("constructs station.no_default naming the misconfigured location", () => {
    const locationId = "33333333-3333-3333-3333-333333333333";
    const error = new AppError("station.no_default", { locationId });
    expect(error.code).toBe("station.no_default");
    expect(error.params).toEqual({ locationId });
  });
});

describe("the ticket error code carries its declared params", () => {
  it("constructs ticket.invalid_transition with the qualified ticketItemId", () => {
    const ticketItemId = "44444444-4444-4444-4444-444444444444";
    const error = new AppError("ticket.invalid_transition", { ticketItemId });
    expect(error.code).toBe("ticket.invalid_transition");
    expect(error.params).toEqual({ ticketItemId });
  });
});

describe("the course error codes carry their declared params", () => {
  it("constructs course.name_taken with the operator-supplied name, matching station.name_taken's shape", () => {
    const error = new AppError("course.name_taken", { name: "Entrantes" });
    expect(error.code).toBe("course.name_taken");
    expect(error.params).toEqual({ name: "Entrantes" });
  });

  it("constructs course.not_found with the qualified courseId, matching station.not_found's shape", () => {
    const courseId = "55555555-5555-5555-5555-555555555555";
    const error = new AppError("course.not_found", { courseId });
    expect(error.code).toBe("course.not_found");
    expect(error.params).toEqual({ courseId });
  });
});

describe("the held-ticket error code carries its declared params", () => {
  it("constructs ticket.item_held with the qualified ticketItemId, matching ticket.invalid_transition's shape", () => {
    const ticketItemId = "66666666-6666-6666-6666-666666666666";
    const error = new AppError("ticket.item_held", { ticketItemId });
    expect(error.code).toBe("ticket.item_held");
    expect(error.params).toEqual({ ticketItemId });
  });
});

// The no-param device codes carry nothing: the device cookie is a bearer secret, and a throttle or
// a shut window is not a fact about the caller.
describe("the device error codes carry their declared params", () => {
  it("constructs device.unauthorized with no params (a bearer device cookie is never echoed)", () => {
    const error = new AppError("device.unauthorized", {});
    expect(error.code).toBe("device.unauthorized");
    expect(error.params).toEqual({});
  });

  it("constructs device.forbidden_station naming the item's station, matching station.not_found's shape", () => {
    const stationId = "77777777-7777-7777-7777-777777777777";
    const error = new AppError("device.forbidden_station", { stationId });
    expect(error.code).toBe("device.forbidden_station");
    expect(error.params).toEqual({ stationId });
  });

  it("constructs device.forbidden_action naming the refused action (the order-only fiscal boundary)", () => {
    const error = new AppError("device.forbidden_action", { action: "record_sale" });
    expect(error.code).toBe("device.forbidden_action");
    expect(error.params).toEqual({ action: "record_sale" });
  });

  it("constructs device.pairing_closed with no params (nothing about the window is the joiner's)", () => {
    const error = new AppError("device.pairing_closed", {});
    expect(error.code).toBe("device.pairing_closed");
    expect(error.params).toEqual({});
  });

  it("constructs device.not_found with the qualified deviceId, matching station.not_found's shape", () => {
    const deviceId = "88888888-8888-8888-8888-888888888888";
    const error = new AppError("device.not_found", { deviceId });
    expect(error.code).toBe("device.not_found");
    expect(error.params).toEqual({ deviceId });
  });

  it("constructs device.join_rate_limited with no params (a blanket throttle names no caller)", () => {
    const error = new AppError("device.join_rate_limited", {});
    expect(error.code).toBe("device.join_rate_limited");
    expect(error.params).toEqual({});
  });
});

describe("the mirror error codes carry no params", () => {
  it("constructs mirror.not_provisioned with no params (the refusal names no row)", () => {
    const error = new AppError("mirror.not_provisioned", {});
    expect(error.code).toBe("mirror.not_provisioned");
    expect(error.params).toEqual({});
  });

  it("constructs mirror.no_relay with no params (the refusal names no row)", () => {
    const error = new AppError("mirror.no_relay", {});
    expect(error.code).toBe("mirror.no_relay");
    expect(error.params).toEqual({});
  });

  it("constructs mirror.bundle_fetch_failed with no params (the refusal names no row)", () => {
    const error = new AppError("mirror.bundle_fetch_failed", {});
    expect(error.code).toBe("mirror.bundle_fetch_failed");
    expect(error.params).toEqual({});
  });
});

describe("the drawer error code carries its declared params and maps to HTTP 400", () => {
  it("constructs drawer.no_printer naming the misconfigured till, matching station.no_default's shape", () => {
    const tillId = "99999999-9999-9999-9999-999999999999";
    const error = new AppError("drawer.no_printer", { tillId });
    expect(error.code).toBe("drawer.no_printer");
    expect(error.params).toEqual({ tillId });
  });

  it("maps drawer.no_printer to HTTP 400 via the default a status map takes when the code is absent", async () => {
    const tillId = "99999999-9999-9999-9999-999999999999";
    // No entry for drawer.no_printer, so the assertion below exercises the `?? 400` fallback.
    const status: Record<string, never> = {};
    const boundary = createErrorBoundary(status, "drawer.failed");
    const app = new Hono();
    app.get("/boom", (c) =>
      boundary(
        c,
        () => {},
        () => Promise.reject(new AppError("drawer.no_printer", { tillId })),
      ),
    );

    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "drawer.no_printer", params: { tillId } } });
  });
});
