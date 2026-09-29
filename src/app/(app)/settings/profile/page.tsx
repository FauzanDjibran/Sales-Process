import { ProfileView } from "@/components/settings/profile-view";
import { requireAuth } from "@/lib/erp/auth";
import { profileFor } from "@/lib/erp/profile";

export const dynamic = "force-dynamic";

/**
 * Authentication is the only requirement. Own-profile access is deliberately
 * not a permission — see the note in `lib/erp/profile.ts`.
 */
export default async function ProfilePage() {
  const actor = await requireAuth("/settings/profile");
  return <ProfileView profile={await profileFor(actor)} />;
}
