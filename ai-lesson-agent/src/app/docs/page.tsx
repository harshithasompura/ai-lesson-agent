export default function DocsPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Nav */}
      <nav className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <a
            href="/"
            className="text-sm font-semibold text-stone-700 hover:text-teal-700 transition-colors"
          >
            &larr; Back to App
          </a>
          <span className="text-sm font-medium text-stone-500">
            AI Lesson Agent &middot; Docs
          </span>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-24">
        {/* Hero */}
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-full px-4 py-1.5 text-xs font-semibold text-teal-700 uppercase tracking-wide">
            AI EdTech
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-stone-900 leading-tight">
            AI Lesson Agent
          </h1>
          <p className="text-xl text-stone-600 leading-relaxed max-w-2xl">
            Upload any educational PDF. Get a personalized quiz where the AI{" "}
            <em>structurally cannot</em> give you the answers, even if you ask.
          </p>
        </section>

        {/* The Problem */}
        <section className="space-y-8">
          <SectionLabel>The Problem</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">
            Most AI tutors can be argued around.
          </h2>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                title: "No enforcement",
                body: '"Tell me the answer" works. The same model that grades your response can be talked into skipping the question.',
              },
              {
                title: "No isolation",
                body: "The model holding the answer key is the same one giving hints. One well-phrased question is enough to leak it.",
              },
              {
                title: "No ordering",
                body: "Questions arrive in list order, not dependency order. Students get tested on advanced concepts before foundational ones.",
              },
            ].map((p) => (
              <div
                key={p.title}
                className="bg-red-50 border border-red-100 rounded-xl p-5 space-y-2"
              >
                <div className="font-semibold text-stone-800">{p.title}</div>
                <div className="text-sm text-stone-600 leading-relaxed">
                  {p.body}
                </div>
              </div>
            ))}
          </div>

          <p className="text-lg text-stone-600 leading-relaxed">
            This project tackles all three by{" "}
            <strong className="text-stone-800">
              making the problems structurally impossible
            </strong>
            , not by writing stricter prompts.
          </p>
        </section>

        {/* What it does differently */}
        <section className="space-y-8">
          <SectionLabel>What Is Different</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">
            Construction guarantees, not prompt instructions.
          </h2>

          <div className="space-y-4">
            {[
              {
                title: "Quiz cannot be skipped",
                body: 'No graph edge exists for skipping. The agent is a state machine. There is no code path from "question presented" to "next question" without a submitted answer.',
              },
              {
                title: "Answers cannot leak to the hint path",
                body: "Three separate agents. The Tutor Agent is constructed without the answer key in its context. Not instructed to avoid it. Never given it.",
              },
              {
                title: "Questions follow prerequisite order",
                body: "Concept relationships are stored as a graph in Neo4j. The quiz picks the question with the fewest unresolved dependencies first, a topological sort of what needs to be learned.",
              },
              {
                title: "Questions are evaluated before you see them",
                body: "Every question is scored 0 to 5 by a second model before it reaches the user. Below threshold, it is regenerated with the critique fed back as context, up to 3 attempts.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex gap-4 bg-white border border-stone-200 rounded-xl p-5 shadow-sm"
              >
                <div className="space-y-1">
                  <div className="font-semibold text-stone-800">
                    {item.title}
                  </div>
                  <div className="text-sm text-stone-600 leading-relaxed">
                    {item.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="space-y-8">
          <SectionLabel>System Overview</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">
            Three agents. One pipeline.
          </h2>

          <p className="text-stone-600 leading-relaxed">
            Built on LangGraph. Each agent has a fixed role and a fixed view of
            state. Context is scoped by construction, not by instruction.
          </p>

          <div>
            <img
              src="/architecture.svg"
              alt="AI Lesson Agent architecture"
              className="w-full rounded-2xl border border-stone-200"
            />
          </div>
        </section>

        {/* How it works */}
        <section className="space-y-8">
          <SectionLabel>How It Works</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">
            From upload to recap.
          </h2>

          <div className="relative">
            <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-stone-200" />

            <div className="space-y-6">
              {[
                {
                  step: "1",
                  title: "Upload your PDF",
                  body: "Drop any educational document. The system validates it is real content, not a blank scan, and extracts the text.",
                  color: "teal",
                },
                {
                  step: "2",
                  title: "Review your learning plan",
                  body: "The Planner Agent reads the document and proposes a set of learning objectives. You can edit, remove, or add objectives before approving. New objectives are validated against the document before approval.",
                  color: "blue",
                },
                {
                  step: "3",
                  title: "The quiz begins",
                  body: "Questions are ordered by concept dependencies, foundations first. Each question is evaluated by a second model before you see it. Low-quality questions are regenerated automatically.",
                  color: "orange",
                },
                {
                  step: "4",
                  title: "Ask for a hint",
                  body: "Wrong answers unlock a hint from the Tutor Agent, which was never given the answer key. It can point you in the right direction. It cannot tell you the answer.",
                  color: "purple",
                },
                {
                  step: "5",
                  title: "Get your recap",
                  body: "When you finish, you get a summary of what you answered correctly on the first attempt, what you struggled with, and what concepts to revisit, ordered by prerequisite relationships.",
                  color: "green",
                },
              ].map((item) => (
                <div key={item.step} className="flex gap-6 relative">
                  <div
                    className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white z-10 shadow-sm ${stepColor(item.color)}`}
                  >
                    {item.step}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm flex-1">
                    <div className="font-semibold text-stone-800 mb-1">
                      {item.title}
                    </div>
                    <div className="text-sm text-stone-600 leading-relaxed">
                      {item.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 mt-24">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between text-xs text-stone-400">
          <span>AI Lesson Agent</span>
          <a
            href="https://github.com/harshithasompura/ai-lesson-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-stone-600 underline underline-offset-2 decoration-wavy transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-teal-600">
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center my-2">
      <svg
        className="w-5 h-5 text-stone-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

function AgentBox({
  color,
  label,
  sublabel,
}: {
  color: string;
  label: string;
  sublabel: string;
}) {
  const border: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50",
    orange: "border-orange-200 bg-orange-50",
    green: "border-green-200 bg-green-50",
    stone: "border-stone-200 bg-stone-50",
  };
  return (
    <div
      className={`rounded-xl border p-4 text-center space-y-1 ${border[color] ?? "border-stone-200 bg-stone-50"}`}
    >
      <div className="font-semibold text-stone-800 text-sm">{label}</div>
      <div className="text-xs text-stone-500 leading-relaxed">{sublabel}</div>
    </div>
  );
}

function stepColor(color: string) {
  const map: Record<string, string> = {
    teal: "bg-teal-500",
    blue: "bg-blue-500",
    orange: "bg-orange-500",
    purple: "bg-purple-500",
    green: "bg-green-600",
  };
  return map[color] ?? "bg-stone-500";
}
