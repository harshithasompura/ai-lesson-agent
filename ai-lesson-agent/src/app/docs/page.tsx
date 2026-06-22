export default function DocsPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Nav */}
      <nav className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold text-stone-700 hover:text-teal-700 transition-colors">
            <span className="text-teal-600">←</span> Back to App
          </a>
          <span className="text-sm font-medium text-stone-500">AI Lesson Agent · Docs</span>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-24">

        {/* Hero */}
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-full px-4 py-1.5 text-xs font-semibold text-teal-700 uppercase tracking-wide">
            AI EdTech · Skills Assessment Project
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-stone-900 leading-tight">
            AI Lesson Agent
          </h1>
          <p className="text-xl text-stone-600 leading-relaxed max-w-2xl">
            Upload any educational PDF. Get a personalized quiz — where the AI{" "}
            <em>structurally cannot</em> give you the answers, even if you ask.
          </p>
        </section>

        {/* Story / The Problem */}
        <section className="space-y-8">
          <SectionLabel>The Story</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">Most AI tutors can be argued around.</h2>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: "⚠️",
                title: "No enforcement",
                body: "\"Tell me the answer\" works. The same LLM that grades your response can be talked into skipping the question entirely.",
              },
              {
                icon: "🔓",
                title: "No isolation",
                body: "The AI holding the answer key is the same one giving your hints. One cleverly-phrased question leaks it.",
              },
              {
                icon: "🔀",
                title: "No ordering",
                body: "Questions arrive in list order, not dependency order. You get tested on advanced concepts before you've understood the foundations.",
              },
            ].map((p) => (
              <div key={p.title} className="bg-red-50 border border-red-100 rounded-xl p-5 space-y-2">
                <div className="text-2xl">{p.icon}</div>
                <div className="font-semibold text-stone-800">{p.title}</div>
                <div className="text-sm text-stone-600 leading-relaxed">{p.body}</div>
              </div>
            ))}
          </div>

          <p className="text-lg text-stone-600 leading-relaxed">
            This project tackles all three — not by writing better prompts, but by{" "}
            <strong className="text-stone-800">making the problems structurally impossible</strong>.
          </p>
        </section>

        {/* What it does differently */}
        <section className="space-y-8">
          <SectionLabel>What's Different</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">Construction guarantees, not prompt instructions.</h2>

          <div className="space-y-4">
            {[
              {
                icon: "🚧",
                title: "Quiz cannot be skipped",
                body: "No graph edge exists for skipping. The AI agent is a state machine — there is literally no code path from \"question presented\" to \"next question\" without a submitted answer.",
              },
              {
                icon: "🔒",
                title: "Answers can't leak to the hint path",
                body: "Three separate agents. The Tutor Agent — the one giving hints — is constructed without the answer key ever in its context. Not instructed to avoid it. Never given it.",
              },
              {
                icon: "📐",
                title: "Questions follow prerequisite order",
                body: "Concept relationships are stored as a graph (Neo4j). The quiz picks the question with fewest unresolved dependencies first — a topological sort of what you need to learn.",
              },
              {
                icon: "✅",
                title: "Questions self-evaluate before you see them",
                body: "Every question is scored 0–5 by a second AI judge before it reaches you. If it scores too low, it's regenerated — up to 3 times.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4 bg-white border border-stone-200 rounded-xl p-5 shadow-sm">
                <div className="text-2xl flex-shrink-0 mt-0.5">{item.icon}</div>
                <div className="space-y-1">
                  <div className="font-semibold text-stone-800">{item.title}</div>
                  <div className="text-sm text-stone-600 leading-relaxed">{item.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Who is this for */}
        <section className="space-y-8">
          <SectionLabel>Who Is This For</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">Anyone learning from a document.</h2>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                emoji: "🎓",
                persona: "Students",
                use: "Turn lecture slides or textbook chapters into a quiz before an exam.",
              },
              {
                emoji: "📚",
                persona: "Self-learners",
                use: "Upload a technical paper, whitepaper, or guide and test your comprehension.",
              },
              {
                emoji: "🏢",
                persona: "Teams & L&D",
                use: "Onboarding docs, compliance materials, internal policies — test that people actually read them.",
              },
              {
                emoji: "🧑‍💻",
                persona: "Educators",
                use: "Generate formative assessments from existing course content without writing questions by hand.",
              },
            ].map((p) => (
              <div key={p.persona} className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm">
                <div className="text-3xl mb-3">{p.emoji}</div>
                <div className="font-semibold text-stone-800 mb-1">{p.persona}</div>
                <div className="text-sm text-stone-600 leading-relaxed">{p.use}</div>
              </div>
            ))}
          </div>
        </section>

        {/* High-level architecture diagram */}
        <section className="space-y-8">
          <SectionLabel>System Overview</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">Three agents. One pipeline. No shortcuts.</h2>

          <p className="text-stone-600 leading-relaxed">
            Under the hood, this is a multi-agent system built on LangGraph. Each agent has a specific role — and specific things it&apos;s never allowed to see.
          </p>

          {/* Agent diagram */}
          <div className="bg-white border border-stone-200 rounded-2xl p-8 shadow-sm overflow-x-auto">
            <div className="min-w-[560px]">
              {/* User row */}
              <div className="flex justify-center mb-6">
                <AgentBox color="stone" label="You" sublabel="Upload PDF · Review plan · Answer questions" icon="👤" />
              </div>

              {/* Arrow down */}
              <Arrow />

              {/* Three agents row */}
              <div className="grid grid-cols-3 gap-4 mb-2">
                <AgentBox color="blue" label="Planner Agent" sublabel="Reads your PDF · Builds a learning plan · Waits for your approval" icon="📋" />
                <AgentBox color="orange" label="Quiz Agent" sublabel="Writes questions · Self-evaluates them · Grades your answers" icon="❓" />
                <AgentBox color="green" label="Tutor Agent" sublabel="Gives hints when you're stuck · Writes your final recap" icon="💡" />
              </div>

              {/* Agent flow arrows */}
              <div className="grid grid-cols-3 gap-4 mb-2">
                <div className="flex justify-center"><span className="text-stone-300 text-sm">→ hands off to →</span></div>
                <div className="flex justify-center"><span className="text-stone-300 text-sm">→ hands off to →</span></div>
                <div />
              </div>

              {/* Key constraint callout */}
              <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-center">
                <strong>Key design constraint:</strong> The Tutor Agent is constructed without the answer key — it can give hints, but it literally cannot tell you the answer.
              </div>
            </div>
          </div>
        </section>

        {/* Simple flow */}
        <section className="space-y-8">
          <SectionLabel>How It Works</SectionLabel>
          <h2 className="text-3xl font-bold text-stone-900">Five steps, start to finish.</h2>

          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-stone-200" />

            <div className="space-y-6">
              {[
                {
                  step: "1",
                  title: "Upload your PDF",
                  body: "Drop any educational document. The system validates it's real content (not a blank scan or a menu) and extracts the text.",
                  color: "teal",
                },
                {
                  step: "2",
                  title: "Review your learning plan",
                  body: "The Planner Agent reads the whole document and proposes a set of learning objectives. You can edit, remove, or add objectives before approving. Everything is validated against the document — you can't add objectives that aren't in there.",
                  color: "blue",
                },
                {
                  step: "3",
                  title: "The quiz begins",
                  body: "Questions are ordered by concept dependencies — foundations first. Each question is checked by a second AI before you see it. If the question is ambiguous or low-quality, it's regenerated automatically.",
                  color: "orange",
                },
                {
                  step: "4",
                  title: "Stuck? Ask for a hint.",
                  body: "Wrong answers unlock a hint. The hint comes from the Tutor Agent, which never had access to the answer key. It can point you toward the right direction — but it can't tell you the answer.",
                  color: "purple",
                },
                {
                  step: "5",
                  title: "Get your recap",
                  body: "When you finish, you get a personalised summary: what you got right first try, what you struggled with, and what concepts to revisit — ordered by prerequisite relationships.",
                  color: "green",
                },
              ].map((item) => (
                <div key={item.step} className="flex gap-6 relative">
                  <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white z-10 shadow-sm ${stepColor(item.color)}`}>
                    {item.step}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm flex-1">
                    <div className="font-semibold text-stone-800 mb-1">{item.title}</div>
                    <div className="text-sm text-stone-600 leading-relaxed">{item.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-teal-600 rounded-2xl p-10 text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">Ready to try it?</h2>
          <p className="text-teal-100 text-sm">Upload a PDF and have your first lesson in under a minute.</p>
          <a
            href="/"
            className="inline-block bg-white text-teal-700 font-semibold px-6 py-3 rounded-lg hover:bg-teal-50 transition-colors text-sm shadow"
          >
            Start a lesson →
          </a>
        </section>

      </main>

      <footer className="border-t border-stone-200 py-8 text-center text-xs text-stone-400">
        AI Lesson Agent · Built as a Senior AI Agents Engineer assessment
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
      <svg className="w-5 h-5 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

function AgentBox({ color, label, sublabel, icon }: { color: string; label: string; sublabel: string; icon: string }) {
  const border: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50",
    orange: "border-orange-200 bg-orange-50",
    green: "border-green-200 bg-green-50",
    stone: "border-stone-200 bg-stone-50",
  };
  return (
    <div className={`rounded-xl border p-4 text-center space-y-1 ${border[color] ?? "border-stone-200 bg-stone-50"}`}>
      <div className="text-2xl">{icon}</div>
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
