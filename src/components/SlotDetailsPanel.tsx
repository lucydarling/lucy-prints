"use client";

import { useState, useCallback } from "react";
import { usePhotoStore } from "@/store/photo-store";
import {
  getPromptsForSlot,
  countFilledPrompts,
  type BookPrompt,
} from "@/lib/book-prompts";

interface SlotDetailsPanelProps {
  slotKey: string;
}

export function SlotDetailsPanel({ slotKey }: SlotDetailsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const notes = usePhotoStore((s) => s.notes);
  const setNote = usePhotoStore((s) => s.setNote);

  const slotPrompts = getPromptsForSlot(slotKey);
  if (!slotPrompts || slotPrompts.prompts.length === 0 || slotPrompts.standalone) {
    return null;
  }

  const { filled, total } = countFilledPrompts(slotKey, notes);

  return (
    <div className="mt-1">
      {/* Collapsed header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-rose-50/60 hover:bg-rose-50 transition-colors text-left"
      >
        <span className="text-xs text-gray-500 flex items-center gap-1.5">
          <span>📝</span>
          <span>{isExpanded ? "Hide details" : "Add details"}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          {total > 0 && (
            <span
              className={
                filled > 0 ? "text-rose-500 font-medium" : "text-gray-400"
              }
            >
              {filled}/{total}
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>

      {/* Expanded fields */}
      {isExpanded && (
        <div className="mt-1.5 px-3 py-3 rounded-lg bg-rose-50/40 space-y-3">
          {slotPrompts.prompts.map((prompt) => (
            <PromptField
              key={prompt.key}
              slotKey={slotKey}
              prompt={prompt}
              value={notes[slotKey]?.[prompt.key] || ""}
              onSave={setNote}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptField({
  slotKey,
  prompt,
  value,
  onSave,
}: {
  slotKey: string;
  prompt: BookPrompt;
  value: string;
  onSave: (slotKey: string, promptKey: string, value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  const handleBlur = useCallback(() => {
    if (localValue !== value) {
      onSave(slotKey, prompt.key, localValue);
    }
  }, [slotKey, prompt.key, localValue, value, onSave]);

  if (prompt.type === "long") {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {prompt.label}
        </label>
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder={prompt.placeholder}
          rows={3}
          className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-rose-300 focus:outline-none resize-none placeholder:text-gray-300"
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {prompt.label}
      </label>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={prompt.placeholder}
        className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-rose-300 focus:outline-none placeholder:text-gray-300"
      />
    </div>
  );
}
