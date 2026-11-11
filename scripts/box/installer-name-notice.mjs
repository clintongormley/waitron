import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WAITRON_LAYOUTS } from "./disk-state.mjs";
import { decodeNameTag, findNameTag, NAME_TAG_METADATA_MAX_BYTES } from "./name-tag.mjs";

export async function installerNameNotice(target, run) {
  const deadline = performance.now() + 12_000;
  run ??= (command, args) => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) throw new Error("reader deadline");
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: remaining,
      maxBuffer: NAME_TAG_METADATA_MAX_BYTES,
      env: { ...process.env, LC_ALL: "C" },
    });
  };
  try {
    const layout = JSON.parse(await run("sfdisk", ["--json", target])).partitiontable;
    const part = layout?.partitions?.[2];
    if (layout?.label !== "gpt" || part?.node !== `${target}3`) return null;
    const marker = WAITRON_LAYOUTS.find(
      (value) =>
        typeof part.type === "string" &&
        value.typeGuid === part.type.toLowerCase() &&
        value.partitionName === part.name,
    );
    if (!marker) return null;
    // With locks disabled cryptsetup reports recovery needs without repairing this offline disk.
    const header = await run("cryptsetup", ["--disable-locks", "--debug", "luksDump", part.node]);
    const subsystem = /^Subsystem:\s*(.*?)\s*$/m.exec(header)?.[1];
    if (
      /requires recovery|header checksum error/i.test(header) ||
      !/^Version:\s+2\s*$/m.test(header) ||
      subsystem !== marker.subsystem
    )
      return null;
    const metadata = await run("cryptsetup", [
      "--disable-locks",
      "luksDump",
      "--dump-json-metadata",
      part.node,
    ]);
    const bytes = findNameTag(Buffer.from(metadata));
    const tag = bytes === null ? null : decodeNameTag(bytes);
    return `This box already has Waitron (${tag?.name ?? "Venue name unavailable"}).`;
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const notice = process.argv.length === 3 ? await installerNameNotice(process.argv[2]) : null;
  if (notice === null) process.exitCode = 1;
  else console.log(notice);
}
