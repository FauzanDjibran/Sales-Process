import { ProfileView } from "@/components/settings/profile-view";
import { requireAuth } from "@/lib/erp/auth";
import { profileFor } from "@/lib/erp/profile";

export const dynamic = "force-dynamic";

/** Profil Saya inside the Database shell, so the user stays in their application. */
export default async function DatabaseProfilePage() {
  const actor = await requireAuth("/database/profile");
  return (
    <main className="content">
      <div className="pad">
        <ProfileView profile={await profileFor(actor)} section="Database" />
      </div>
    </main>
  );
}
