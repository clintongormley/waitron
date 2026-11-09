import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const writes = (text: string) =>
  /\b(?:insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?settings[`"]?(?![\w])|\bupdate(?:\s+or\s+\w+)?\s+(?:[`"]?\w+[`"]?\s*\.\s*)?[`"]?settings[`"]?(?:\s+(?:as\s+)?[`"]?\w+[`"]?)?\s+set\b/i.test(
    text.replace(/--[^\n]*/g, ""),
  );
const root = join(import.meta.dirname, "..");
const files = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    ["drizzle", "triggers"].flatMap((folder) => {
      const dir = join(root, "packages", entry.name, folder);
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((file) => file.isFile() && file.name.endsWith(".sql"))
          .map((file) => `packages/${entry.name}/${folder}/${file.name}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    }),
  );
it("no migration or trigger SQL writes the settings table", () => {
  expect(
    files.filter((file) => writes(readFileSync(join(root, file), "utf8"))),
    "A document's shape changes on read, never in a migration",
  ).toEqual([]);
});
it("sees writes it must refuse and passes a rule on settings", () => {
  for (const text of [
    "INSERT INTO `settings` VALUES (1)",
    "update settings set doc = '{}'",
    "replace into settings values (1)",
    "delete from settings",
    "insert or replace into settings values (1)",
    "update settings as s set doc = '{}'",
    "update main.settings set doc = '{}'",
    "update main.settings s set doc = '{}'",
    'update "main"."settings" as "s" set doc = \'{}\'',
    "insert into main.settings values (1)",
    "delete from main.settings",
    "replace into main.settings values (1)",
  ])
    expect(writes(text)).toBe(true);
  for (const text of [
    "create trigger x before insert on settings when new.module = 'a' begin select raise(abort, 'a'); end",
    "CREATE TABLE `settings` (",
    "-- update settings set doc = '{}'\nselect 1",
    "update settings_other set doc = '{}' ",
    "update main.settings_other s set doc = '{}'",
  ])
    expect(writes(text)).toBe(false);
});
it("reads some SQL including core's starting migration", () => {
  expect(files.length).toBeGreaterThan(0);
  expect(files).toContain("packages/db/drizzle/0000_baseline.sql");
});
