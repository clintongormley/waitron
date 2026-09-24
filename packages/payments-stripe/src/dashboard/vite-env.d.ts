// @waitron/ui imports its CSS as `*.css?inline` (a Vite feature), so tsc needs this declaration here.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
