import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // If already onboarded, go to hub
  const { data: profileData } = await supabase
    .from("user_profiles")
    .select("onboarding_complete")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as { onboarding_complete: boolean } | null;

  if (profile?.onboarding_complete) {
    redirect("/hub");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4">
      <div className="max-w-xl w-full text-center">
        <div className="text-4xl mb-4">💬</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Let&apos;s get you set up
        </h1>
        <p className="text-gray-500 mb-8">
          Onboarding chat coming in Step 2. Your account is ready!
        </p>
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-left text-sm text-gray-500">
          <p className="font-medium text-gray-700 mb-2">
            Logged in as: {user.email}
          </p>
          <p>User ID: {user.id}</p>
        </div>
      </div>
    </div>
  );
}
