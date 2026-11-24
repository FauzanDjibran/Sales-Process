"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { columnsOf, edgesOf, isWeak, type Box, type Graph } from "@/lib/erp/db-diagram";
import { Aim, AppTag, GoLink, useGo } from "./viewer-parts";

type View = { s: number; x: number; y: number };
const MIN = 0.1, MAX = 2, READABLE = 0.62;
const clamp = (s: number) => Math.max(MIN, Math.min(MAX, s));

export function DiagramCanvas({
  graph,
  focus,
  whole,
  sel,
  onSel,
  onFrame,
  reveal,
  legend,
}: {
  graph: Graph;
  /** The table the diagram is about, kept in the middle. */
  focus: number | null;
  /** Always fitted whole, however small: the map of every table. */
  whole: boolean;
  sel: number | null;
  onSel: (i: number | null) => void;
  onFrame: (id: number) => void;
  /** A table the inspector asked to show; a new object each time. */
  reveal: { i: number } | null;
  legend: React.ReactNode;
}) {
  const { model, go } = useGo();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // null until the reader moves it: the diagram then follows the window's size.
  const [moved, setMoved] = useState<View | null>(null);
  // The enum column whose values are open.
  const [values, setValues] = useState<{ i: number; col: string } | null>(null);
  const [seen, setSeen] = useState(graph);
  if (seen !== graph) {
    setSeen(graph);
    setMoved(null);
    setValues(null);
  }

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const fitted = useMemo(() => {
    const { w, h } = size;
    const all = Math.min(1, (w - 48) / graph.w, (h - 80) / graph.h);
    const at = (s: number): View => ({ s, x: (w - graph.w * s) / 2, y: graph.h * s > h - 80 ? 56 : Math.max(56, (h - graph.h * s) / 2) });
    const full = at(Math.max(MIN, all));
    // The whole diagram when it stays readable; otherwise at a readable size, on the focus.
    const start = whole ? full : at(Math.max(all, Math.min(READABLE, Math.max(MIN, (w - 48) / graph.w))));
    const box = focus === null ? undefined : graph.boxes.get(focus);
    if (!whole && box && graph.h * start.s > h - 80) start.y = h / 2 - (box.y + box.h / 2) * start.s;
    return { full, start };
  }, [graph, focus, whole, size]);
  const view = moved ?? fitted.start;

  const zoomAt = (f: number, cx = size.w / 2, cy = size.h / 2) => {
    const s = clamp(view.s * f);
    setMoved({ s, x: cx - ((cx - view.x) * s) / view.s, y: cy - ((cy - view.y) * s) / view.s });
  };

  const [shown, setShown] = useState(reveal);
  if (shown !== reveal) {
    setShown(reveal);
    const b = reveal && graph.boxes.get(reveal.i);
    if (b) {
      const s = Math.max(view.s, READABLE);
      setMoved({ s, x: size.w / 2 - (b.x + b.w / 2) * s, y: size.h / 2 - (b.y + Math.min(b.h, 240) / 2) * s });
    }
  }

  // The wheel moves the canvas, so the page must not scroll under it: that
  // needs a listener that may prevent the default, which React's is not.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheel.current = (e) => {
      e.preventDefault();
      const r = ref.current!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else setMoved({ ...view, x: view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY) });
    };
  });
  useEffect(() => {
    const el = ref.current!;
    const on = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const drag = useRef<{ x: number; y: number; view: View; box: number | null; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("a,button,.dbv-map,.cbh,.dbe")) return;
    const box = el.closest<HTMLElement>("[data-box]");
    drag.current = { x: e.clientX, y: e.clientY, view, box: box ? Number(box.dataset.box) : null, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setMoved({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
  };
  const endDrag = (click: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && click && !d.moved) setValues(null);
    if (d && click && !d.moved) onSel(d.box === sel ? null : d.box);
  };

  // The drawing itself changes only with the graph and the selection, not with every pan.
  const drawing = useMemo(() => {
    const edges = edgesOf(model, graph, sel);
    const near = (l: { from: number; to: number }) => sel !== null && (l.from === sel || l.to === sel);
    const related = new Set([sel, ...edges.filter(near).flatMap((l) => [l.from, l.to])]);
    const lines = (list: typeof edges) => (
      <svg className="dbv-l" width="1" height="1" aria-hidden="true">
        {list.map((l) => (
          <path key={`${l.from}.${l.col}`} className={`dbl${near(l) ? " on" : sel !== null ? " dim" : ""}`} d={l.d} />
        ))}
      </svg>
    );
    const toggle = (i: number) => onSel(i === sel ? null : i);
    const openValues = (i: number, col: string) => setValues((v) => (v?.i === i && v.col === col ? null : { i, col }));
    return (
      <>
        {graph.frames.map((f) => (
          <div key={f.id} className={`dbg${f.shut ? " shut" : ""}`} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
            <div
              className="cbh"
              role="button"
              tabIndex={0}
              aria-expanded={!f.shut}
              onClick={() => onFrame(f.id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onFrame(f.id);
              }}
            >
              <span className={`chev${f.shut ? "" : " o"}`}>
                <Icon name="chev" size={12} />
              </span>
              <b>{model.groups[f.id].name}</b>
              <span className="cbn">{f.ids.length} tabel</span>
              <span className="tspace" />
              <AppTag app={model.groups[f.id].app} />
            </div>
          </div>
        ))}
        {lines(edges.filter((l) => !near(l)))}
        {[...graph.boxes.values()].map((b) => (
          <TableBox key={b.id} box={b} graph={graph} sel={sel} dim={sel !== null && !related.has(b.id)} onToggle={toggle} onValues={openValues} />
        ))}
        {lines(edges.filter(near))}
      </>
    );
  }, [model, graph, sel, onSel, onFrame]);

  const fits = graph.w * view.s <= size.w && graph.h * view.s <= size.h;
  const k = Math.min(150 / graph.w, 100 / graph.h);

  return (
    <div
      ref={ref}
      className={`dbv${dragging ? " drag" : ""}`}
      tabIndex={0}
      aria-label="Kanvas diagram"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (values) setValues(null);
        else onSel(null);
      }}
      onDoubleClick={(e) => {
        const box = (e.target as HTMLElement).closest<HTMLElement>("[data-box]");
        if (box && !(e.target as HTMLElement).closest("a,button")) go({ v: "table", i: Number(box.dataset.box) });
      }}
    >
      <div className="dbv-in" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.s})` }}>
        {size.w > 0 && drawing}
        {values && <EnumValues graph={graph} at={values} scale={view.s} />}
      </div>
      {legend && <div className="dbv-key">{legend}</div>}
      {!fits && size.w > 0 && (
        <div
          className="dbv-map"
          aria-hidden="true"
          onPointerDown={(e) => {
            const r = e.currentTarget.firstElementChild!.getBoundingClientRect();
            setMoved({ ...view, x: size.w / 2 - ((e.clientX - r.left) / k) * view.s, y: size.h / 2 - ((e.clientY - r.top) / k) * view.s });
          }}
        >
          <svg width={graph.w * k} height={graph.h * k}>
            {[...graph.boxes.values()].map((b) => (
              <rect key={b.id} className={b.id === (focus ?? sel) ? "f" : undefined} x={b.x * k} y={b.y * k} width={b.w * k} height={Math.max(1.5, b.h * k)} rx="1" />
            ))}
            <rect className="v" x={(-view.x / view.s) * k} y={(-view.y / view.s) * k} width={(size.w / view.s) * k} height={(size.h / view.s) * k} />
          </svg>
        </div>
      )}
      <div className="dbv-zoom">
        <button type="button" className="iact" title="Perkecil" aria-label="Perkecil" onClick={() => zoomAt(0.8)}>
          −
        </button>
        <span className="pct">{Math.round(view.s * 100)}%</span>
        <button type="button" className="iact" title="Perbesar" aria-label="Perbesar" onClick={() => zoomAt(1.25)}>
          <Icon name="plus" size={13} />
        </button>
        <button type="button" className="iact" title="Pas Layar" aria-label="Pas Layar" onClick={() => setMoved(fitted.full)}>
          <Icon name="expand" size={14} />
        </button>
      </div>
    </div>
  );
}

/** An enum's values under its column, at reading size whatever the zoom. */
function EnumValues({ graph, at, scale }: { graph: Graph; at: { i: number; col: string }; scale: number }) {
  const { model } = useGo();
  const box = graph.boxes.get(at.i);
  const cols = columnsOf(model, at.i, graph.level);
  const row = cols.findIndex((c) => c.name === at.col);
  const col = cols[row];
  if (!box || !col?.values) return null;
  return (
    <div className="dbe" role="status" style={{ left: box.x + 10, top: box.y + 32 + 22 * (row + 1), transform: `scale(${1 / scale})` }}>
      <b>{col.type}</b>
      {col.values.map((v) => (
        <span key={v}>{v}</span>
      ))}
    </div>
  );
}

function TableBox({
  box,
  graph,
  sel,
  dim,
  onToggle,
  onValues,
}: {
  box: Box;
  graph: Graph;
  sel: number | null;
  dim: boolean;
  onToggle: (i: number) => void;
  onValues: (i: number, col: string) => void;
}) {
  const { model } = useGo();
  const i = box.id;
  const t = model.tables[i];
  return (
    <div
      className={`dbt ${box.role}${sel === i ? " on" : ""}${dim ? " dim" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t.name}
      aria-pressed={sel === i}
      data-box={i}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onToggle(i);
      }}
    >
      <div className="dbt-h" title={t.name}>
        <b>{t.name}</b>
        <Aim i={i} size={13} />
      </div>
      {(box.role === "out" ? [] : columnsOf(model, i, graph.level)).map((c) => {
        const to = model.fk[i].get(c.name);
        const pk = t.pk.includes(c.name);
        const drawn = to !== undefined && graph.boxes.has(to);
        return (
          <div key={c.name} className={`dbt-c${drawn && (sel === to || sel === i) ? " on" : ""}`}>
            <span className={`k ${pk ? "pk" : "fk"}`}>{pk ? "PK" : to !== undefined ? "FK" : ""}</span>
            <span className="cn" title={c.name}>
              {c.name}
            </span>
            {to !== undefined && !drawn ? (
              <GoLink to={{ v: "table", i: to }} className="lab" title={`Jadikan fokus ${model.tables[to].name}`}>
                → {model.tables[to].name}
              </GoLink>
            ) : isWeak(model, i, c.name) ? (
              <span className="lab wk" title="Menunjuk dokumen lain tanpa foreign key">
                dokumen
              </span>
            ) : c.values ? (
              <button type="button" className="ct" title={`Lihat isi ${c.type} · ${c.required ? "wajib" : "boleh kosong"}`} onClick={() => onValues(i, c.name)}>
                {c.type}
                {c.required ? "" : "?"}
              </button>
            ) : (
              <span className="ct" title={`${c.type} · ${c.required ? "wajib" : "boleh kosong"}`}>
                {c.type}
                {c.required ? "" : "?"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
