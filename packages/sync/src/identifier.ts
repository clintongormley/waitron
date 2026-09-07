// A replication identifier — a subscription, publication, or physical table name. These names are
// derived from the module classification (table names are `[a-z_]+`, guard-enforced in S1) or are
// fixed subscription/publication names, so this is validate-and-throw, NOT an escaper: a name
// outside the set is a wiring bug, refused loudly, never quoted around. Internal to @waitron/sync
// (publications.ts + subscriptions.ts share it); not on the barrel.
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`unsafe replication identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}
