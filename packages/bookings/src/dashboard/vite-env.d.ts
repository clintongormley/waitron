// @waitron/ui imports its CSS as `*.css?inline` (a Vite feature), so tsc needs this declaration.
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "*.svg?raw" {
  const svg: string;
  export default svg;
}
