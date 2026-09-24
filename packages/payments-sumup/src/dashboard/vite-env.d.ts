// @waitron/ui's token layer imports its CSS as inline strings (`*.css?inline`, a Vite feature) — this
// panel pulls that in through @waitron/ui, so tsc needs the ambient declaration too.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
