export function shortNodeId(nodeId: string): string {
  const prefix = nodeId.slice(0, 8).toUpperCase();
  return prefix.length > 4 ? `${prefix.slice(0, 4)} ${prefix.slice(4)}` : prefix;
}
