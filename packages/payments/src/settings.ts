import { defineSettingsDocument, readSettings, type Database, type Transaction } from "@waitron/db";
import type { ModulePermission } from "@waitron/module";

export const PAYMENTS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "payments.providers.manage", defaultHolders: [] },
];
export const OTHER_CARD_MACHINE_DESTINATIONS = ["connected_account", "other"] as const;
export const OTHER_CARD_MACHINE_NAME_MAX = 60;
export interface OtherCardMachine {
  id: string;
  name: string;
  paysInto: (typeof OTHER_CARD_MACHINE_DESTINATIONS)[number];
}
interface PaymentsDocument {
  providers: Record<string, boolean>;
  tipsEnabled: boolean;
  testProviders: boolean;
  otherCardMachines: OtherCardMachine[];
}

const MACHINE_KEYS = ["id", "name", "paysInto"];

/** The field (`id`, `name` or `paysInto`) a machine's own value fails on, or null. */
export function otherCardMachineFault(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "id";
  const entry = value as Record<string, unknown>;
  const extra = Object.keys(entry).find((key) => !MACHINE_KEYS.includes(key));
  if (extra !== undefined) return extra;
  if (typeof entry.id !== "string" || entry.id === "") return "id";
  if (
    typeof entry.name !== "string" ||
    entry.name.trim() === "" ||
    entry.name.trim().length > OTHER_CARD_MACHINE_NAME_MAX
  )
    return "name";
  if (!OTHER_CARD_MACHINE_DESTINATIONS.includes(entry.paysInto as OtherCardMachine["paysInto"]))
    return "paysInto";
  return null;
}

export function otherCardMachineNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function parseOtherCardMachines(value: unknown): OtherCardMachine[] | null {
  if (!Array.isArray(value) || value.some((entry) => otherCardMachineFault(entry) !== null))
    return null;
  const machines = value as OtherCardMachine[];
  const ids = new Set(machines.map((machine) => machine.id));
  const names = new Set(machines.map((machine) => otherCardMachineNameKey(machine.name)));
  if (ids.size !== machines.length || names.size !== machines.length) return null;
  return machines.map(({ id, name, paysInto }) => ({ id, name, paysInto }));
}

export const PAYMENTS_SETTINGS = defineSettingsDocument<PaymentsDocument>({
  module: "payments",
  version: 1,
  transfers: ["tipsEnabled", "otherCardMachines"] satisfies (keyof PaymentsDocument)[],
  defaults: () => ({
    providers: {},
    tipsEnabled: false,
    testProviders: false,
    otherCardMachines: [],
  }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    const extra = Object.keys(value).find(
      (key) => !["providers", "tipsEnabled", "testProviders", "otherCardMachines"].includes(key),
    );
    if (extra !== undefined) return { ok: false, field: extra };
    const { tipsEnabled = false, testProviders = false } = value;
    if (typeof tipsEnabled !== "boolean") return { ok: false, field: "tipsEnabled" };
    if (typeof testProviders !== "boolean") return { ok: false, field: "testProviders" };
    if (
      typeof value.providers !== "object" ||
      value.providers === null ||
      Array.isArray(value.providers)
    )
      return { ok: false, field: "providers" };
    if (Object.values(value.providers).some((enabled) => typeof enabled !== "boolean"))
      return { ok: false, field: "providers" };
    const otherCardMachines = parseOtherCardMachines(value.otherCardMachines ?? []);
    if (otherCardMachines === null) return { ok: false, field: "otherCardMachines" };
    return {
      ok: true,
      doc: {
        providers: { ...value.providers } as Record<string, boolean>,
        tipsEnabled,
        testProviders,
        otherCardMachines,
      },
    };
  },
});

export function readPaymentsSettings(db: Database | Transaction) {
  return readSettings(db, PAYMENTS_SETTINGS);
}
