/**
 * The Database viewer's arithmetic (P313): what a diagram holds and where each
 * box and line goes. Pure and client-safe; nothing here touches the DOM.
 */

export type DbApp = "erp" | "production" | "shared";
export type DbColumn = { name: string; type: string; required: boolean; values?: string[] };
export type DbTable = { name: string; cols: DbColumn[]; pk: string[]; rules: { kind: string; text: string }[] };
export type DbSchema = { tables: DbTable[]; fks: { table: string; col: string; ref: string }[] };
export type DbMenu = { key: string; name: string; module: string; app: "erp" | "production"; hidden: boolean; main: string | null; w: string[]; r: string[] };
export type DbMap = { groups: { key: string; name: string; app: DbApp }[]; tables: Record<string, string>; menus: DbMenu[] };

/** One table as the viewer reads it: by index, so a link is a pair of numbers. */
export type Node = DbTable & { app: DbApp; group: number };
export type Link = { from: number; col: string; to: number };
export type Model = {
  tables: Node[];
  index: Map<string, number>;
  links: Link[];
  /** What a table points at, and what points at it. */
  out: Link[][];
  in: Link[][];
  fk: Map<string, number>[];
  groups: DbMap["groups"];
  menus: (Omit<DbMenu, "main" | "w" | "r"> & { main: number; w: number[]; r: number[] })[];
  use: { w: number[]; r: number[] }[];
  /** Masters nearly everything points at: named on the column, not drawn. */
  hub: Set<number>;
};

export function buildModel(schema: DbSchema, map: DbMap): Model {
  const groupOf = new Map(map.groups.map((g, i) => [g.key, i]));
  const tables: Node[] = schema.tables.map((t) => {
    const group = groupOf.get(map.tables[t.name] ?? "") ?? 0;
    return { ...t, group, app: map.groups[group].app };
  });
  const index = new Map(tables.map((t, i) => [t.name, i]));
  const out: Link[][] = tables.map(() => []);
  const into: Link[][] = tables.map(() => []);
  const fk = tables.map(() => new Map<string, number>());
  const links: Link[] = [];
  for (const { table, col, ref } of schema.fks) {
    const link = { from: index.get(table)!, col, to: index.get(ref)! };
    if (link.from === undefined || link.to === undefined) continue;
    links.push(link);
    out[link.from].push(link);
    into[link.to].push(link);
    fk[link.from].set(col, link.to);
  }
  const known = (names: string[]) => names.flatMap((n) => index.get(n) ?? []);
  const menus = map.menus.map((m) => ({ ...m, main: index.get(m.main ?? "") ?? -1, w: known(m.w), r: known(m.r) }));
  const use = tables.map(() => ({ w: [] as number[], r: [] as number[] }));
  menus.forEach((m, i) => {
    m.w.forEach((t) => use[t].w.push(i));
    m.r.forEach((t) => use[t].r.push(i));
  });
  const hub = new Set(tables.flatMap((t, i) => (out[i].length + into[i].length >= 13 && /^(m_|ref_|sys_|acc_account$)/.test(t.name) ? [i] : [])));
  return { tables, index, links, out, in: into, fk, groups: map.groups, menus, use, hub };
}

/** A pointer to another module's document: an id with no foreign key. */
export const isWeak = (m: Model, t: number, col: string) => /(doc|scope)(_line)?_id$/.test(col) && !m.fk[t].has(col);

// ------------------------------------------------------------ what is drawn

export type Target = { v: "all" } | { v: "group" | "table" | "menu"; i: number };
export type Level = "name" | "key" | "full";
/** w the focus or a table the menu writes; p its parent; r a child, member or read table; out a parent outside the scope. */
export type Role = "w" | "p" | "r" | "out";
export type Options = { depth: number; read: boolean; hub: boolean; hidden: ReadonlySet<string> };
export type Box = { id: number; role: Role; x: number; y: number; w: number; h: number };
export type Frame = { id: number; ids: number[]; shut: boolean; x: number; y: number; w: number; h: number };
export type Graph = { boxes: Map<number, Box>; frames: Frame[]; links: Link[]; w: number; h: number; level: Level };

/** Each table's distance from the focus: below 0 what it points at, above 0 what points at it. */
export function levelsOf(m: Model, focus: number, depth: number): Map<number, number> {
  const level = new Map([[focus, 0]]);
  const walk = (next: (i: number) => number[], sign: number) => {
    let edge = [focus];
    for (let d = 1; d <= depth; d++) {
      const more: number[] = [];
      for (const i of edge) for (const j of next(i)) if (!level.has(j)) { level.set(j, sign * d); more.push(j); }
      edge = more;
    }
  };
  walk((i) => m.out[i].map((l) => l.to), -1);
  walk((i) => m.in[i].map((l) => l.from), 1);
  return level;
}

