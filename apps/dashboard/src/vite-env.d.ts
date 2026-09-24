/// <reference types="vite/client" />

// apps/dashboard compiles @waitron/ui's source directly, including its `*.css?inline` imports, so
// it needs the same ambient declaration as packages/ui/src/vite-env.d.ts.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
