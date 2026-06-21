"use client";

import { useState, useCallback } from "react";
import { useCoAgent, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import UploadForm from "@/components/UploadForm";
import { PlanApproval } from "@/components/PlanApproval";
import { QuizQuestion } from "@/components/QuizQuestion";
import { StudySidebar } from "@/components/StudySidebar";
import { GraphStateType } from "@/agent/state";

type Step = "upload" | "plan" | "quiz";

function StepRail({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "plan", label: "Plan" },
    { id: "quiz", label: "Quiz" },
  ];
  const order: Step[] = ["upload", "plan", "quiz"];
  const currentIdx = order.indexOf(current);

  return (
    <div className="flex items-center gap-0 mb-10">
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  done ? "bg-teal-600 text-white" : active ? "bg-teal-600 text-white ring-4 ring-teal-100" : "bg-stone-200 text-stone-400",
                ].join(" ")}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={["text-xs font-medium", active ? "text-teal-700" : done ? "text-teal-600" : "text-stone-400"].join(" ")}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={["h-0.5 w-16 mx-2 mb-4 transition-colors", i < currentIdx ? "bg-teal-600" : "bg-stone-200"].join(" ")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-6 h-6 text-teal-600 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function Home() {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const { appendMessage: sendMessage } = useCopilotChat();
  const { state, setState, running } = useCoAgent<GraphStateType>({
    name: "ai-lesson-agent",
    initialState: {
      documentId: "",
      extractedText: "",
      plan: "",
      planApproved: false,
      prerequisites: [],
      objectives: [],
      currentObjectiveIndex: 0,
      currentQuestion: "",
      answerKey: "",
      attemptCount: 0,
      evalAttemptCount: 0,
      pendingAnswer: null,
      lastResult: null,
      attempts: [],
      messages: [],
    },
  });

  function handleUpload(id: string) {
    setDocumentId(id);
    setState((prev) => ({ ...prev!, documentId: id, extractedText: "" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendMessage(new TextMessage({ id: crypto.randomUUID(), content: "__start__", role: Role.User }));
  }

  const resume = useCallback(async (resumeValue: string) => {
    const activeRes = await fetch("/api/langgraph/active-thread");
    const { thread_id: lgThreadId } = await activeRes.json();
    if (!lgThreadId) return;

    setResuming(true);
    try {
      const res = await fetch(`/api/langgraph/threads/${lgThreadId}/runs/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: { resume: resumeValue } }),
      });
      const reader = res.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      const stateRes = await fetch(`/api/langgraph/threads/${lgThreadId}/state`);
      if (stateRes.ok) {
        const graphState = await stateRes.json();
        if (graphState?.values) setState(() => graphState.values as GraphStateType);
      }
    } finally {
      setResuming(false);
    }
  }, [setState]);

  const handlePlanApprove = useCallback(async (text: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    await resume(JSON.stringify(parsed));
  }, [resume]);

  const handleQuizAnswer = useCallback(async (index: number) => {
    await resume(JSON.stringify({ selectedIndex: index }));
  }, [resume]);

  const handleContinue = useCallback(async () => {
    await resume(JSON.stringify({ continue: true }));
  }, [resume]);

  const showPlanApproval = documentId && !running && state.plan && !state.planApproved;
  const showQuiz = documentId && !running && state.planApproved && state.currentQuestion;

  const isComplete =
    documentId &&
    !running &&
    (state.objectives?.length ?? 0) > 0 &&
    state.currentObjectiveIndex >= state.objectives.length;

  const recapText = (() => {
    if (!isComplete) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last = state.messages?.findLast((m: any) => {
      const c = String(m.content ?? "");
      return (m._getType?.() === "ai" || m.role === "assistant") && c.startsWith("## Session");
    });
    return last ? String((last as { content: unknown }).content) : null;
  })();

  const recapStats = (() => {
    if (!isComplete) return null;
    const records = (state.attempts ?? []).map((a: string) => {
      try { return JSON.parse(a); } catch { return null; }
    }).filter(Boolean) as Array<{ objectiveIndex: number; attemptNumber: number; resolution: string | null }>;

    // Per objective: max attempt number seen and whether eventually correct
    const byObj = new Map<number, { maxAttempt: number; correct: boolean }>();
    for (const r of records) {
      const cur = byObj.get(r.objectiveIndex);
      byObj.set(r.objectiveIndex, {
        maxAttempt: Math.max(cur?.maxAttempt ?? 0, r.attemptNumber ?? 1),
        correct: r.resolution === "correct" || cur?.correct === true,
      });
    }

    const firstTry = [...byObj.entries()]
      .filter(([, v]) => v.correct && v.maxAttempt === 1)
      .map(([i]) => state.objectives?.[i]).filter(Boolean) as string[];
    const struggled = [...byObj.entries()]
      .filter(([, v]) => v.correct && v.maxAttempt > 1)
      .map(([i, v]) => ({ label: state.objectives?.[i] as string, attempts: v.maxAttempt }))
      .filter((x) => x.label);

    return {
      correct: [...byObj.values()].filter((v) => v.correct).length,
      total: state.objectives?.length ?? 0,
      firstTry,
      struggled,
    };
  })();

  const studyTips = (() => {
    if (!recapText) return [];
    const match = recapText.match(/\*\*Study tips:\*\*\n([\s\S]+)/);
    if (!match) return [];
    return match[1].trim().split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  })();

  // derive active step for the rail
  const activeStep: Step = !documentId ? "upload" : showPlanApproval ? "plan" : "quiz";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 sm:p-10">
      {/* Upload screen */}
      {!documentId && (
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-600 mb-4">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-stone-900">AI Lesson Agent</h1>
            <p className="mt-1 text-stone-500 text-sm">Upload a PDF and get a personalized quiz</p>
          </div>
          <UploadForm onUpload={handleUpload} />
        </div>
      )}

      {/* Post-upload screens: show step rail */}
      {documentId && (
        <div className="w-full max-w-2xl animate-fade-in">
          {/* Hide step rail during generation — only show when there's actionable UI */}
          {(showPlanApproval || showQuiz || isComplete) && <StepRail current={activeStep} />}

          {/* Generating plan */}
          {running && !state.planApproved && (
            <div className="flex flex-col items-center gap-4 py-16">
              <Spinner />
              <p className="text-stone-600 text-sm">Analyzing your lesson and building a plan…</p>
            </div>
          )}

          {/* Plan approval */}
          {showPlanApproval && (
            <PlanApproval plan={state.plan} onApprove={handlePlanApprove} />
          )}

          {/* Generating quiz / between questions */}
          {(running && state.planApproved) || (resuming && state.planApproved && !showQuiz) ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <Spinner />
              <p className="text-stone-600 text-sm">
                {state.evalAttemptCount > 0
                  ? `Refining question… (attempt ${state.evalAttemptCount + 1} of 3)`
                  : `Preparing question ${state.currentObjectiveIndex + 1} of ${state.objectives.length}…`}
              </p>
            </div>
          ) : null}

          {/* Quiz */}
          {showQuiz && (() => {
            try {
              const { question, choices } = JSON.parse(state.currentQuestion);
              return (
                <QuizQuestion
                  question={question}
                  choices={choices}
                  hint={state.lastHint ?? undefined}
                  result={state.lastResult ?? undefined}
                  loading={resuming}
                  objectiveIndex={state.currentObjectiveIndex}
                  totalObjectives={state.objectives.length}
                  onSelect={handleQuizAnswer}
                  onContinue={handleContinue}
                />
              );
            } catch {
              return null;
            }
          })()}

          {/* Complete */}
          {isComplete && recapStats && (
            <div className="animate-fade-in">
              {/* Score */}
              <div className="flex flex-col items-center gap-3 mb-8">
                <div className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">{recapStats.correct}/{recapStats.total}</span>
                </div>
                <h2 className="text-xl font-semibold text-stone-900">Session complete</h2>
                <p className="text-stone-500 text-sm">
                  {recapStats.correct === recapStats.total ? "Perfect score!" : `${recapStats.correct} of ${recapStats.total} objectives mastered`}
                </p>
              </div>

              {recapStats.firstTry.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-3">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">First try ✓</p>
                  <ul className="space-y-1.5">
                    {recapStats.firstTry.map((obj, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-green-900">
                        <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                        {obj}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recapStats.struggled.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-3">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Needed more attempts</p>
                  <ul className="space-y-1.5">
                    {recapStats.struggled.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                        <span className="text-amber-500 mt-0.5 flex-shrink-0">↩</span>
                        <span>{s.label} <span className="text-amber-600 text-xs">({s.attempts} tries)</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {studyTips.length > 0 && (
                <div className="bg-white border border-stone-200 rounded-xl p-4 mb-6">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Study tips</p>
                  <ul className="space-y-2">
                    {studyTips.map((tip, i) => (
                      <li key={i} className="text-sm text-stone-700 leading-snug flex items-start gap-2">
                        <span className="text-teal-500 mt-0.5 flex-shrink-0">→</span>
                        <span>{tip.replace(/\*\*(.*?)\*\*/g, "$1")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
                onClick={() => setDocumentId(null)}
              >
                Start a new lesson
              </button>
            </div>
          )}
        </div>
      )}

      {showQuiz && (
        <StudySidebar
          currentQuestion={state.currentQuestion || null}
          objective={state.objectives?.[state.currentObjectiveIndex] ?? null}
        />
      )}
    </main>
  );
}
