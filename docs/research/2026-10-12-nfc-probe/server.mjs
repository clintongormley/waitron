// Serves the NFC probe page and appends every log line the phone sends to results.jsonl.
/* global process, console */
import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8765);
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/manifest.json": ["manifest.json", "application/manifest+json"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
};

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    for await (const chunk of req) body += chunk;
    await appendFile(join(here, "results.jsonl"), body.trim() + "\n");
    console.log(body.trim());
    res.writeHead(204).end();
    return;
  }
  const entry = files[req.url?.split("?")[0] ?? ""];
  if (!entry) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": entry[1], "cache-control": "no-store" });
  res.end(await readFile(join(here, entry[0])));
}).listen(port, "127.0.0.1", () => console.log(`NFC probe on http://localhost:${port}`));