/** The foreign keys that make the hierarchy: one step up, and the focus pointing at itself. */
export const chainOf = (m: Model, level: Map<number, number>, focus: number) =>
  m.links.filter(({ from, to }) => level.has(from) && level.has(to) && (level.get(to) === level.get(from)! - 1 || (from === focus && to === focus)));

/** Which tables a target holds and in which role; a hidden section ("l-1", "rout") is left out. */
export function scopeOf(m: Model, t: Exclude<Target, { v: "all" }>, o: Options): Map<number, Role> {
  const set = new Map<number, Role>();
  if (t.v === "table") {
    for (const [i, d] of levelsOf(m, t.i, o.depth)) if (!o.hidden.has(`l${d}`)) set.set(i, d === 0 ? "w" : d < 0 ? "p" : "r");
    return set;
  }
  const keep = (i: number) => !m.hub.has(i) || o.hub;
  if (t.v === "menu") {
    const menu = m.menus[t.i];
    const readOnly = !menu.w.length;
    menu.w.forEach((i) => set.set(i, "w"));
    if (o.read || readOnly) for (const i of menu.r) if (!set.has(i) && (readOnly || keep(i))) set.set(i, "r");
  } else m.tables.forEach((x, i) => { if (x.group === t.i) set.set(i, "r"); });
  for (const [i, role] of [...set]) if (t.v === "group" || role === "w") for (const { to } of m.out[i]) if (!set.has(to) && keep(to)) set.set(to, "out");
  for (const [i, role] of [...set]) if (o.hidden.has(`r${role}`)) set.delete(i);
  return set;
}

export const ROW = 22;
export const HEAD = 32;

export const columnsOf = (m: Model, i: number, level: Level): DbColumn[] =>
  level === "name" ? [] : level === "full" ? m.tables[i].cols : m.tables[i].cols.filter((c) => m.tables[i].pk.includes(c.name) || m.fk[i].has(c.name) || isWeak(m, i, c.name));

function sizeOf(m: Model, i: number, level: Level, role?: Role) {
  const rows = role === "out" ? [] : columnsOf(m, i, level);
  const right = (c: DbColumn) => { const to = m.fk[i].get(c.name); return to === undefined ? c.type.length : m.tables[to].name.length + 3; };
  const w = Math.max(m.tables[i].name.length * 7 + 50, rows.length ? 236 : 0, ...rows.map((c) => c.name.length * 6.4 + 56 + Math.min(130, right(c) * 6.2)));
  return { w: Math.ceil(Math.min(350, w)), h: HEAD + rows.length * ROW + 2 };
}

export function buildGraph(m: Model, t: Target, level: Level, o: Options, apps: (a: DbApp) => boolean, shut: ReadonlySet<number>): Graph {
  if (t.v !== "all") {
    const set = scopeOf(m, t, o);
    const nodes = [...set].map(([id, role]) => ({ id, role, ...sizeOf(m, id, level, role) }));
    const links = (t.v === "table" ? chainOf(m, levelsOf(m, t.i, o.depth), t.i) : m.links.filter((l) => set.get(l.from) !== "out")).filter((l) => set.has(l.from) && set.has(l.to));
    const at = layoutGraph(nodes, links.map((l) => [l.from, l.to]));
    return { boxes: new Map(nodes.map((n) => [n.id, { ...n, ...at.pos.get(n.id)! }])), frames: [], links, w: at.w, h: at.h, level };
  }
  type Part = Size & { app: DbApp; ids: number[]; nodes: Size[]; inner: Placed | null };
  const parts = m.groups.flatMap((g, id): Part[] => {
    if (!apps(g.app)) return [];
    const ids = m.tables.flatMap((x, i) => (x.group === id ? [i] : []));
    if (!ids.length) return [];
    if (shut.has(id)) return [{ id, app: g.app, ids, nodes: [], inner: null, w: 300, h: 40 }];
    const nodes = ids.map((i) => ({ id: i, ...sizeOf(m, i, level) }));
    const inner = layoutGraph(nodes, m.links.filter((l) => m.tables[l.from].group === id && m.tables[l.to].group === id).map((l) => [l.from, l.to]));
    return [{ id, app: g.app, ids, nodes, inner, w: Math.max(300, inner.w + 36), h: inner.h + 74 }];
  }).sort((a, b) => b.h - a.h);
  // One application beside the other, each in its own columns.
  const pos = new Map<number, { x: number; y: number }>();
  let w = 0, h = 0;
  for (const [app, columns] of [["erp", 2], ["production", 1], ["shared", 1]] as const) {
    const own = parts.filter((p) => p.app === app);
    if (!own.length) continue;
    const at = layoutFrames(own, columns);
    const x = w ? w + 110 : 0;
    for (const [id, p] of at.pos) pos.set(id, { x: p.x + x, y: p.y });
    w = x + at.w;
    h = Math.max(h, at.h);
  }
  const boxes = new Map<number, Box>();
  for (const p of parts) for (const n of p.nodes) {
    const a = pos.get(p.id)!, b = p.inner!.pos.get(n.id)!;
    boxes.set(n.id, { ...n, role: "r", x: a.x + 18 + b.x, y: a.y + 56 + b.y });
  }
  return {
    boxes,
    frames: parts.map((p) => ({ id: p.id, ids: p.ids, shut: !p.inner, w: p.w, h: p.h, ...pos.get(p.id)! })),
    links: m.links.filter((l) => boxes.has(l.from) && boxes.has(l.to)),
    w,
    h,
    level,
  };
}

