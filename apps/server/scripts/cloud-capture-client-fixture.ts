import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createCloudConnection } from "../src/cloud-client.js";
import { uploadCloudCapture } from "../src/cloud-backup-upload.js";
const root = await realpath(resolve(process.env.CLOUD_TEST_ROOT ?? ""));
assert(
  root.startsWith((await realpath(tmpdir())) + sep) && root.includes("cloud-integration-backup-"),
);
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  assert(input.length < 65536);
}
const request = JSON.parse(input);
const saved = JSON.parse(await readFile(join(root, "cloud-connection.json"), "utf8"));
const client = createCloudConnection({
  stateDir: root,
  origin: saved.origin,
  localVenueId: saved.localVenueId,
  environment: saved.environment,
});
let result;
if (request.command === "reserve") result = await client.reserveCapture(request.id);
else if (request.command === "publish")
  result = await client.publishCapture(request.id, request.metadata);
else if (request.command === "upload")
  result = await uploadCloudCapture(
    request.grant,
    await readFile(join(root, "captured.backup.enc")),
    { ca: request.ca },
  );
else throw Error("Unknown capture command");
console.log(JSON.stringify(result));
