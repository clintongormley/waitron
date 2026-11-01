import { expect, it } from "vitest";
import type { DeploymentMode, SingletonRole } from "@waitron/db";
import { systemClock } from "./till-backend.js";
import { nodeId } from "@waitron/shared";
import { moduleRecordGeneration } from "./module-record-generation.js";
import { TradingAdmission } from "./trading-admission.js";

it("admits a trading primary and observes later loss and return of write authority", () => {
  const trading = new TradingAdmission();
  trading.admit();
  let mode: DeploymentMode = "primary";
  let role: SingletonRole = "primary";
  let fenced = false;
  const generation = moduleRecordGeneration({
    nodeId: nodeId(crypto.randomUUID()),
    environment: "preproduction",
    clock: systemClock(),
    trading,
    mode: () => mode,
    role: () => role,
    fenced: () => fenced,
  });
  expect(() => generation.requireWritable()).not.toThrow();
  mode = "mirror";
  expect(() => generation.requireWritable()).toThrowError(
    expect.objectContaining({ code: "node.read_only" }),
  );
  mode = "primary";
  role = "secondary";
  expect(() => generation.requireWritable()).toThrowError(
    expect.objectContaining({ code: "node.read_only" }),
  );
  role = "primary";
  fenced = true;
  expect(() => generation.requireWritable()).toThrowError(
    expect.objectContaining({ code: "node.read_only" }),
  );
  fenced = false;
  expect(() => generation.requireWritable()).not.toThrow();
});

it("keeps module record generation closed until trading admission is ready", () => {
  const trading = new TradingAdmission();
  const generation = moduleRecordGeneration({
    nodeId: nodeId(crypto.randomUUID()),
    environment: "preproduction",
    clock: systemClock(),
    trading,
    mode: () => "primary",
    role: () => "primary",
    fenced: () => false,
  });
  expect(() => generation.requireWritable()).toThrowError(
    expect.objectContaining({ code: "venue.time_zone_not_ready", params: { reason: "unchecked" } }),
  );
  trading.admit();
  expect(() => generation.requireWritable()).not.toThrow();
  trading.requireRestart();
  expect(() => generation.requireWritable()).toThrowError(
    expect.objectContaining({
      code: "venue.time_zone_not_ready",
      params: { reason: "restart_required" },
    }),
  );
});
