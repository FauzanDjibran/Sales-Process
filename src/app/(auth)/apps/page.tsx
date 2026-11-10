import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { logout } from "@/app/actions/auth";
import { requireAuth } from "@/lib/erp/auth";
import { APPS, appsOf, landingHref } from "@/lib/erp/nav";

export const dynamic = "force-dynamic";

/**
 * Pilih aplikasi (P254 §3.3): one card, the two applications stacked. Only a
 * user holding both lands here; anyone else goes straight to theirs.
 */
export default async function AppsPage() {
  const actor = await requireAuth("/apps");
  const apps = appsOf(actor.permissions);
  if (apps.length < 2) redirect(landingHref(actor.permissions));

  return (
    <div className="auth-card sso-card">
      <h1 className="auth-h">Halo, {actor.user.name}</h1>
      <p className="auth-sub">
        {actor.roles.map((r) => r.name).join(", ") || "Tanpa Role"}. Pilih aplikasi; yang
        bisa dibuka mengikuti permission akun Anda.
      </p>

      <div className="sso-apps">
        {apps.map((key) => (
          <Link key={key} className="sso-app" href={landingHref(actor.permissions, key)}>
            <span className="brand-mark">{APPS[key].mark}</span>
            <span className="t">
              <b>{APPS[key].name}</b>
              <small>{APPS[key].desc}</small>
            </span>
            <Icon name="chev" size={15} />
          </Link>
        ))}
      </div>

      <form action={logout} className="auth-foot">
        <button className="btn sm ghost" type="submit">
          <Icon name="out" size={13} /> Keluar
        </button>
      </form>
    </div>
  );
}
