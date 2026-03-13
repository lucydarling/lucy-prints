"use client";

import { useState } from "react";
import { useSaveStore } from "@/store/save-store";

export function SaveButton() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const setShowSaveModal = useSaveStore((s) => s.setShowSaveModal);
  const uploadQueue = useSaveStore((s) => s.uploadQueue);
  const uploadingSlot = useSaveStore((s) => s.uploadingSlot);
  const uploadedSlots = useSaveStore((s) => s.uploadedSlots);
  const uploadErrors = useSaveStore((s) => s.uploadErrors);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // No session yet — show "Save My Progress"
  if (!sessionToken) {
    return (
      <button
        onClick={() => setShowSaveModal(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full shadow-sm transition-colors border"
        style={{
          backgroundColor: "#FFF5F3",
          borderColor: "#FAB8A9",
          color: "#D4857A",
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        Save My Progress
      </button>
    );
  }

  // Session exists — show sync status
  const isUploading = uploadingSlot !== null || uploadQueue.length > 0;
  const errorCount = Object.keys(uploadErrors).length;
  const totalSynced = uploadedSlots.length;

  if (isUploading) {
    const remaining = uploadQueue.length + (uploadingSlot ? 1 : 0);
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white rounded-full shadow-sm border border-gray-200">
        <svg className="w-3.5 h-3.5 animate-spin text-[#FAB8A9]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Syncing {remaining}...
      </div>
    );
  }

  if (errorCount > 0) {
    return (
      <button
        onClick={() => {
          // Retry: re-queue errored slots
          const errorKeys = Object.keys(uploadErrors);
          const addToUploadQueue = useSaveStore.getState().addToUploadQueue;
          // Clear errors first by marking them as not-uploaded so they can be re-queued
          const state = useSaveStore.getState();
          useSaveStore.setState({
            uploadErrors: {},
            uploadedSlots: state.uploadedSlots.filter((k) => !errorKeys.includes(k)),
          });
          addToUploadQueue(errorKeys);
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-full shadow-sm border border-amber-200 hover:bg-amber-100 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        {errorCount} failed — tap to retry
      </button>
    );
  }

  // All synced — show saved status with resend link option
  const handleResend = async () => {
    if (!sessionToken || resending) return;
    setResending(true);
    try {
      await fetch("/api/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch {
      // Silent fail — non-critical
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-full shadow-sm border border-green-200">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        {totalSynced > 0 ? `${totalSynced} saved` : "Saved"}
      </div>
      <button
        onClick={handleResend}
        disabled={resending}
        className="text-[10px] text-gray-400 hover:text-gray-600 underline transition-colors disabled:opacity-50"
      >
        {resent ? "Link sent!" : resending ? "Sending..." : "Resend my link"}
      </button>
    </div>
  );
}
