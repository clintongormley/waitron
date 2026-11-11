import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectEncryptedHostState } from "./disk-start.mjs";
import { planNameTagWrite, NAME_TAG_METADATA_MAX_BYTES } from "./name-tag.mjs";
import { parseHostRequest, formatHostReply } from "./host-protocol.mjs";

export function tagCommand({ now = () => performance.now(), exec = execFileSync } = {}) {
  const deadline = now() + 12_000;
  return (command, args, input) => {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw new Error("tag deadline");
    return exec(command, args, {
      input,
      encoding: "utf8",
      timeout: remaining,
      maxBuffer: NAME_TAG_METADATA_MAX_BYTES,
      env: { ...process.env, LC_ALL: "C" },
    });
  };
}

export async function handleTagWrite(
  line,
  { run = tagCommand(), inspect = () => inspectEncryptedHostState({ run }) } = {},
) {
  const answer = (value) => formatHostReply("tag.write", value);
  const refuse = (reason) => answer({ ok: false, reason });
  const parsed = parseHostRequest(line);
  if (!parsed.ok) return refuse(parsed.reason);
  if (parsed.request.verb !== "tag.write") return refuse("unknown_request");
  let device, plan;
  try {
    const { diskUuid } = await inspect();
    device = `/dev/disk/by-uuid/${diskUuid}`;
    const metadata = await run("cryptsetup", ["luksDump", "--dump-json-metadata", device]);
    plan = planNameTagWrite(Buffer.from(metadata), parsed.request.fields.tag);
  } catch {
    return refuse("header_unreadable");
  }
  if (plan.kind === "refused")
    return refuse(plan.reason === "no-free-token" ? "no_free_token" : "header_unreadable");
  try {
    for (const step of plan.steps) {
      const args = [
        "token",
        step.op === "remove" ? "remove" : "import",
        "--token-id",
        String(step.tokenId),
      ];
      if (step.op === "replace") args.push("--token-replace");
      if (step.op !== "remove") args.push("--json-file", "-");
      args.push(device);
      await run("cryptsetup", args, step.op === "remove" ? undefined : step.json);
    }
    return answer({
      ok: true,
      tag: plan.kind === "write" ? "written" : plan.kind === "remove" ? "removed" : "unchanged",
    });
  } catch (error) {
    return refuse(error.code === "ENOSPC" ? "no_space" : "host_failed");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(await handleTagWrite(readFileSync(0, "utf8")));
  } catch {
    process.stdout.write('{"ok":false,"reason":"host_failed"}\n');
  }
}
