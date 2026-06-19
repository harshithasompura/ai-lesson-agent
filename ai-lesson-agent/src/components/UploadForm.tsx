"use client";

import { useState, useRef } from "react";

interface Props {
  onUpload: (documentId: string) => void;
}

export default function UploadForm({ onUpload }: Props) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setError(null);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus("error");
      setError(json.error ?? "Upload failed");
      return;
    }

    setStatus("idle");
    onUpload(json.documentId);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6 max-w-md">
      <label className="text-sm font-medium">Upload a PDF lesson</label>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        required
        className="file:mr-4 file:py-2 file:px-4 file:border-0 file:rounded file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
      />
      <button
        type="submit"
        disabled={status === "uploading"}
        className="py-2 px-4 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {status === "uploading" ? "Uploading…" : "Upload"}
      </button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  );
}
