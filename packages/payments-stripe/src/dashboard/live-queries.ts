// This provider's dashboard panel drives the payments API imperatively (connect, add-reader, the
// pairing-status poll) and subscribes to no live-data query, so it declares no query dependencies.
// The live-subscriptions guard still requires the file to exist for every package that ships a
// dashboard contribution (scripts/live-subscriptions.test.ts).
export const QUERY_DEPENDENCIES = {} as const;
