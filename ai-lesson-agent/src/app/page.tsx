"use client";

import { useState } from "react";
import UploadForm from "@/components/UploadForm";

export default function Home() {
  const [documentId, setDocumentId] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black p-8">
      <h1 className="text-2xl font-semibold mb-8 text-zinc-900 dark:text-zinc-50">
        AI Lesson Agent
      </h1>
      {documentId ? (
        <p className="text-green-600 font-medium">
          Document uploaded. ID: <code>{documentId}</code>
        </p>
      ) : (
        <UploadForm onUpload={setDocumentId} />
      )}
    </main>
  );
}
