declare module "*/scripts/bundle-node.mjs" {
  export function bundle(
    pairs: readonly { entry: string; outfile: string }[],
    options?: { writeNotices?: (outfile: string) => void },
  ): void;
}
