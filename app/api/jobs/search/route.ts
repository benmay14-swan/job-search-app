import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RawJob {
  job_title?: string;
  company?: string;
  location?: string | null;
  salary_range?: string | null;
  job_description?: string | null;
  apply_url?: string | null;
  match_score?: number | null;
  match_reason?: string | null;
  source?: string | null;
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Build readable strings from profile
  const loc = profile.location_preferences as {
    cities?: string[];
    states?: string[];
    remote_preference?: string;
    radius_miles?: number;
  } | null;

  const locationParts: string[] = [];
  if (loc?.cities?.length) locationParts.push(loc.cities.join(", "));
  if (loc?.states?.length) locationParts.push(loc.states.join(", "));
  if (loc?.remote_preference) locationParts.push(`(${loc.remote_preference})`);
  const locationStr = locationParts.join(" ") || "flexible location";

  const salaryStr =
    profile.salary_min && profile.salary_max
      ? `$${Math.round(profile.salary_min / 1000)}k–$${Math.round(profile.salary_max / 1000)}k/year`
      : profile.salary_min
        ? `$${Math.round(profile.salary_min / 1000)}k+/year`
        : "flexible";

  const titles = (profile.desired_job_titles as string[] | null)?.join(", ") || "open";
  const skills = (profile.skills as string[] | null)?.join(", ") || "not specified";
  const industries = (profile.industries as string[] | null)?.join(", ") || "any";
  const certs = (profile.certifications_licenses as string[] | null)?.join(", ") || "none";

  const searchPrompt = `You are a job search specialist. Use the web_search tool to find 8–10 real, currently open job listings that match this job seeker's profile. Search multiple times with different queries to find diverse, relevant results.

JOB SEEKER PROFILE:
- Desired roles: ${titles}
- Industries: ${industries}
- Seniority/Level: ${profile.seniority_level || "not specified"}
- Years of experience: ${profile.years_experience ?? "not specified"}
- Key skills: ${skills}
- Certifications/Licenses required: ${certs}
- Location preference: ${locationStr}
- Salary target: ${salaryStr}
- Schedule: ${profile.schedule_preferences || "full-time"}
- Company size preference: ${profile.company_size_preference || "any"}
- Work authorization: ${profile.work_authorization || "not specified"}
- Deal breakers: ${profile.deal_breakers || "none specified"}
- Background summary: ${profile.work_history_summary || "not provided"}

INSTRUCTIONS:
1. Search for REAL, currently open job postings. Try queries like:
   - "${titles.split(",")[0]?.trim()} jobs ${locationStr}"
   - "${titles.split(",")[0]?.trim()} ${locationStr} site:linkedin.com"
   - "${titles.split(",")[0]?.trim()} ${locationStr} site:indeed.com"
   - Use additional skills/industry-specific searches as needed
2. Find 8–10 real job listings with actual apply URLs
3. Score each match 1–10 based on how well it fits THIS specific person
4. Explain in 1–2 sentences why each job is a good fit for this person specifically

After searching, return ONLY a valid JSON array (no markdown fences, no extra text before or after the JSON). Each object in the array must follow this exact structure:
[
  {
    "job_title": "exact title from the job posting",
    "company": "company name",
    "location": "city, state or Remote",
    "salary_range": "$X–$Y or null if not listed",
    "job_description": "2–3 sentence description of the role and key requirements",
    "apply_url": "actual URL to the job posting page",
    "match_score": 8,
    "match_reason": "1–2 sentence personalized explanation of why this fits this specific person",
    "source": "LinkedIn or Indeed or Glassdoor or Company Site"
  }
]`;

  // Call Claude with web search (server tool — Anthropic executes searches internally)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let responseContent: BetaContentBlock[] = [];

  try {
    const response = await anthropic.beta.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      messages: [{ role: "user", content: searchPrompt }],
      betas: ["web-search-2025-03-05"],
    });

    responseContent = response.content;
  } catch (err) {
    console.error("Claude web search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Job search failed" },
      { status: 500 }
    );
  }

  // Extract text blocks — Claude's final structured response
  const finalText = responseContent
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Parse the JSON array from the text
  let jobs: RawJob[] = [];
  try {
    const jsonMatch = finalText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        jobs = parsed;
      }
    }
  } catch (err) {
    console.error("JSON parse error:", err);
    console.error("Raw text:", finalText.slice(0, 1000));
    return NextResponse.json({ error: "Failed to parse job results" }, { status: 500 });
  }

  if (jobs.length === 0) {
    console.error("No jobs parsed from text:", finalText.slice(0, 500));
    return NextResponse.json({ error: "No jobs found" }, { status: 404 });
  }

  // Delete any existing matches for this user (fresh search replaces old)
  await supabase.from("job_matches").delete().eq("user_id", user.id);

  // Insert new matches
  const jobRows = jobs.map((job) => ({
    user_id: user.id,
    job_title: job.job_title || "Unknown Position",
    company: job.company || "Unknown Company",
    location: job.location ?? null,
    salary_range: job.salary_range ?? null,
    job_description: job.job_description ?? null,
    apply_url: job.apply_url ?? null,
    match_score:
      typeof job.match_score === "number"
        ? Math.min(10, Math.max(1, Math.round(job.match_score)))
        : 5,
    match_reason: job.match_reason ?? null,
    source: job.source ?? null,
  }));

  const { data: savedJobs, error: insertError } = await supabase
    .from("job_matches")
    .insert(jobRows)
    .select();

  if (insertError) {
    console.error("Insert error:", insertError);
    return NextResponse.json({ error: "Failed to save jobs" }, { status: 500 });
  }

  return NextResponse.json({ jobs: savedJobs, count: savedJobs?.length ?? 0 });
}
