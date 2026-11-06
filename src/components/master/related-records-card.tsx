import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";

/** The records under a master, listed and linked, never edited here. */
export function RelatedRecordsCard({
  title,
  desc,
  icon,
  rows,
  href,
  empty,
}: {
  title: string;
  desc: string;
  icon: IconName;
  rows: { id: number; label: string; name: string }[];
  href: (id: number) => string;
  empty: string;
}) {
  return (
    <div className="fgrid solo">
      <div>
        <div className="card">
          <div className="card-h">
            <span className="ci">
              <Icon name={icon} size={15} />
            </span>
            <div className="ct">
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="empty sm">
              <p>{empty}</p>
            </div>
          ) : (
            <div className="tw">
              <table className="grid">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ width: 170 }}>
                        <Link href={href(r.id)}>
                          <span className="lab">{r.label}</span>
                        </Link>
                      </td>
                      <td>{r.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
