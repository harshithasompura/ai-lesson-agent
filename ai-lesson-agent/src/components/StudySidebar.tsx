"use client";

import { useState, useRef, useEffect, memo } from "react";

type Message = { role: "user" | "assistant"; content: string };

// Minimal markdown: bold, italic, inline code — no dep
function Markdown({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
          return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i} className="bg-stone-200 rounded px-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export const StudySidebar = memo(function StudySidebar({
  currentQuestion,
  objective,
}: {
  currentQuestion: string | null;
  objective: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear chat when question changes
  useEffect(() => {
    setMessages([]);
  }, [currentQuestion]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setStreaming(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next, currentQuestion, objective }),
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let reply = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: reply };
          return updated;
        });
      }
    }

    setStreaming(false);
  }

  const isRight = side === "right";

  return (
    <>
      {/* Toggle button — fixed to the chosen side */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          "fixed top-1/2 -translate-y-1/2 z-40 w-10 h-20 bg-teal-600 text-white shadow-lg flex items-center justify-center hover:bg-teal-700 transition-colors",
          isRight ? "right-0 rounded-l-xl" : "left-0 rounded-r-xl",
        ].join(" ")}
        aria-label="Toggle study assistant"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {/* Full-height panel */}
      {open && (
        <div
          className={[
            "fixed top-0 z-50 w-80 h-full bg-white shadow-2xl border-stone-200 flex flex-col",
            isRight ? "right-0 border-l" : "left-0 border-r",
          ].join(" ")}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-teal-600 text-white flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-sm font-semibold">Study Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              {/* Flip side */}
              <button
                onClick={() => setSide((s) => s === "right" ? "left" : "right")}
                className="p-1.5 rounded-lg hover:bg-teal-500 transition-colors"
                aria-label="Move to other side"
                title="Move to other side"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
              {/* Close */}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-teal-500 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-stone-400 text-center pt-8">
                Ask about concepts in this question.<br />I won&apos;t reveal the answer.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={`${i}-${m.role}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={[
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-teal-600 text-white"
                      : "bg-stone-100 text-stone-800",
                  ].join(" ")}
                >
                  {m.content ? <Markdown>{m.content}</Markdown> : <span className="animate-pulse">…</span>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-stone-100 flex gap-2 flex-shrink-0">
            <input
              className="flex-1 text-sm rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="Ask a question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              disabled={streaming}
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="px-3 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-40 transition-colors"
            >
              Ask
            </button>
          </div>
        </div>
      )}
    </>
  );
});
