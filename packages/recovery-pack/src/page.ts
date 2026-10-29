import type { PartKind } from "./i18n/pack-words.js";

/** One part's page, in the reader's language, as the part's owner describes it. */
export type RecoveryPackPage = {
  title: string;
  intro?: string;
  rows: { label: string; value: string }[];
  secret?: { label: string; text: string; qr: true };
  notes: string[];
};

export type ServerKeyLocation =
  | { kind: "this-pack" }
  | { kind: "pack"; number: number; madeOn: string; received: boolean }
  | { kind: "sheet"; keyName: string; madeOn: string };

export type PackPart = {
  kind: PartKind;
  state: "included" | "absent" | "failed" | "not-set-up";
  /** Required when `state` is `included`. */
  page?: RecoveryPackPage;
  /** Required when `state` is `failed`. */
  failure?: { what: string; todo: string };
  /** A day, `YYYY-MM-DD`. */
  lastChanged?: string;
  check?: string;
  /** Replaces the catalogue's reason on the cover for an `absent` or `not-set-up` part. */
  absentReason?: string;
  serverKeyLocation?: ServerKeyLocation;
};
