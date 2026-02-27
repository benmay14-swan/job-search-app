import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let jobId: string;
  let feedback: string;

  try {
    const body = await req.json();
    jobId = body.jobId;
    feedback = body.feedback; // "liked" | "disliked" | null
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  if (feedback !== "liked" && feedback !== "disliked" && feedback !== null) {
    return NextResponse.json({ error: "feedback must be liked, disliked, or null" }, { status: 400 });
  }

  const { error } = await supabase
    .from("job_matches")
    .update({ user_feedback: feedback })
    .eq("id", jobId)
    .eq("user_id", user.id); // RLS enforced — users can only update their own

  if (error) {
    console.error("Feedback update error:", error);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
