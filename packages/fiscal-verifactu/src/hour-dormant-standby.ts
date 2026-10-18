import "./errors.js";
import { isDeepStrictEqual as equal } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, readTenant, type Transaction } from "@waitron/db";
import {
  readOperationAuthority,
  type ModuleOperationHost,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
  type OperationBinding,
  type ProvisionedNode,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { isHourAllocatedSeries } from "./hour-identity.js";
import { liveSeriesBases } from "./reserved-series.js";
import { registroSif } from "./schema/sif.js";
import { publicHourSelectionHistory } from "./hour-selection.js";

interface Dormant {
  kind: "hour-dormant";
  version: 1;
  binding: OperationBinding;
  scope: { taxpayerNif: string; environment: "production" | "preproduction" };
  locationId: string;
  bases: readonly { code: string; purpose: string }[];
}
interface Held {
  operation: ModuleOperationInput;
  input: unknown;
  established?: Dormant;
}
const prepared = new WeakMap<object, Held>();
function refuse(reason = "reservation_mismatch"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isHourDormantInput(value: unknown): boolean {
  return record(value) && value.kind === "hour-dormant";
}
function readDormant(value: unknown): Dormant {
  if (
    !exact(value, ["kind", "version", "binding", "scope", "locationId", "bases"]) ||
    value.kind !== "hour-dormant" ||
    value.version !== 1 ||
    !exact(value.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
    !Object.values(value.binding).every(
      (item) => typeof item === "string" && item.trim().length > 0,
    ) ||
    value.binding.module !== "fiscal-verifactu" ||
    value.binding.action !== "reserve" ||
    value.binding.sourceId === value.binding.targetNodeId ||
    !exact(value.scope, ["taxpayerNif", "environment"]) ||
    typeof value.scope.taxpayerNif !== "string" ||
    !value.scope.taxpayerNif.trim() ||
    !["production", "preproduction"].includes(value.scope.environment as string) ||
    typeof value.locationId !== "string" ||
    !value.locationId.trim() ||
    !Array.isArray(value.bases) ||
    !value.bases.every(
      (base) =>
        exact(base, ["code", "purpose"]) &&
        typeof base.code === "string" &&
        typeof base.purpose === "string",
    ) ||
    !isHourAllocatedSeries(
      value.bases.map((base) => ({ code: `${base.code}-0000`, purpose: base.purpose })),
      "0000",
      value.bases,
    )
  )
    return refuse();
  return structuredClone(value) as unknown as Dormant;
}
function retained(values: readonly unknown[]): Dormant[] {
  const result: Dormant[] = [];
  publicHourSelectionHistory(values);
  for (const value of values) {
    if (!record(value) || value.dormant === undefined) continue;
    if (!Array.isArray(value.dormant)) return refuse();
    for (const raw of value.dormant) {
      const candidate = readDormant(raw);
      const previous = result.find(
        (old) => old.binding.targetNodeId === candidate.binding.targetNodeId,
      );
      if (previous !== undefined && !equal(previous, candidate)) return refuse();
      if (previous === undefined) result.push(candidate);
    }
  }
  return result;
}
export function readRetainedHourDormant(
  values: readonly unknown[],
  binding: OperationBinding,
): Dormant {
  const matches = retained(values).filter(
    (value) => value.binding.targetNodeId === binding.targetNodeId,
  );
  if (matches.length !== 1 || matches[0]!.binding.sourceId !== binding.sourceId) return refuse();
  return matches[0]!;
}
export function createHourDormantPreparation(
  host?: ModuleOperationHost,
): ModuleOperationPreparation {
  return {
    async prepare(supplied, run) {
      const operation = { ...supplied, binding: Object.freeze({ ...supplied.binding }) };
      const check = () => {
        const operator = readOperationAuthority(operation.authority, operation.binding)?.operatorId;
        if (typeof operator !== "string") return refuse("reauthentication_required");
        if (
          operation.binding.module !== "fiscal-verifactu" ||
          !["reserve", "establish"].includes(operation.binding.action)
        )
          return refuse("event_mismatch");
      };
      check();
      const input = structuredClone(operation.input);
      if (operation.binding.action === "reserve") {
        if (
          !exact(input, ["kind", "version"]) ||
          input.kind !== "hour-dormant" ||
          input.version !== 1
        )
          return refuse();
      } else {
        const dormant = readDormant(input);
        if (!equal(dormant.binding, { ...operation.binding, action: "reserve" })) return refuse();
      }
      const token = Object.freeze({});
      const held: Held = { operation, input };
      const body = async () => {
        prepared.set(token, held);
        try {
          const result = await run(Object.freeze({ ...operation, input: token }));
          check();
          return result;
        } finally {
          prepared.delete(token);
        }
      };
      if (operation.binding.action === "reserve") return body();
      if (host?.withPreparationState === undefined) return refuse("outside_confirmation_missing");
      return host.withPreparationState(operation.binding, async (state) => {
        const known = retained([...state.history, ...(state.value === null ? [] : [state.value])]);
        const dormant = readDormant(input);
        const previous = known.find(
          (old) => old.binding.targetNodeId === dormant.binding.targetNodeId,
        );
        if (previous !== undefined && !equal(previous, dormant)) return refuse();
        const result = await body();
        if (held.established !== undefined && previous === undefined) {
          check();
          const current = state.value;
          // A crash before this write leaves admission incomplete; promotion requires the retained configuration.
          await state.replace({
            version: 1,
            entries: record(current) ? current.entries : [],
            dormant: [...known, held.established],
          });
          check();
        }
        return result;
      });
    },
  };
}
function heldFor(
  operation: ModuleOperationInput | undefined,
  action: string,
  node: ProvisionedNode,
): Held | undefined {
  const held = record(operation?.input) ? prepared.get(operation.input) : undefined;
  if (held === undefined) return undefined;
  if (
    operation === undefined ||
    readOperationAuthority(operation.authority, operation.binding) === undefined
  )
    return refuse("reauthentication_required");
  if (
    operation.authority !== held.operation.authority ||
    !equal(operation.binding, held.operation.binding) ||
    operation.binding.action !== action
  )
    return refuse("event_mismatch");
  if (operation.binding.targetNodeId !== node.nodeId) return refuse("node_mismatch");
  return held;
}
async function configuration(
  tx: Transaction,
  primary: ProvisionedNode,
  standby: ProvisionedNode,
  binding: OperationBinding,
  requireTarget: boolean,
): Promise<Dormant> {
  if (
    primary.nodeId === standby.nodeId ||
    primary.locationId !== standby.locationId ||
    binding.sourceId !== primary.nodeId
  )
    return refuse("node_mismatch");
  const [source] = await tx.select().from(nodes).where(eq(nodes.id, primary.nodeId));
  const [target] = await tx.select().from(nodes).where(eq(nodes.id, standby.nodeId));
  if (
    source?.locationId !== primary.locationId ||
    (requireTarget && target === undefined) ||
    (target !== undefined && target.locationId !== standby.locationId)
  )
    return refuse("node_mismatch");
  const [activeSif] = await tx
    .select()
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, standby.nodeId), isNull(registroSif.revocadoEn)))
    .limit(1);
  const [activeSeries] = await tx
    .select()
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, standby.nodeId), isNull(invoiceSeries.retiredAt)))
    .limit(1);
  if (activeSif !== undefined || activeSeries !== undefined)
    return refuse("standby_already_active");
  const tenant = await readTenant(tx);
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  const environment = stamp?.environment;
  if (tenant === null || tenant.country !== "ES") return refuse("taxpayer_missing");
  if (environment !== "production" && environment !== "preproduction")
    return refuse("environment_unstamped");
  const [sif] = await tx
    .select()
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, primary.nodeId), isNull(registroSif.revocadoEn)))
    .limit(1);
  if (sif === undefined) return refuse("primary_not_registered");
  if (sif.nif !== tenant.taxId) return refuse("scope_mismatch");
  return readDormant({
    kind: "hour-dormant",
    version: 1,
    binding: { ...binding, action: "reserve" },
    scope: { taxpayerNif: tenant.taxId, environment },
    locationId: standby.locationId,
    bases: await liveSeriesBases(tx, primary),
  });
}
export async function reserveHourDormant(
  tx: Transaction,
  primary: ProvisionedNode,
  standby: ProvisionedNode,
  operation?: ModuleOperationInput,
) {
  if (heldFor(operation, "reserve", standby) === undefined) return undefined;
  const state = await configuration(tx, primary, standby, operation!.binding, false);
  heldFor(operation, "reserve", standby);
  return { state };
}
export async function establishHourDormant(
  tx: Transaction,
  standby: ProvisionedNode,
  state: unknown,
  operation?: ModuleOperationInput,
): Promise<boolean> {
  const held = heldFor(operation, "establish", standby);
  if (held === undefined) return false;
  const dormant = readDormant(state);
  if (!equal(dormant, held.input)) return refuse();
  const primary = {
    nodeId: operation!.binding.sourceId as ProvisionedNode["nodeId"],
    locationId: standby.locationId,
  };
  const current = await configuration(tx, primary, standby, operation!.binding, true);
  if (!equal(current, dormant)) return refuse();
  heldFor(operation, "establish", standby);
  held.established = dormant;
  return true;
}
