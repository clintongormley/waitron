// Weaker than its name: literal app.get/post registrations in server src only; no computed paths or new namespaces.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { PEER_ROUTES } from "../apps/server/test/peer-route-inventory.js";

const ROOT = join(import.meta.dirname, "../apps/server/src");
const known = new Set(PEER_ROUTES.map(([method, path]) => `${method} ${path}`));
const relevant = (path: string) =>
  path === "/api/node" ||
  path.startsWith("/api/node/") ||
  /^\/management-api\/(handover|promote|mirror-bundle|return-clashes)(\/|$)/.test(path);

function unclassified(source: string): string[] {
  const file = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === "app" &&
      ["get", "post"].includes(node.expression.name.text)
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && relevant(arg.text)) {
        const key = `${node.expression.name.text.toUpperCase()} ${arg.text}`;
        if (!known.has(key)) found.push(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

it("every literal peer or handover route is in the mounted size inventory", () => {
  const missing = readdirSync(ROOT, { recursive: true }).flatMap((entry) => {
    const name = String(entry);
    const path = join(ROOT, name);
    if (
      !name.endsWith(".ts") ||
      name.includes(".test.") ||
      name.startsWith("testing/") ||
      !statSync(path).isFile()
    )
      return [];
    return unclassified(readFileSync(path, "utf8")).map((key) => `${name}: ${key}`);
  });
  expect(missing).toEqual([]);
});

it("finds new multiline registrations without mistaking client URLs for routes", () => {
  expect(unclassified('app.post(\n "/api/node/unbounded", handler);')).toEqual([
    "POST /api/node/unbounded",
  ]);
  expect(unclassified('fetch("/api/node/unbounded"); const path = "/api/node/unbounded";')).toEqual(
    [],
  );
  expect(unclassified('app.post(\n "/api/node/backup-settings", handler);')).toEqual([]);
});

it("classifies the existing read-only peer operation exemptions", () => {
  const paths = [
    ...readFileSync(join(ROOT, "read-only-exemptions.ts"), "utf8").matchAll(/path:\s*"([^"]+)"/g),
  ]
    .map((match) => match[1]!)
    .filter(relevant);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.filter((path) => !known.has(`POST ${path}`))).toEqual([]);
});
