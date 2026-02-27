"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/app/components/LogoutButton";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// Hardcoded opener — always shown as the first message, not stored in DB
const OPENER =
  "Hi! I'm your AI career coach. I'm here to help you find job opportunities that are genuinely right for you. To get started — what kind of work are you looking for?";

export default function OnboardingChat({
  initialMessages,
}: {
  initialMessages: Message[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages or streaming text changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming || isComplete) return;

    setError(null);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsStreaming(true);
    setStreamingText("");

    try {
      const response = await fetch("/api/onboarding/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      if (!response.ok) {
        let msg = `Server error: ${response.status}`;
        try {
          const data = await response.json();
          if (data.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();

          try {
            const parsed = JSON.parse(payload);

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.text) {
              accumulated += parsed.text;
              // Strip the control tag from display
              const display = accumulated
                .replace("<ONBOARDING_COMPLETE>", "")
                .trimEnd();
              setStreamingText(display);
            }

            if (parsed.done) {
              const displayContent = accumulated
                .replace("<ONBOARDING_COMPLETE>", "")
                .trim();

              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: displayContent },
              ]);
              setStreamingText("");
              setIsStreaming(false);

              if (parsed.complete) {
                setIsComplete(true);
              }
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // ignore partial JSON
            throw parseErr;
          }
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
      setIsStreaming(false);
      setStreamingText("");
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save profile");
      }

      router.push("/hub");
    } catch (err) {
      console.error("Profile save error:", err);
      setIsSavingProfile(false);
      setError(
        err instanceof Error ? err.message : "Failed to save profile. Please try again."
      );
    }
  }

  const exchangeCount = Math.floor(messages.length / 2);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">J</span>
          </div>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">
            Career Coach
          </div>
          <div className="text-xs text-gray-400">
            {isComplete
              ? "Profile ready ✓"
              : exchangeCount === 0
                ? "Tell me about what you're looking for"
                : `${exchangeCount} exchange${exchangeCount !== 1 ? "s" : ""} — keep going`}
          </div>
        </div>
        {/* Progress bar */}
        {!isComplete && (
          <div className="flex-shrink-0 w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((exchangeCount / 12) * 100, 100)}%`,
              }}
            />
          </div>
        )}
        {isComplete && (
          <div className="flex-shrink-0 text-green-500 text-sm font-medium">
            ✓ Done
          </div>
        )}
        <LogoutButton />
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {/* Opener (always shown, not from DB) */}
          <AssistantBubble content={OPENER} />

          {/* History from DB */}
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <UserBubble key={i} content={msg.content} />
            ) : (
              <AssistantBubble key={i} content={msg.content} />
            )
          )}

          {/* Streaming response */}
          {isStreaming && (
            <AssistantBubble
              content={streamingText}
              isStreaming={!streamingText}
            />
          )}

          {/* Error */}
          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl max-w-md text-center">
                <p className="font-medium">Something went wrong</p>
                <p className="mt-1 text-red-600">{error}</p>
                {(error.toLowerCase().includes("credit") ||
                  error.toLowerCase().includes("billing") ||
                  error.toLowerCase().includes("balance")) && (
                  <p className="mt-2 text-xs text-red-500">
                    The AI service account is out of credits. Please contact
                    support or update the API key.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Completion CTA */}
          {isComplete && (
            <div className="pt-4 pb-2 flex flex-col items-center gap-3">
              <div className="text-center text-gray-500 text-sm max-w-sm">
                Your profile is built. Click below and I&apos;ll start finding
                jobs that match.
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-semibold text-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
              >
                {isSavingProfile ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Building your profile…
                  </>
                ) : (
                  <>Find my jobs →</>
                )}
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      {!isComplete && (
        <div className="bg-white border-t border-gray-100 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer… (Enter to send, Shift+Enter for new line)"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none border border-gray-200 rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition text-sm disabled:bg-gray-50 disabled:text-gray-400 max-h-40"
              style={{ overflow: "hidden" }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="flex-shrink-0 bg-indigo-600 text-white p-3 rounded-2xl hover:bg-indigo-700 active:bg-indigo-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
          <p className="text-center text-xs text-gray-300 mt-2">
            Shift+Enter for a new line
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AssistantBubble({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center mt-0.5">
        <span className="text-indigo-700 text-sm font-bold">J</span>
      </div>
      <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%] shadow-sm">
        {isStreaming ? (
          <TypingIndicator />
        ) : (
          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-3 items-start justify-end">
      <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center h-5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
