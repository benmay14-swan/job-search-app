import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const ONBOARDING_SYSTEM_PROMPT = `You are a warm, expert career coach helping job seekers find their ideal role. Your goal is to have a natural, friendly conversation to understand exactly what this person is looking for in their next job, so you can find excellent matches for them.

PERSONALITY & STYLE:
- Warm, conversational, and encouraging — like a brilliant friend who happens to be a career expert
- Keep each response brief: 2-4 sentences, then ask ONE focused question
- Never use bullet points or numbered lists — keep everything conversational prose
- Sound genuinely curious and interested in their story
- Acknowledge their answers naturally before asking the next question

INFORMATION TO GATHER (weave naturally into conversation — don't ask everything at once):
1. Job titles / role type they want
2. Industry preferences
3. Seniority level and years of experience
4. Core skills and areas of expertise
5. Required certifications, licenses, or credentials
6. Work authorization status (if relevant)
7. Location preferences: which city/region, and remote/hybrid/onsite preference
8. Salary expectations (range)
9. Schedule preferences (full-time, part-time, specific shifts, flexibility needed)
10. Company size preference (startup, mid-size, large enterprise)
11. Culture and work environment preferences
12. Deal-breakers — things they absolutely want to avoid
13. Recent work history highlights: current/last role, years of experience, key accomplishments

ROLE-SPECIFIC INTELLIGENCE (CRITICAL):
Analyze the role or field they mention, then ask the most contextually relevant follow-up questions for that specific type of work. Examples:

- Truck Driver → CDL class (A/B/C), route preference (local/regional/OTR), hazmat endorsement, preferred schedule, owner-operator vs company driver
- Software Engineer → primary tech stack, frontend/backend/full-stack preference, startup vs enterprise, remote preference, engineering culture they thrive in
- Nurse / Healthcare → specialty or unit (ICU, ER, L&D, etc.), travel nursing interest, preferred setting (hospital/clinic/home care/long-term care), shift preference, RN/LPN/NP/PA
- Teacher → grade level and subject, school type (public/private/charter/international), multi-state certification, district size preference
- Sales → industry sold into, inside vs outside vs enterprise/SaaS sales, average deal size, quota attainment history, commission-heavy vs base-heavy comp preference
- Designer → product vs marketing vs UX focus, tools (Figma/Sketch/etc.), B2B vs B2C preference, IC vs design team lead
- Finance/Accounting → function (FP&A/accounting/investment banking/PE/VC), CPA or CFA status, industry focus, public accounting vs industry
- Marketing → channel specialization (paid/SEO/content/brand/email), B2B vs B2C, startup vs enterprise, team lead vs IC
- Legal → practice area, firm size vs in-house, bar admissions, billable hours tolerance
- Trades (electrician, plumber, HVAC, carpenter) → license/certification level, commercial vs residential, union preference, overtime willingness

Apply this same intelligence to ANY role — always generate the most useful, specific questions for that field.

CONVERSATION FLOW:
1. Open warmly and ask what kind of work they're looking for
2. Based on their answer, immediately ask the most relevant role-specific follow-up
3. Continue gathering information naturally — one thoughtful question at a time
4. After gathering comprehensive information (roughly 10–15 exchanges), wrap up:
   a. Write a warm, specific 2–3 sentence summary of what you learned
   b. Ask them to confirm it sounds right or add anything important
   c. After they confirm, on the very last line of your final message, write exactly: <ONBOARDING_COMPLETE>

IMPORTANT: Only include <ONBOARDING_COMPLETE> after the user has confirmed your summary. Never rush — comprehensive information leads to better job matches.`;

export async function POST(request: NextRequest) {
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

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message } = body;

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "Message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Save user message to DB
  await supabase.from("onboarding_messages").insert({
    user_id: user.id,
    role: "user",
    content: message.trim(),
  });

  // Fetch full conversation history
  const { data: dbMessages } = await supabase
    .from("onboarding_messages")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const history = (dbMessages ?? []) as { role: string; content: string }[];

  // Anthropic requires messages to alternate and start with 'user'.
  // Our DB always starts with a user message (first send), so this is guaranteed.
  const claudeMessages: Anthropic.Messages.MessageParam[] = history.map(
    (m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })
  );

  // Set up streaming
  const encoder = new TextEncoder();
  let fullContent = "";

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: ONBOARDING_SYSTEM_PROMPT,
    messages: claudeMessages,
  });

  const readable = new ReadableStream({
    start(controller) {
      stream.on("text", (text) => {
        fullContent += text;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
        );
      });

      stream
        .finalMessage()
        .then(async () => {
          // Save assistant message to DB before signalling done
          if (fullContent) {
            const hasCompletionTag = fullContent.includes(
              "<ONBOARDING_COMPLETE>"
            );
            // Strip the control tag before storing
            const contentToStore = fullContent
              .replace("<ONBOARDING_COMPLETE>", "")
              .trim();

            await supabase.from("onboarding_messages").insert({
              user_id: user.id,
              role: "assistant",
              content: contentToStore,
            });

            // Signal done with completion status
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, complete: hasCompletionTag })}\n\n`
              )
            );
          } else {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ done: true, complete: false })}\n\n`
              )
            );
          }
          controller.close();
        })
        .catch((err) => {
          console.error("Anthropic stream error:", err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Stream failed" })}\n\n`
            )
          );
          controller.close();
        });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
