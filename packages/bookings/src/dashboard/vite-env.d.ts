// @waitron/ui's token layer imports its CSS as inline strings (`*.css?inline`, a Vite feature) — the
// dashboard sub-path pulls that in through @waitron/ui, so tsc needs the ambient declaration too (each
// @waitron/ui consumer carries its own; apps/dashboard and apps/till have the same file).
declare module "*.css?inline" {
  const css: string;
  export default css;
}
