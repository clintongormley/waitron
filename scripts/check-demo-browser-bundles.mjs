import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function javascript(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? javascript(path)
      : entry.isFile() && /\.js$/.test(path)
        ? [path]
        : [];
  });
}
try {
  const apps = process.argv.slice(2);
  if (apps.length !== 2) throw new Error("expected two app directories");
  for (const app of apps) {
    if (!existsSync(app)) throw new Error(`${app}: missing output`);
    const files = javascript(app);
    if (files.length === 0) throw new Error(`${app}: no JavaScript output`);
    const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
    if (!text.includes("Waitron Demo S.L.")) throw new Error(`${app}: missing identity marker`);
    if (text.includes("Croquetes de pernil")) throw new Error(`${app}: contains demo dish`);
  }
  console.log("checked 2 browser bundles: identity retained, demo dishes absent");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
