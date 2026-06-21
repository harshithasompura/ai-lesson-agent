import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (accessCode) {
    const provided = req.headers.get("x-access-code") ?? "";
    if (provided !== accessCode) {
      return NextResponse.json({ error: "Invalid access code" }, { status: 401 });
    }
  }

  const form = await req.formData();
  const file = form.get("file");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  let text: string;
  try {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    text = result.text;
  } catch {
    return NextResponse.json({ error: "PDF extraction failed" }, { status: 422 });
  }

  if (!text.trim()) {
    return NextResponse.json(
      { error: "PDF has no extractable text — scanned or image-only PDFs are not supported" },
      { status: 422 }
    );
  }

  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 100) {
    return NextResponse.json(
      { error: `PDF too short (${wordCount} words) — needs at least 100 words of educational content` },
      { status: 422 }
    );
  }
  if (wordCount > 15000) {
    return NextResponse.json(
      { error: `PDF too long (${wordCount.toLocaleString()} words) — please upload a single chapter or lecture (max ~15,000 words)` },
      { status: 422 }
    );
  }

  const JUNK_PATTERNS = /^\s*(invoice|receipt|total due|amount due|bill to|purchase order|tax invoice|remittance)/im;
  if (JUNK_PATTERNS.test(text.slice(0, 500))) {
    return NextResponse.json(
      { error: "This looks like a financial document, not educational content" },
      { status: 422 }
    );
  }

  const { rows } = await db.query(
    "INSERT INTO documents (filename, extracted_text) VALUES ($1, $2) RETURNING id",
    [file.name, text]
  );

  return NextResponse.json({ documentId: rows[0].id });
}
