"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { SearchField } from "@/components/ui/search-field";
import type { EntityAbilities } from "@/lib/erp/entity-access";
import { createLabel, type Entity } from "@/lib/erp/entities";
import { moduleNameAt } from "@/lib/erp/nav";
import type { LocationTreeWarehouse } from "@/lib/erp/warehouse";

/**
 * Lokasi Gudang as a tree, one level deep (P267): each Gudang folds over its
 * locations, as the Chart of Accounts folds over its accounts. A Gudang row is
 * structure; only a location row opens a record. Detail, create and edit stay
 * the registry's.
 */
export function LocationTree({ entity, warehouses, can }: { entity: Entity; warehouses: LocationTreeWarehouse[]; can: EntityAbilities }) {
  const router = useRouter();
  const basePath = `/${entity.module}/${entity.slug}`;
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const q = query.trim().toLowerCase();

  const shown = warehouses
    .map((w) => {
      const own = `${w.label} ${w.name}`.toLowerCase().includes(q);
      const locations = !q || own ? w.locations : w.locations.filter((l) => `${l.path} ${l.name}`.toLowerCase().includes(q));
      return { ...w, locations, keep: !q || own || locations.length > 0 };
    })
    .filter((w) => w.keep);
  const count = shown.reduce((s, w) => s + w.locations.length, 0);
  const isOpen = (id: number) => Boolean(q) || !closed.has(id);
  const toggle = (id: number) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>{moduleNameAt(entity.module, entity.slug)}</span>
          <span>/</span>
          <span className="cur">{entity.name}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={entity.icon} size={16} />
            </span>
            {entity.name}
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href={`${basePath}/new`}>
                <Icon name="plus" size={15} /> {createLabel(entity)}
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">{entity.desc}</p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField grow value={query} onChange={setQuery} placeholder="Cari gudang, label atau nama lokasi…" />
          <span className="count">
            <b>{count}</b> lokasi
          </span>
          <ExpandAll onExpand={() => setClosed(new Set())} onCollapse={() => setClosed(new Set(warehouses.map((w) => w.id)))} />
        </div>
        <div className="card-h" style={{ borderTop: 0, borderBottom: "1px solid var(--line-2)" }}>
          <span className="ci">
            <Icon name="tree" size={15} />
          </span>
          <div className="ct">
            <h3>Gudang dan Lokasinya</h3>
            <p>Gudang tanpa lokasi mencatat stok per gudang saja; begitu punya satu lokasi, setiap stoknya ada di salah satu lokasi.</p>
          </div>
          <span className="hint">Klik baris lokasi untuk membuka detail</span>
        </div>

        {shown.length ? (
          <div className="tree">
            {shown.map((w) => {
              const open = isOpen(w.id);
              return (
                <div className="tgrp" key={w.id}>
                  <div
                    className={`tn k-cat${w.active ? "" : " off"}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggle(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(w.id);
                      }
                    }}
                  >
                    <span className="tw5">
                      <span className={`chev${open ? " o" : ""}`}>
                        <Icon name="chev" size={12} />
                      </span>
                    </span>
                    <span className="lab">{w.label}</span>
                    <span className="tname">{w.name}</span>
                    <span className="tright">
                      <span className="tcount">{w.locations.length ? `${w.locations.length} lokasi` : "tanpa lokasi"}</span>
                      {!w.active && <span className="bdg s-bad">Non Aktif</span>}
                    </span>
                  </div>
                  {open && (
                    <div className="tkids">
                      {w.locations.length ? (
                        w.locations.map((l) => (
                          <div key={l.id} className={`tn k-acc${l.active ? "" : " off"}`} onClick={() => router.push(`${basePath}/${l.id}`)}>
                            <span className="tw5">
                              <span className="tdot" />
                            </span>
                            <span className="lab">{l.path}</span>
                            <span className="tname">{l.name}</span>
                            <span className="tright">
                              {!l.active && <span className="bdg s-bad">Non Aktif</span>}
                              <span className="tacts">
                                <button
                                  className="iact"
                                  title="Lihat detail"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`${basePath}/${l.id}`);
                                  }}
                                >
                                  <Icon name="eye" size={14} />
                                </button>
                                {can.edit && (
                                  <button
                                    className="iact"
                                    title="Ubah"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(`${basePath}/${l.id}/edit`);
                                    }}
                                  >
                                    <Icon name="pen" size={14} />
                                  </button>
                                )}
                              </span>
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="tempty">Gudang ini tanpa lokasi.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="srch" size={20} />
            </div>
            <h4>{q ? "Tidak ada yang cocok" : "Belum ada gudang"}</h4>
            <p>{q ? "Tidak ada gudang atau lokasi yang mengandung kata kunci tersebut." : "Buat gudang dulu di menu Gudang."}</p>
            {q && (
              <div className="cta">
                <button className="btn" onClick={() => setQuery("")}>
                  Bersihkan pencarian
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
