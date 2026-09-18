/**
 * Copying one prefix of the object store onto another, either additively or as a MIRROR.
 *
 * This is the rig's model of re-homing a replica: a node holds another node's replica under its own
 * prefix and has to keep that copy faithful. What S3 (`scenarios/s3_copied_replica.ts`) measures is
 * that "faithful" means a mirror — an additive copy onto a destination that already holds somebody
 * else's objects restores somebody else's database, with no error anywhere.
 *
 * Nothing here is litestream-specific: it moves objects and knows nothing about what they contain.
 */
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

/**
 * Copy every object under `fromPrefix` to the matching key under `toPrefix`, and — when
 * `propagateDeletions` — remove the objects under `toPrefix` that `fromPrefix` no longer holds.
 *
 * The counts come back rather than nothing (plan Task 8 asks for `Promise<void>`) because S3 prints
 * them in its verdict line, and because `deleted` is the number that separates the two modes: an
 * additive copy of a source that has dropped files is indistinguishable from a mirror of a source
 * that never did, if all you can see is that the call returned.
 *
 * The keys are matched by SUFFIX — everything after the prefix — so a destination object is
 * "the same object" as a source one when the two sit at the same place under their prefixes.
 * Objects are copied one at a time and deleted one at a time: this rig's prefixes hold a handful of
 * files each, and a batched `DeleteObjects` would buy nothing here while making a failure harder to
 * attribute to a key.
 */
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
        // `CopySource` is `<bucket>/<key>`, and it is NOT escaped here. That is safe only for the
        // restricted alphabet this rig writes: every key it copies is a litestream replica file
        // under a prefix it chose, and a listing taken on 2026-09-18 after three one-shot syncs
        // read, in full: `venues/v1/gen-1-box-a/0000/0000000000000001-0000000000000001.ltx` and two
        // like it — a four-digit directory, then a pair of numbers, a dash and `.ltx`. Letters,
        // digits, dashes, dots and slashes.
        //
        // WHICH characters actually need escaping was measured rather than guessed, 2026-09-18,
        // five keys driven through this function against the pinned MinIO image: the `.ltx` key
        // above copied; a key holding a SPACE copied, landing under its own name; a key holding a
        // `+` copied, also under its own name, so MinIO did not read it as a space. The two that
        // failed both hold a PERCENT — `has%2Fslash.ltx` and `has%25.ltx` — each answering
        // `NoSuchKey: The specified key does not exist.`.
        //
        // WHY they fail was then settled by a control rather than reasoned about, 2026-09-18 against
        // the same image: the DECODED key was written and the ESCAPED name asked for, which can only
        // land if the escape is decoded on the way in. Both landed —
        // `wrote="probe/from/has/slash.ltx" asked-for="probe/from/has%2Fslash.ltx" -> COPIED` and
        // `wrote="probe/from/has%.ltx" asked-for="probe/from/has%25.ltx" -> COPIED`. So the
        // unescaped `CopySource` really does have the store look for the decoded key. The
        // destination `Key` is NOT decoded the same way: both copies landed under the literal
        // escaped name (`probe/to/has%2Fslash.ltx`, `probe/to/has%25.ltx`), and it is that asymmetry
        // that makes an unescaped `CopySource` wrong rather than merely inconsistent. A caller
        // widening the alphabet past what is listed above should escape, and re-run that probe
        // rather than trust this list.
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
 * Two prefixes where one contains the other are refused rather than handled.
 *
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
