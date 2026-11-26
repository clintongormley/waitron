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
        // Only the restricted alphabet of the rig's replica keys lets `CopySource` stay unescaped.
        CopySource: `${store.bucket}/${key}`,
        Key: `${toPrefix}${key.slice(fromPrefix.length)}`,
      }),
    );
  }

  let deleted = 0;
  if (opts.propagateDeletions) {
    for (const key of await store.listKeys(toPrefix)) {
      if (sourceSuffixes.has(key.slice(toPrefix.length))) continue;
      await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
      deleted += 1;
    }
  }

  return { copied: sourceKeys.length, deleted };
}

/**
 * Equal prefixes would ask S3 to copy every object onto itself, which S3's API refuses without a
 * metadata directive; and a prefix that CONTAINS the other makes a listing of one include the
 * objects of the other, so a mirror would copy its own output and then consider deleting it. Both
 * are mistakes at the call site, and neither has a sensible reading here.
 */
function assertDistinctPrefixes(fromPrefix: string, toPrefix: string): void {
  if (fromPrefix === toPrefix) {
    throw new Error(`copyUp was given one prefix twice: ${fromPrefix}`);
  }
  if (fromPrefix.startsWith(toPrefix) || toPrefix.startsWith(fromPrefix)) {
    throw new Error(`copyUp prefixes overlap: ${fromPrefix} and ${toPrefix}`);
  }
}
