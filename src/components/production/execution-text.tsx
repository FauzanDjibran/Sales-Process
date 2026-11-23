import type { ReactNode } from "react";
import { formatMoney, formatNumber } from "@/lib/format";

/** The plain pieces of a production document, for server pages too: no "use client" here. */

export const money = (n: number) => formatMoney(n, "IDR");
export const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
export const ro = (node: ReactNode) => <div className="ro">{node}</div>;
export const idc = (label: string, name: string) => (
  <span className="idc">
    <span className="lab">{label}</span>
    <span className="nm">{name}</span>
  </span>
);
