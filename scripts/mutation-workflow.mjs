/** Reads only the local mutation workflow's block-style callers, not arbitrary YAML or expressions. */
export function mutationCallers(text) {
  const callers = [];
  const blocks = [
    ...text.matchAll(/^ {2}([\w-]+):[^\n]*\n((?: {4}[^\n]*\n|[ \t]*\n| {2}#[^\n]*\n)*)/gm),
  ];
  for (const [, id, body] of blocks) {
    if (!body.includes("    uses: ./.github/workflows/mutation-sharded.yml\n")) continue;
    const value = (name) => new RegExp("^      " + name + ": (.+)$", "m").exec(body)?.[1];
    const pkg = value("package");
    const browser = value("browser");
    const minutes = value("minutes");
    let shards;
    try {
      shards = JSON.parse((value("shards") ?? "").replace(/^['"]|['"]$/g, ""));
    } catch {
      throw new Error(id + ": invalid shard list");
    }
    if (
      !/^[a-z][a-z-]*$/.test(pkg ?? "") ||
      !["true", "false"].includes(browser) ||
      !/^[1-9]\d*$/.test(minutes ?? "") ||
      !Array.isArray(shards) ||
      shards.length === 0 ||
      shards.some((shard, index) => shard !== index + 1)
    )
      throw new Error(id + ": invalid mutation inputs");
    callers.push({
      id,
      body,
      package: pkg,
      browser: browser === "true",
      minutes: Number(minutes),
      shards,
    });
  }
  return callers;
}
