/// <reference types="vite/client" />

// @waitron/ui's source, compiled directly here, imports `*.css?inline`.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
