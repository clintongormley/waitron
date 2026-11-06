import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { liveDisplayNameKey, loginEmailKey, pendingEmailKey, persons } from "./persons.js";

const dialect = new SQLiteSyncDialect();

function render(fragment: SQL): string {
  return dialect.sqlToQuery(fragment).sql;
}

function indexExpression(name: string): string {
  const index = getTableConfig(persons).indexes.find((each) => each.config.name === name);
  const [part, ...rest] = index!.config.columns;
  expect(rest).toEqual([]);
  if (!is(part, SQL)) throw new Error(`${name} is not over an expression`);
  return render(part);
}

// The callers pre-check a unique index by comparing against these keys, so a key that drifts from its
// index lets a duplicate through to the database's refusal.
describe("the keys the persons unique indexes are over", () => {
  it.each([
    ["persons_tenant_email_uq", loginEmailKey],
    ["persons_tenant_live_display_name_uq", liveDisplayNameKey],
    ["persons_tenant_pending_email_uq", pendingEmailKey],
  ] as const)("%s is over the same expression its key function builds", (name, key) => {
    expect(render(key())).toBe(indexExpression(name));
  });
});
