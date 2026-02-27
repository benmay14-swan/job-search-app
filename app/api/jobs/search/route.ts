import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createClient } from "@/lib/supabase/server";

// Edge runtime: 30s execution window (vs 10s serverless on Hobby).
// SSE streaming keeps the connection alive throughout.
export const runtime = "edge";
export const dynamic = "force-dynamic";

const MIN_MATCH_SCORE = 7;

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
  const encoder = new TextEncoder();

  function sseEvent(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  // ── Auth + profile (before stream so we can return HTTP errors normally) ──
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return new Response(JSON.stringify({ error: "Profile not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Build readable profile strings for the prompt ──────────────────────────
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

  const titles = (profile.desired_job_titles as string[] | null) ?? [];
  const skills = (profile.skills as string[] | null) ?? [];
  const industries = (profile.industries as string[] | null) ?? [];
  const certs = (profile.certifications_licenses as string[] | null) ?? [];

  const primaryTitle = titles[0] ?? "professional";

  // ── Prompt ─────────────────────────────────────────────────────────────────
  // We ask for exactly 2–3 targeted searches to keep total time well under 30s.
  const searchPrompt = `You are a job placement specialist. Search the web to find 6–10 real, currently open job listings that are strong matches for this specific job seeker.

CANDIDATE PROFILE:
- Target roles: ${titles.join(", ") || "open"}
- Industries: ${industries.join(", ") || "any"}
- Seniority: ${profile.seniority_level || "not specified"}
- Experience: ${profile.years_experience != null ? `${profile.years_experience} years` : "not specified"}
- Top skills: ${skills.join(", ") || "not specified"}
- Certifications: ${certs.join(", ") || "none required"}
- Location: ${locationStr}
- Salary target: ${salaryStr}
- Schedule: ${profile.schedule_preferences || "full-time"}
- Company size: ${profile.company_size_preference || "any"}
- Work authorization: ${profile.work_authorization || "not specified"}
- Deal breakers: ${profile.deal_breakers || "none"}
- Background: ${profile.work_history_summary || "not provided"}

SEARCH INSTRUCTIONS:
Run 2–3 focused web searches to find real job postings. Use specific queries like:
- "${primaryTitle} jobs ${locationStr}"
- "${primaryTitle} ${skills.slice(0, 2).join(" ")} ${loc?.remote_preference === "remote" ? "remote" : locationStr}"

Only include jobs that score 7 or higher out of 10. Be selective.

CRITICAL — MATCH REASON RULES:
The "match_reason" field MUST be specific to this exact person. It MUST mention actual details from their profile such as:
- Their specific skills (e.g., "your Python and Spark experience")
- Their years of experience (e.g., "your ${profile.years_experience ?? "X"} years of experience")
- Their salary target (e.g., "fits your ${salaryStr} target")
- Their location/remote preference (e.g., "fully remote which matches your preference")
- Their background (reference their actual work history if provided)
Do NOT write generic sentences like "this matches your experience level" or "aligns with your preferences" — those are not acceptable. Every match_reason must be specific and personal.

Return ONLY a valid JSON array (no markdown fences, no text before or after). Schema:
[
  {
    "job_title": "exact title from the posting",
    "company": "company name",
    "location": "city, state or Remote",
    "salary_range": "$X–$Y or null if not listed",
    "job_description": "2–3 sentences describing the role and key requirements",
    "apply_url": "direct URL to the job posting",
    "match_score": 8,
    "match_reason": "Specific 1–2 sentence reason referencing actual details from this candidate's profile",
    "source": "LinkedIn or Indeed or Glassdoor or Company Site"
  }
]`;

  // ── SSE stream ──────────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      function send(data: Record<string, unknown>) {
        controller.enqueue(sseEvent(data));
      }

      function startHeartbeat() {
        heartbeatTimer = setInterval(() => {
          send({ status: "thinking" });
        }, 5000);
      }

      function stopHeartbeat() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }

      try {
        // First byte sent immediately — keeps Vercel connection alive
        send({ status: "searching", message: "Scanning job boards for your profile…" });
        startHeartbeat();

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

        const response = await anthropic.beta.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
          messages: [{ role: "user", content: searchPrompt }],
          betas: ["web-search-2025-03-05"],
        });

        stopHeartbeat();
        send({ status: "saving", message: "Scoring and saving your matches…" });

        // Extract final text from response
        const finalText = (response.content as BetaContentBlock[])
          .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("");

        // Parse JSON array
        let rawJobs: RawJob[] = [];
        const jsonMatch = finalText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) rawJobs = parsed;
          } catch {
            // ignore parse error — will result in empty array
          }
        }

        // Filter to quality matches only (≥ MIN_MATCH_SCORE)
        const qualityJobs = rawJobs.filter(
          (j) => typeof j.match_score === "number" && j.match_score >= MIN_MATCH_SCORE
        );

        if (qualityJobs.length === 0) {
          send({ status: "error", error: "No strong matches found. Try refreshing or updating your profile." });
          controller.close();
          return;
        }

        // Delete stale matches then insert fresh ones
        await supabase.from("job_matches").delete().eq("user_id", user.id);

        const jobRows = qualityJobs.map((job) => ({
          user_id: user.id,
          job_title: job.job_title || "Unknown Position",
          company: job.company || "Unknown Company",
          location: job.location ?? null,
          salary_range: job.salary_range ?? null,
          job_description: job.job_description ?? null,
          apply_url: job.apply_url ?? null,
          match_score: Math.min(10, Math.max(1, Math.round(job.match_score as number))),
          match_reason: job.match_reason ?? null,
          source: job.source ?? null,
        }));

        const { data: savedJobs, error: insertError } = await supabase
          .from("job_matches")
          .insert(jobRows)
          .select();

        if (insertError) {
          send({ status: "error", error: "Failed to save matches — please try again." });
          controller.close();
          return;
        }

        send({ status: "done", jobs: savedJobs ?? [] });
      } catch (err) {
        stopHeartbeat();
        const msg = err instanceof Error ? err.message : "Job search failed";
        send({ status: "error", error: msg });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // disable nginx buffering (Vercel proxy)
    },
  });
}
