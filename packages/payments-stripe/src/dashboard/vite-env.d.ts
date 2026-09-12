// @waitron/ui's token layer imports its CSS as inline strings (`*.css?inline`, a Vite feature) — this
// panel pulls that in through @waitron/ui, so tsc needs the ambient declaration too (every @waitron/ui
// consumer carries its own; apps/dashboard, apps/till and the bookings dashboard sub-path have it too).
declare module "*.css?inline" {
  const css: string;
  export default css;
}
