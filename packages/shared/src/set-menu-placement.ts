export interface PlacementProblem {
  readonly classes: readonly {
    readonly count: number;
    readonly uncoveredCost?: number;
    readonly arcs: readonly { readonly pair: number; readonly cost: number }[];
  }[];
  readonly capacities: readonly number[];
  readonly uncoveredCost: number;
}

export interface Placement {
  readonly cost: number;
  readonly uncovered: number;
  readonly flows: readonly (readonly { readonly pair: number; readonly count: number }[])[];
  readonly capacityPrices: readonly number[];
}

interface Edge {
  readonly from: number;
  readonly to: number;
  readonly cost: number;
  capacity: number;
  reverse: Edge;
}

export function solvePlacement({
  classes,
  capacities,
  uncoveredCost,
}: PlacementProblem): Placement {
  const source = 0;
  const firstPair = 1 + classes.length;
  const sink = firstPair + capacities.length;
  const size = sink + 1;
  const graph: Edge[][] = Array.from({ length: size }, () => []);
  function connect(from: number, to: number, capacity: number, cost: number): Edge {
    const forward = { from, to, capacity, cost } as Edge;
    const reverse = { from: to, to: from, capacity: 0, cost: -cost, reverse: forward };
    forward.reverse = reverse;
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    return forward;
  }

  let remaining = 0;
  const classEdges = classes.map(({ count, arcs, uncoveredCost: classCost }, index) => {
    const node = index + 1;
    remaining += count;
    connect(source, node, count, 0);
    const pairs = arcs.map(({ pair, cost }) => ({
      pair,
      edge: connect(node, firstPair + pair, Infinity, cost),
    }));
    return { pairs, uncovered: connect(node, sink, Infinity, classCost ?? uncoveredCost) };
  });
  capacities.forEach((capacity, pair) => connect(firstPair + pair, sink, capacity, 0));

  const distance = new Float64Array(size);
  const queued = new Uint8Array(size);
  const queue = new Int32Array(size);
  const parent: Edge[] = [];
  function shortestPaths(start?: number): void {
    let read = 0;
    let write = 0;
    let waiting = 0;
    function enqueue(node: number): void {
      queue[write] = node;
      write = (write + 1) % size;
      queued[node] = 1;
      waiting++;
    }
    if (start === undefined) {
      distance.fill(0);
      for (let node = 0; node < size; node++) enqueue(node);
    } else {
      distance.fill(Infinity);
      distance[start] = 0;
      enqueue(start);
    }
    while (waiting > 0) {
      const node = queue[read]!;
      read = (read + 1) % size;
      waiting--;
      queued[node] = 0;
      for (const edge of graph[node]!) {
        if (edge.capacity === 0) continue;
        const next = distance[node]! + edge.cost;
        if (next >= distance[edge.to]!) continue;
        distance[edge.to] = next;
        parent[edge.to] = edge;
        if (!queued[edge.to]) enqueue(edge.to);
      }
    }
  }

  let cost = 0;
  while (remaining > 0) {
    shortestPaths(source);
    let amount = remaining;
    for (let node = sink; node !== source; node = parent[node]!.from) {
      amount = Math.min(amount, parent[node]!.capacity);
    }
    for (let node = sink; node !== source; node = parent[node]!.from) {
      const edge = parent[node]!;
      edge.capacity -= amount;
      edge.reverse.capacity += amount;
    }
    cost += amount * distance[sink]!;
    remaining -= amount;
  }

  // Residual distances give feasible potentials, so each capacity price bounds what another place can save.
  shortestPaths();
  return {
    cost,
    uncovered: classEdges.reduce((total, edges) => total + edges.uncovered.reverse.capacity, 0),
    flows: classEdges.map(({ pairs }) =>
      pairs.flatMap(({ pair, edge }) =>
        edge.reverse.capacity > 0 ? [{ pair, count: edge.reverse.capacity }] : [],
      ),
    ),
    capacityPrices: capacities.map((_, pair) =>
      Math.max(0, distance[sink]! - distance[firstPair + pair]!),
    ),
  };
}
