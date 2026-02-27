import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import LogoutButton from "@/app/components/LogoutButton";
import JobFeed from "./JobFeed";

interface JobMatch {
  id: string;
  job_title: string;
  company: string;
  location: string | null;
  salary_range: string | null;
  job_description: string | null;
  apply_url: string | null;
  match_score: number | null;
  match_reason: string | null;
  source: string | null;
  user_feedback: "liked" | "disliked" | null;
  created_at: string;
}

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

  // Fetch existing job matches (ordered by match score desc)
  const { data: jobMatches } = await supabase
    .from("job_matches")
    .select(
      "id, job_title, company, location, salary_range, job_description, apply_url, match_score, match_reason, source, user_feedback, created_at"
    )
    .eq("user_id", user.id)
    .order("match_score", { ascending: false })
    .order("created_at", { ascending: false });

  const initialMatches = (jobMatches as JobMatch[] | null) ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">J</span>
          </div>
          <span className="font-semibold text-gray-900">JobMatch AI</span>
        </Link>
        <LogoutButton />
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Your Job Feed</h1>
          <p className="text-gray-500 text-sm mt-1">
            Personalized matches based on your profile — rate them to improve future searches.
          </p>
        </div>

        <JobFeed initialMatches={initialMatches} />
      </div>
    </div>
  );
}
