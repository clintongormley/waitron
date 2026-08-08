/// <reference types="vite/client" />

// @waitron/ui's token layer imports its CSS as inline strings (`*.css?inline`, a Vite feature).
// apps/dashboard compiles that source directly (no build step between the packages), so it needs
// the same ambient declaration in its own program — mirrors packages/ui/src/vite-env.d.ts.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
