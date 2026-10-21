export function resolveBackupKeyInputs(input: {
  secretsEnv: Uint8Array;
  tradingEnv: Uint8Array;
  backupEnv: Uint8Array | null;
}): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const contents of [input.secretsEnv, input.tradingEnv, input.backupEnv]) {
    if (contents === null) continue;
    for (const raw of Buffer.from(contents).toString("utf8").split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return Object.freeze(values);
}
