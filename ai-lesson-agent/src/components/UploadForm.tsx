"use client";

import { useState, useRef, useCallback } from "react";

interface Props {
  onUpload: (documentId: string) => void;
}

export default function UploadForm({ onUpload }: Props) {
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [passcode, setPasscode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async (file: File) => {
    setStatus("uploading");
    setError(null);
    setFileName(file.name);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: form,
      headers: { "x-access-code": passcode },
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus("error");
      setError(json.error ?? "Upload failed");
      return;
    }

    setStatus("idle");
    onUpload(json.documentId);
  }, [onUpload, passcode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (file) submit(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/pdf" || file.name.endsWith(".pdf"))) submit(file);
    else setError("Only PDF files are supported");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }

  const uploading = status === "uploading";

  return (
    <form onSubmit={handleSubmit}>
      {/* Drop zone */}
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all",
          dragging
            ? "border-teal-500 bg-teal-50"
            : fileName
            ? "border-teal-400 bg-teal-50/50"
            : "border-stone-300 hover:border-teal-400 hover:bg-stone-50",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          onChange={handleFileChange}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <svg className="w-8 h-8 text-teal-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-stone-500">Uploading {fileName}…</p>
          </div>
        ) : fileName ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-stone-700">{fileName}</p>
            <p className="text-xs text-stone-400">Click to change file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-700">Drop a PDF here</p>
              <p className="text-xs text-stone-400 mt-0.5">or click to browse</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
      )}

      <input
        type="password"
        placeholder="Access code"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        className="mt-3 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />

      <button
        type="submit"
        disabled={uploading || !fileName || !passcode.trim()}
        className="mt-4 w-full py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? "Uploading…" : "Upload & Start"}
      </button>
    </form>
  );
}
