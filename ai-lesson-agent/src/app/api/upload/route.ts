import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: "PDF contains no extractable text" }, { status: 422 });
  }

  const { rows } = await db.query(
    "INSERT INTO documents (filename, extracted_text) VALUES ($1, $2) RETURNING id",
    [file.name, text]
  );

  return NextResponse.json({ documentId: rows[0].id });
}
