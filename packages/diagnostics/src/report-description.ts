export function reportDescriptionValid(value: string): boolean {
  return [...value].length <= 2000 && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value);
}
