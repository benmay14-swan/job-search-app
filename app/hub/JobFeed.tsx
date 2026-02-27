"use client";

import { useEffect, useState, useCallback } from "react";

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

interface JobFeedProps {
  initialMatches: JobMatch[];
}

export default function JobFeed({ initialMatches }: JobFeedProps) {
  const [matches, setMatches] = useState<JobMatch[]>(initialMatches);
  const [isSearching, setIsSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string>("Scanning job boards for your profile…");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState<Record<string, boolean>>({});

  // Auto-trigger search on first load if no matches exist
  const runSearch = useCallback(async () => {
    setIsSearching(true);
    setSearchError(null);
    setSearchStatus("Scanning job boards for your profile…");

    try {
      const res = await fetch("/api/jobs/search", { method: "POST" });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Search failed (${res.status})`);
      }

      // Read the SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const event = JSON.parse(payload);

            if (event.status === "searching" || event.status === "saving") {
              setSearchStatus(event.message ?? "Working…");
            } else if (event.status === "thinking") {
              // heartbeat — update status to reassure the user
              setSearchStatus("Still searching, almost there…");
            } else if (event.status === "done") {
              setMatches(event.jobs ?? []);
              setIsSearching(false);
              return;
            } else if (event.status === "error") {
              throw new Error(event.error ?? "Search failed");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (initialMatches.length === 0) {
      runSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendFeedback(jobId: string, feedback: "liked" | "disliked") {
    // Toggle off if same feedback already applied
    const job = matches.find((m) => m.id === jobId);
    const newFeedback = job?.user_feedback === feedback ? null : feedback;

    // Optimistic update
    setMatches((prev) =>
      prev.map((m) => (m.id === jobId ? { ...m, user_feedback: newFeedback } : m))
    );
    setFeedbackPending((prev) => ({ ...prev, [jobId]: true }));

    try {
      await fetch("/api/jobs/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, feedback: newFeedback }),
      });
    } catch {
      // Revert optimistic update on error
      setMatches((prev) =>
        prev.map((m) => (m.id === jobId ? { ...m, user_feedback: job?.user_feedback ?? null } : m))
      );
    } finally {
      setFeedbackPending((prev) => ({ ...prev, [jobId]: false }));
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-14 h-14 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin mb-6" />
        <p className="text-lg font-semibold text-gray-800">Finding your matches…</p>
        <p className="text-sm text-indigo-500 mt-2 font-medium">{searchStatus}</p>
        <p className="text-xs text-gray-400 mt-1">Takes about 20–30 seconds</p>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (searchError && matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="font-semibold text-gray-800 mb-1">Search ran into an issue</p>
        <p className="text-sm text-red-600 mb-6 max-w-sm">{searchError}</p>
        <button
          onClick={runSearch}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Empty state (search returned nothing) ─────────────────────────────────
  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-4xl mb-4">🔍</div>
        <p className="font-semibold text-gray-800 mb-1">No matches found yet</p>
        <p className="text-sm text-gray-400 mb-6">We couldn&apos;t find matching jobs this time.</p>
        <button
          onClick={runSearch}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors"
        >
          Search again
        </button>
      </div>
    );
  }

  // ── Feed ──────────────────────────────────────────────────────────────────
  const liked = matches.filter((m) => m.user_feedback === "liked").length;
  const disliked = matches.filter((m) => m.user_feedback === "disliked").length;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-500">
            {matches.length} match{matches.length !== 1 ? "es" : ""} found
            {liked > 0 && ` · ${liked} liked`}
            {disliked > 0 && ` · ${disliked} skipped`}
          </p>
          {searchError && (
            <p className="text-xs text-amber-600 mt-0.5">{searchError}</p>
          )}
        </div>
        <button
          onClick={runSearch}
          disabled={isSearching}
          className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
        >
          <RefreshIcon />
          Refresh search
        </button>
      </div>

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
        {matches.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            feedbackPending={feedbackPending[job.id] ?? false}
            onFeedback={sendFeedback}
          />
        ))}
      </div>
    </div>
  );
}

// ── JobCard ────────────────────────────────────────────────────────────────

function JobCard({
  job,
  feedbackPending,
  onFeedback,
}: {
  job: JobMatch;
  feedbackPending: boolean;
  onFeedback: (id: string, feedback: "liked" | "disliked") => void;
}) {
  const score = job.match_score ?? 5;
  const scoreColor =
    score >= 8 ? "bg-emerald-100 text-emerald-700" :
    score >= 6 ? "bg-blue-100 text-blue-700" :
    "bg-gray-100 text-gray-500";

  return (
    <div
      className={`bg-white rounded-2xl border p-5 flex flex-col gap-4 transition-all ${
        job.user_feedback === "liked"
          ? "border-emerald-300 shadow-emerald-50 shadow-md"
          : job.user_feedback === "disliked"
            ? "border-gray-200 opacity-60"
            : "border-gray-100 hover:border-indigo-200 hover:shadow-sm"
      }`}
    >
      {/* Top row: score badge + source */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreColor}`}>
            {score}/10 match
          </span>
          {job.source && (
            <span className="text-xs text-gray-400 font-medium">{job.source}</span>
          )}
        </div>
        {job.location && (
          <span className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
            <LocationIcon />
            {job.location}
          </span>
        )}
      </div>

      {/* Title + Company */}
      <div>
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{job.job_title}</h3>
        <p className="text-sm text-indigo-600 font-medium mt-0.5">{job.company}</p>
      </div>

      {/* Salary */}
      {job.salary_range && (
        <p className="text-sm text-gray-600 font-medium">{job.salary_range}</p>
      )}

      {/* Description */}
      {job.job_description && (
        <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
          {job.job_description}
        </p>
      )}

      {/* Match reason */}
      {job.match_reason && (
        <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-indigo-700 mb-0.5">Why this fits you</p>
          <p className="text-xs text-indigo-600 leading-relaxed">{job.match_reason}</p>
        </div>
      )}

      {/* Bottom row: actions */}
      <div className="flex items-center justify-between pt-1 mt-auto">
        {/* Feedback buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFeedback(job.id, "liked")}
            disabled={feedbackPending}
            title="Good match"
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 ${
              job.user_feedback === "liked"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600"
            }`}
          >
            <ThumbsUpIcon filled={job.user_feedback === "liked"} />
            <span className="text-xs">Good fit</span>
          </button>
          <button
            onClick={() => onFeedback(job.id, "disliked")}
            disabled={feedbackPending}
            title="Not a good match"
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 ${
              job.user_feedback === "disliked"
                ? "bg-red-100 text-red-600"
                : "bg-gray-50 text-gray-500 hover:bg-red-50 hover:text-red-500"
            }`}
          >
            <ThumbsDownIcon filled={job.user_feedback === "disliked"} />
            <span className="text-xs">Not for me</span>
          </button>
        </div>

        {/* Apply button */}
        {job.apply_url ? (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Apply
            <ExternalLinkIcon />
          </a>
        ) : (
          <span className="text-xs text-gray-300">No link available</span>
        )}
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ThumbsUpIcon({ filled }: { filled: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-4 h-4"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5}>
      <path d="M1 8.25a1.25 1.25 0 112.5 0v7.5a1.25 1.25 0 01-2.5 0v-7.5zM11 3V1.7c0-.268.14-.526.395-.607A2 2 0 0114 3c0 .995-.182 1.948-.514 2.826-.204.54.166 1.174.744 1.174h2.52c1.243 0 2.261 1.01 2.146 2.247a23.864 23.864 0 01-2.096 7.828c-.28.59-.846.95-1.465.95H7.17c-.642 0-1.18-.475-1.23-1.113l-.394-4.914A2.516 2.516 0 017.99 9h1.011v-.005L11 3z" />
    </svg>
  );
}

function ThumbsDownIcon({ filled }: { filled: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-4 h-4"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5}>
      <path d="M18.905 12.75a1.25 1.25 0 01-2.5 0v-7.5a1.25 1.25 0 012.5 0v7.5zM8.905 17V18.3c0 .268-.14.526-.395.607A2 2 0 015.905 17c0-.995.182-1.948.514-2.826.204-.54-.166-1.174-.744-1.174h-2.52c-1.243 0-2.261-1.01-2.146-2.247a23.864 23.864 0 012.096-7.828C3.386 2.35 3.952 1.99 4.57 1.99h7.835c.642 0 1.18.475 1.23 1.113l.394 4.914A2.516 2.516 0 0111.91 11H10.9v.005L8.905 17z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path fillRule="evenodd" d="M8 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM2.5 6a5.5 5.5 0 1110.535 2.197l2.634 2.633a.75.75 0 01-1.06 1.061l-2.634-2.633A5.5 5.5 0 012.5 6z" clipRule="evenodd" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path d="M6.22 8.72a.75.75 0 001.06 1.06l5.22-5.22v1.69a.75.75 0 001.5 0v-3.5a.75.75 0 00-.75-.75h-3.5a.75.75 0 000 1.5h1.69L6.22 8.72z" />
      <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 007 4H4.75A2.75 2.75 0 002 6.75v4.5A2.75 2.75 0 004.75 14h4.5A2.75 2.75 0 0012 11.25V9a.75.75 0 00-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 01.75.75v3.182a.75.75 0 01-.75.75h-3.182a.75.75 0 010-1.5h1.37l-.84-.841a4.5 4.5 0 00-7.08 1.26.75.75 0 11-1.3-.75 6 6 0 019.44-1.681l.842.841V3.227a.75.75 0 01.75-.75zm-.911 7.5A.75.75 0 0112.165 11a4.5 4.5 0 01-7.08-1.26.75.75 0 011.3.75 3 3 0 004.942.84l.84-.84h-1.37a.75.75 0 010-1.5h3.182a.75.75 0 01.75.75v3.182a.75.75 0 01-1.5 0v-1.37l-.84.84z" clipRule="evenodd" />
    </svg>
  );
}
