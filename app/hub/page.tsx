import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import LogoutButton from "@/app/components/LogoutButton";

export default async function HubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check onboarding status
  const { data: profileData } = await supabase
    .from("user_profiles")
    .select("onboarding_complete")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as { onboarding_complete: boolean } | null;

  if (!profile?.onboarding_complete) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">J</span>
          </div>
          <span className="font-semibold text-gray-900">JobMatch AI</span>
        </Link>
        <LogoutButton />
      </header>
      <div className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Your Job Feed
        </h1>
        <p className="text-gray-500">
          Welcome back! Your personalized job matches will appear here.
        </p>
        <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400">
          <p className="text-4xl mb-4">🔍</p>
          <p className="font-medium text-gray-600">
            Job search coming in Step 5
          </p>
          <p className="text-sm mt-1">
            Your profile is saved. Check back after the job search engine is
            built.
          </p>
        </div>
      </div>
    </div>
  );
}