/** The lines: between two frames one shows only for the chosen table. */
export function edgesOf(m: Model, g: Graph, sel: number | null) {
  return g.links
    .filter((l) => !g.frames.length || m.tables[l.from].group === m.tables[l.to].group || l.from === sel || l.to === sel)
    .map((l) => {
      const a = g.boxes.get(l.from)!, b = g.boxes.get(l.to)!;
      const r = a.role === "out" ? -1 : columnsOf(m, l.from, g.level).findIndex((c) => c.name === l.col);
      return { ...l, d: linkPath(a, a.y + (r < 0 ? HEAD / 2 : HEAD + r * ROW + ROW / 2), b, b.y + HEAD / 2) };
    });
}

// ------------------------------------------------------------ layout

type Size = { id: number; w: number; h: number };
type Placed = { pos: Map<number, { x: number; y: number }>; w: number; h: number };
const GAP_X = 96, GAP_Y = 22, MAX_COL = 1500;

/** Parents left, children right; a child points at its parent. */
export function layoutGraph(nodes: Size[], edges: (readonly [number, number])[]): Placed {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const es = edges.filter(([a, b]) => a !== b && byId.has(a) && byId.has(b));
  const near = new Map(nodes.map((n) => [n.id, new Set<number>()]));
  for (const [a, b] of es) { near.get(a)!.add(b); near.get(b)!.add(a); }
  const seen = new Set<number>(), parts: number[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const q = [n.id];
    seen.add(n.id);
    for (let i = 0; i < q.length; i++) for (const k of near.get(q[i])!) if (!seen.has(k)) { seen.add(k); q.push(k); }
    parts.push(q);
  }
  const single = parts.filter((c) => c.length === 1).map((c) => byId.get(c[0])!);
  const placed = parts.filter((c) => c.length > 1).map((c) => layoutPart(c.map((id) => byId.get(id)!), es.filter(([a]) => c.includes(a))));
  placed.sort((a, b) => b.h * b.w - a.h * a.w);
  const width = Math.max(760, ...placed.map((b) => b.w));
  if (single.length) placed.push(layoutShelf(single, width));
  // The parts stack; a small one sits beside another when it fits the width.
  const pos: Placed["pos"] = new Map();
  let x = 0, y = 0, row = 0, w = 0;
  for (const b of placed) {
    if (x && x + b.w > width) { x = 0; y += row + 46; row = 0; }
    for (const [id, p] of b.pos) pos.set(id, { x: p.x + x, y: p.y + y });
    x += b.w + 60;
    row = Math.max(row, b.h);
    w = Math.max(w, x - 60);
  }
  return { pos, w, h: y + row };
}

function layoutShelf(nodes: Size[], width: number): Placed {
  const pos: Placed["pos"] = new Map();
  let x = 0, y = 0, row = 0, w = 0;
  for (const n of [...nodes].sort((a, b) => a.h - b.h)) {
    if (x && x + n.w > width) { x = 0; y += row + GAP_Y; row = 0; }
    pos.set(n.id, { x, y });
    x += n.w + GAP_Y;
    row = Math.max(row, n.h);
    w = Math.max(w, x - GAP_Y);
  }
  return { pos, w, h: y + row };
}

