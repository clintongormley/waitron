type Sharp = typeof import("sharp").default;

/** The most pixels a library image may declare. */
export const MAX_INPUT_PIXELS = 100_000_000;

/**
 * How a library image is decoded: refused when the decoder warns or it declares more than
 * {@link MAX_INPUT_PIXELS}, and turned upright by its EXIF orientation.
 */
export const DECODE_OPTIONS = {
  failOn: "warning",
  limitInputPixels: MAX_INPUT_PIXELS,
  autoOrient: true,
} as const;

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
