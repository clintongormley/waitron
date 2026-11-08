declare module "*.css?inline" {
  const text: string;
  export default text;
}

declare module "*.svg?raw" {
  const svg: string;
  export default svg;
}
