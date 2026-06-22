import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

const llm = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", maxTokens: 256 });

export async function POST(req: NextRequest) {
  const { objective, documentId } = await req.json() as { objective: string; documentId: string };

  if (!objective?.trim() || !documentId) {
    return NextResponse.json({ error: "Missing objective or documentId" }, { status: 400 });
  }

  const { rows } = await db.query(
    "SELECT extracted_text FROM documents WHERE id = $1",
    [documentId]
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const summary = rows[0].extracted_text.split(/\s+/).slice(0, 500).join(" ");

  const prompt = `You are validating a learning objective for a lesson based on a document.
Document summary (first 500 words): ${summary}
Proposed objective: ${objective}

Is this objective plausibly derived from or related to the document?
Answer JSON only, no other text: {"valid": boolean, "hint": string}
hint = "" if valid, else a 1-sentence guidance like "This objective is about X which doesn't appear in the document. Try: <suggestion based on document>."`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  const text = typeof response.content === "string" ? response.content : "";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? text) as { valid: boolean; hint: string };
    return NextResponse.json({ valid: parsed.valid, hint: parsed.hint ?? "" });
  } catch {
    return NextResponse.json({ valid: true, hint: "" });
  }
}
