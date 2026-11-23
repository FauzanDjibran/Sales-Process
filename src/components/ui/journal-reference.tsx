import Link from "next/link";
import { Field, FormRow, FormSection } from "./form";

/**
 * The journal a document wrote, as the last section of its header card — one
 * place on every document, absent until there is one to open.
 */
export function JournalReference({ id, no, children }: { id?: number | null; no?: string | null; children?: React.ReactNode }) {
  if (!id && !children) return null;
  return (
    <FormSection title="Referensi">
      <FormRow>
        {id && (
          <Field label="Journal" span={4}>
            <div className="ro">
              <Link className="drl" href={`/accounting/journal/${id}`}>
                <span className="mono">{no}</span>
              </Link>
            </div>
          </Field>
        )}
        {children}
      </FormRow>
    </FormSection>
  );
}
