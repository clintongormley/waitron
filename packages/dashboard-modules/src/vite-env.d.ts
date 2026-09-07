// @waitron/ui's token layer imports its CSS as inline strings (`*.css?inline`, a Vite feature). This
// registry re-exports a module's browser sub-path, which pulls @waitron/ui in, so tsc needs the ambient
// declaration too (every @waitron/ui consumer carries its own — apps/dashboard, apps/till and the
// bookings dashboard sub-path all have the same file).
declare module "*.css?inline" {
  const css: string;
  export default css;
}
