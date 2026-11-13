"use client";

import { Field } from "@/components/ui/form";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { BASE_CURRENCY_LABEL, isBaseCurrency, suggestRate } from "@/lib/erp/currency";
import { formatRate } from "@/lib/format";

type CurrencyOption = { id: number; label: string; name: string; active: boolean };
type TransactionRate = { currencyId: number; date: string; rate: number };

/**
 * Currency and Kurs on an order's header (Multi-Currency-Plan MC3, MC6): the
 * currency fixed once the order has lines, the rate suggested from the Kurs
 * master on the order's date and editable while Draft, the base currency at 1.
 */
export function CurrencyFields({
  editing,
  currencies,
  rates,
  date,
  currencyId,
  rate,
  locked,
  errors,
  onChange,
}: {
  editing: boolean;
  currencies: CurrencyOption[];
  rates: TransactionRate[];
  date: string;
  currencyId: number | null;
  rate: string;
  /** The order has lines: its currency is fixed (MC3). */
  locked: boolean;
  errors: Record<string, string>;
  onChange: (currencyId: number | null, rate: string) => void;
}) {
  const current = currencies.find((c) => c.id === currencyId) ?? null;
  const label = current?.label ?? BASE_CURRENCY_LABEL;
  const foreign = !isBaseCurrency(label);
  const suggested = foreign ? suggestRate(rates, currencyId, date) : null;
  const pick = (id: number | null) => {
    const c = currencies.find((x) => x.id === id);
    if (!c || isBaseCurrency(c.label)) return onChange(id, "1");
    const s = suggestRate(rates, id, date);
    onChange(id, s ? String(s) : "");
  };
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;

  return (
    <>
      <Field
        label="Currency"
        span={4}
        required={editing && !locked}
        locked={editing && locked}
        help={editing && !locked ? "terkunci setelah ada baris" : undefined}
        error={errors.currency_id}
      >
        {editing && !locked ? (
          <Select
            value={currencyId ? String(currencyId) : ""}
            options={currencies.filter((c) => c.active || c.id === currencyId).map((c) => ({ value: String(c.id), label: c.label, hint: c.name }))}
            onChange={(v) => pick(Number(v) || null)}
          />
        ) : (
          ro(<span className="lab">{label}</span>)
        )}
      </Field>
      {foreign && (
        <Field
          label="Kurs"
          span={4}
          required={editing}
          help={editing ? (suggested ? `usulan menu Kurs: ${formatRate(suggested)}` : "belum ada di menu Kurs — ketik kursnya") : undefined}
          error={errors.exchange_rate}
        >
          {editing ? (
            <RateInput value={rate} pairLabel={`${label} → ${BASE_CURRENCY_LABEL}`} invalid={Boolean(errors.exchange_rate)} onChange={(v) => onChange(currencyId, v)} />
          ) : (
            ro(<span className="mny">{formatRate(Number(rate))}</span>)
          )}
        </Field>
      )}
    </>
  );
}
