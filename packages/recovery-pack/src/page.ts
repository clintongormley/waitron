import type { PartKind } from "./i18n/pack-words.js";

/** One part's page, in the reader's language, as the part's owner describes it. */
export type RecoveryPackPage = {
  title: string;
  intro?: string;
  rows: { label: string; value: string; mono?: true }[];
  address?: { label: string; text: string; qr: true };
  secret?: { label: string; text: string; qr: true };
  notes: string[];
};

export type PackPart = {
  kind: PartKind;
  state: "included" | "absent" | "failed" | "not-set-up";
  /** Required when `state` is `included`. */
  page?: RecoveryPackPage;
  /** Required when `state` is `failed`. */
  failure?: { what: string; todo: string };
};