function layoutPart(nodes: Size[], es: (readonly [number, number])[]): Placed {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Map(nodes.map((n) => [n.id, new Set<number>()]));
  const kids = new Map(nodes.map((n) => [n.id, new Set<number>()]));
  for (const [a, b] of es) { parents.get(a)!.add(b); kids.get(b)!.add(a); }
  // Layer = longest path from a root; an edge closing a cycle is ignored.
  const layer = new Map<number, number>(), busy = new Set<number>();
  const depth = (id: number): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (busy.has(id)) return -1;
    busy.add(id);
    let d = 0;
    for (const p of parents.get(id)!) d = Math.max(d, depth(p) + 1);
    busy.delete(id);
    layer.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id));
  // A root moves next to its nearest child, so its line is short.
  for (const { id } of nodes) if (!parents.get(id)!.size && kids.get(id)!.size) layer.set(id, Math.max(0, Math.min(...[...kids.get(id)!].map((k) => layer.get(k)!)) - 1));
  const layers: number[][] = [];
  for (const { id } of nodes) (layers[layer.get(id)!] ??= []).push(id);
  // A column too tall to read is split.
  const cols = layers.filter(Boolean).flatMap((c) => {
    const total = c.reduce((s, id) => s + byId.get(id)!.h + GAP_Y, 0);
    const parts = Math.ceil(total / MAX_COL);
    if (parts < 2) return [c];
    const out: number[][] = [[]];
    let h = 0;
    for (const id of c) {
      if (h > total / parts) { out.push([]); h = 0; }
      out[out.length - 1].push(id);
      h += byId.get(id)!.h + GAP_Y;
    }
    return out;
  });
  const y = new Map<number, number>();
  const stack = (c: number[]) => { let t = 0; for (const id of c) { y.set(id, t); t += byId.get(id)!.h + GAP_Y; } };
  cols.forEach(stack);
  const mid = (id: number) => y.get(id)! + byId.get(id)!.h / 2;
  const want = (id: number) => { const ns = [...parents.get(id)!, ...kids.get(id)!]; return ns.length ? ns.reduce((s, k) => s + mid(k), 0) / ns.length : mid(id); };
  const sweep = (k: number) => (k % 2 ? [...cols].reverse() : cols);
  for (let k = 0; k < 10; k++) for (const c of sweep(k)) {
    const w = new Map(c.map((id) => [id, want(id)]));
    c.sort((a, b) => w.get(a)! - w.get(b)!);
    stack(c);
  }
  // Then each box drifts to the middle of its neighbours without overlapping.
  for (let k = 0; k < 24; k++) for (const c of sweep(k)) {
    const d = c.map((id) => want(id) - byId.get(id)!.h / 2);
    const runs: { ids: number[]; h: number; sum: number; n: number; y: number }[] = [];
    c.forEach((id, i) => {
      let g = { ids: [id], h: byId.get(id)!.h, sum: d[i], n: 1, y: d[i] };
      while (runs.length && runs[runs.length - 1].y + runs[runs.length - 1].h + GAP_Y > g.y) {
        const p = runs.pop()!, off = p.h + GAP_Y;
        const sum = p.sum + g.sum - off * g.n, n = p.n + g.n;
        g = { ids: [...p.ids, ...g.ids], h: p.h + GAP_Y + g.h, sum, n, y: sum / n };
      }
      runs.push(g);
    });
    for (const g of runs) { let t = g.y; for (const id of g.ids) { y.set(id, t); t += byId.get(id)!.h + GAP_Y; } }
  }
  const top = Math.min(...y.values());
  const pos: Placed["pos"] = new Map();
  let x = 0, h = 0;
  for (const c of cols) {
    for (const id of c) { pos.set(id, { x, y: y.get(id)! - top }); h = Math.max(h, y.get(id)! - top + byId.get(id)!.h); }
    x += Math.max(...c.map((id) => byId.get(id)!.w)) + GAP_X;
  }
  return { pos, w: x - GAP_X, h };
}

/** Frames in balanced columns: the shortest column takes the next frame. */
function layoutFrames(frames: Size[], n: number): Placed {
  const w = Array<number>(n).fill(0), h = Array<number>(n).fill(0);
  const at = new Map<number, { c: number; y: number }>();
  for (const f of frames) {
    const c = h.indexOf(Math.min(...h));
    at.set(f.id, { c, y: h[c] });
    h[c] += f.h + 28;
    w[c] = Math.max(w[c], f.w);
  }
  const x: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) { x[i] = t; t += w[i] ? w[i] + 60 : 0; }
  return { pos: new Map([...at].map(([id, p]) => [id, { x: x[p.c], y: p.y }])), w: Math.max(0, t - 60), h: Math.max(...h) - 28 };
}

/** A line from a child's column to its parent, on the nearer sides, with a crow's foot at the child. */
function linkPath(a: Box, ay: number, b: Box, by: number): string {
  const left = a !== b && b.x + b.w <= a.x + 10, right = a !== b && a.x + a.w <= b.x + 10;
  const [x1, s1, x2, s2] = left ? [a.x, -1, b.x + b.w, 1] : right ? [a.x + a.w, 1, b.x, -1] : [a.x + a.w, 1, b.x + b.w, 1];
  const k = Math.max(34, Math.min(120, Math.abs(x2 - x1) / 2)), f = 9 * s1;
  return `M${x1} ${ay - 5}L${x1 + f} ${ay}L${x1} ${ay + 5}M${x1} ${ay}H${x1 + f}C${x1 + f + k * s1} ${ay} ${x2 + 8 * s2 + k * s2} ${by} ${x2 + 8 * s2} ${by}H${x2}M${x2 + 5 * s2} ${by - 5}V${by + 5}`;
}
