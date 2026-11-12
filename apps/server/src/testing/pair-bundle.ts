import type { MirrorBundle, PairStoreKey } from "../mirror-bundle.js";

/** The pair's store key a fixture bundle carries. */
export const PAIR_STORE: PairStoreKey = {
  accessKeyId: "waitron0123456789abcdef",
  secretAccessKey: "ab".repeat(32),
  venueId: "pair-venue",
};

/** The main box's address and the pair's key, for a fixture bundle or `assembleMirrorBundle`'s deps. */
export const PAIR_BUNDLE_FIELDS: Pick<MirrorBundle, "primaryUrl" | "store"> = {
  primaryUrl: "https://box.deli.test",
  store: PAIR_STORE,
};
