import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

export async function copyUp(
  store: Store,
  fromPrefix: string,
  toPrefix: string,
  opts: { propagateDeletions: boolean },
): Promise<{ copied: number; deleted: number }> {
  assertDistinctPrefixes(fromPrefix, toPrefix);

  const sourceKeys = await store.listKeys(fromPrefix);
  const sourceSuffixes = new Set(sourceKeys.map((key) => key.slice(fromPrefix.length)));

  for (const key of sourceKeys) {
    await store.client.send(
      new CopyObjectCommand({
        Bucket: store.bucket,
        // The rig generates keys from a restricted alphabet, so `CopySource` needs no escaping.
        CopySource: `${store.bucket}/${key}`,
        Key: `${toPrefix}${key.slice(fromPrefix.length)}`,
      }),
    );
  }

  let deleted = 0;
  if (opts.propagateDeletions) {
    // Delete obsolete destination keys only after every source object has been copied.
    for (const key of await store.listKeys(toPrefix)) {
      if (sourceSuffixes.has(key.slice(toPrefix.length))) continue;
      await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
      deleted += 1;
    }
  }

  return { copied: sourceKeys.length, deleted };
}

// Overlapping prefixes would let the source listing include the destination's objects.
function assertDistinctPrefixes(fromPrefix: string, toPrefix: string): void {
  if (fromPrefix === toPrefix) {
    throw new Error(`copyUp was given one prefix twice: ${fromPrefix}`);
  }
  if (fromPrefix.startsWith(toPrefix) || toPrefix.startsWith(fromPrefix)) {
    throw new Error(`copyUp prefixes overlap: ${fromPrefix} and ${toPrefix}`);
  }
}
