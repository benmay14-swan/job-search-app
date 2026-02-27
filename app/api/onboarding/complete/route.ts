import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Hardcoded opener matches what the client shows — include for full context
const OPENER =
  "Hi! I'm your AI career coach. I'm here to help you find job opportunities that are genuinely right for you. To get started — what kind of work are you looking for?";

const EXTRACTION_PROMPT = `Based on the following career coaching conversation, extract a structured job-seeker profile. Return ONLY valid JSON with no markdown fences, no explanation, no other text.

Conversation:
{TRANSCRIPT}

Return this exact JSON structure. Use null for any field not discussed. Use [] for string arrays not discussed. Extract salary numbers as integers (e.g. 120000 not "$120k"). Be thorough — include anything mentioned even briefly.

{
  "desired_job_titles": ["string"],
  "industries": ["string"],
  "seniority_level": "string or null",
  "skills": ["string"],
  "certifications_licenses": ["string"],
  "work_authorization": "string or null",
  "years_experience": "integer or null",
  "location_preferences": {
    "cities": ["string"],
    "states": ["string"],
    "remote_preference": "remote or hybrid or onsite or flexible or null",
    "radius_miles": "integer or null"
  },
  "salary_min": "integer or null",
  "salary_max": "integer or null",
  "schedule_preferences": "string or null",
  "company_size_preference": "string or null",
  "culture_preferences": "string or null",
  "deal_breakers": "string or null",
  "work_history_summary": "string or null"
}`;

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all onboarding messages
  const { data: dbMessages, error: fetchError } = await supabase
    .from("onboarding_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (fetchError || !dbMessages || dbMessages.length === 0) {
    return NextResponse.json(
      { error: "No onboarding messages found" },
      { status: 400 }
    );
  }

  const messages = dbMessages as { role: string; content: string }[];

  // Build formatted transcript (include opener for full context)
  const transcriptLines = [
    `Career Coach: ${OPENER}`,
    ...messages.map(
      (m) => `${m.role === "user" ? "Job Seeker" : "Career Coach"}: ${m.content}`
    ),
  ];
  const transcript = transcriptLines.join("\n\n");

  // Ask Claude to extract structured profile
  let profileJson: Record<string, unknown> = {};

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: EXTRACTION_PROMPT.replace("{TRANSCRIPT}", transcript),
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");

    // Extract JSON from the response (handle any stray text)
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    profileJson = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Profile extraction error:", err);
    // Proceed with empty profile rather than failing — user can edit later
  }

  // Parse location_preferences safely
  const rawLoc = profileJson.location_preferences as Record<string, unknown> | null;
  const locationPreferences = rawLoc
    ? {
        cities: Array.isArray(rawLoc.cities) ? rawLoc.cities : [],
        states: Array.isArray(rawLoc.states) ? rawLoc.states : [],
        remote_preference: rawLoc.remote_preference ?? null,
        radius_miles:
          typeof rawLoc.radius_miles === "number" ? rawLoc.radius_miles : null,
      }
    : null;

  // Upsert into user_profiles
  const { error: upsertError } = await supabase
    .from("user_profiles")
    .update({
      desired_job_titles: asStringArray(profileJson.desired_job_titles),
      industries: asStringArray(profileJson.industries),
      seniority_level: asString(profileJson.seniority_level),
      skills: asStringArray(profileJson.skills),
      certifications_licenses: asStringArray(profileJson.certifications_licenses),
      work_authorization: asString(profileJson.work_authorization),
      years_experience: asInt(profileJson.years_experience),
      location_preferences: locationPreferences,
      salary_min: asInt(profileJson.salary_min),
      salary_max: asInt(profileJson.salary_max),
      schedule_preferences: asString(profileJson.schedule_preferences),
      company_size_preference: asString(profileJson.company_size_preference),
      culture_preferences: asString(profileJson.culture_preferences),
      deal_breakers: asString(profileJson.deal_breakers),
      work_history_summary: asString(profileJson.work_history_summary),
      raw_onboarding_transcript: transcript,
      onboarding_complete: true,
      last_updated: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (upsertError) {
    console.error("Profile upsert error:", upsertError);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(n)) return n;
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}
