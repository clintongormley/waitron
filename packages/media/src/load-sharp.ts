type Sharp = typeof import("sharp").default;
let loading: Promise<Sharp> | undefined;

/**
 * sharp is loaded on first use, not at import. Bundles that never prepare or decode a photo, such as
 * `waitron-provision`, reach this module and run with no sharp installed beside them.
 * `scripts/bundle-node.mjs` leaves sharp out of the bundles it builds, and the box image puts it in
 * `/app/node_modules`.
 * One libvips thread (sharp's own default on glibc Linux, the box's platform, per its
 * `dist/utility.mjs`) and no operation cache, so an upload takes neither every core nor memory it
 * keeps afterwards from the process serving sales.
 */
export function loadSharp(): Promise<Sharp> {
  loading ??= import("sharp").then(({ default: sharp }) => {
    sharp.concurrency(1);
    sharp.cache(false);
    return sharp;
  });
  return loading;
}
