import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingChat from "./OnboardingChat";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // If already onboarded, send to hub
  const { data: profileData } = await supabase
    .from("user_profiles")
    .select("onboarding_complete")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as { onboarding_complete: boolean } | null;

  if (profile?.onboarding_complete) {
    redirect("/hub");
  }

  // Load existing conversation so user can resume if they left mid-onboarding
  const { data: msgData } = await supabase
    .from("onboarding_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const initialMessages = (msgData ?? []) as Array<{
    role: "user" | "assistant";
    content: string;
  }>;

  return <OnboardingChat initialMessages={initialMessages} />;
}
