import { ProfileView } from "@/components/settings/profile-view";
import { requireAuth } from "@/lib/erp/auth";
import { profileFor } from "@/lib/erp/profile";

export const dynamic = "force-dynamic";

/** Profil Saya inside the Produksi shell (P254), so the user stays in their application. */
export default async function ProductionProfilePage() {
  const actor = await requireAuth("/production/profile");
  return <ProfileView profile={await profileFor(actor)} section="Produksi" />;
}
