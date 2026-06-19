import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const GraphState = Annotation.Root({
  documentId: Annotation<string>(),
  extractedText: Annotation<string>(),
  plan: Annotation<string>(),
  planApproved: Annotation<boolean>(),
  prerequisites: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  objectives: Annotation<string[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  currentObjectiveIndex: Annotation<number>(),
  currentQuestion: Annotation<string>(),
  // ponytail: answerKey kept in state but Tutor node must never receive it — CONSTITUTION §Principle 1
  answerKey: Annotation<string>(),
  attemptCount: Annotation<number>(),
  evalAttemptCount: Annotation<number>(),
  attempts: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

export type GraphStateType = typeof GraphState.State;
