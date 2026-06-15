"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import {
  countFilledPrompts,
  type SlotPrompts,
  type BookPrompt,
} from "@/lib/book-prompts";
import {
  lookupTimeCapsule,
  TIME_CAPSULE_PROMPT_MAP,
} from "@/lib/time-capsule-lookup";

interface StandaloneDetailCardProps {
  entry: SlotPrompts;
}

export function StandaloneDetailCard({ entry }: StandaloneDetailCardProps) {
  const notes = usePhotoStore((s) => s.notes);
  const setNote = usePhotoStore((s) => s.setNote);
  const babyBirthdate = useSaveStore((s) => s.babyBirthdate);
  const [isExpanded, setIsExpanded] = useState(false);

  // Time Capsule smart fill: auto-suggest values when birthdate is available
  const isTimeCapsule = entry.slotKey === "time_capsule";
  const suggestions = isTimeCapsule ? lookupTimeCapsule(babyBirthdate) : null;

  // Track previous suggestions to know which fields were auto-filled vs manually entered
  const prevSuggestionsRef = useRef<typeof suggestions>(null);

  // Auto-fill Time Capsule fields when suggestions become available or birthdate changes
  useEffect(() => {
    if (!suggestions || !isTimeCapsule) return;
    const slotNotes = notes[entry.slotKey] || {};
    const prevSuggestions = prevSuggestionsRef.current;
    for (const [promptKey, suggestionField] of Object.entries(TIME_CAPSULE_PROMPT_MAP)) {
      const suggestion = suggestions[suggestionField];
      const currentValue = slotNotes[promptKey]?.trim() || "";
      const prevSuggestion = prevSuggestions?.[suggestionField] || "";
      // Fill if: field is empty, OR field still has the previous auto-fill value (not manually edited)
      if (suggestion && (!currentValue || currentValue === prevSuggestion)) {
        setNote(entry.slotKey, promptKey, suggestion);
      }
    }
    prevSuggestionsRef.current = suggestions;
    // Only run when suggestions change (birthdate changes), not on every notes update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions?.breadCost, suggestions?.fuelCost, suggestions?.popularSong, suggestions?.nationsLeader]);

  const hasPrompts = entry.prompts.length > 0;
  const { filled, total } = hasPrompts
    ? countFilledPrompts(entry.slotKey, notes)
    : { filled: 0, total: 0 };

  // Resource-image-only card (e.g. Family Tree)
  if (entry.resourceImage) {
    return (
      <div className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm">
        <div className="flex items-start gap-2 mb-2">
          <span className="text-base">🌳</span>
          <div>
            <p className="text-sm font-medium text-gray-800">
              {entry.standaloneLabel}
            </p>
            {entry.standaloneHint && (
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                {entry.standaloneHint}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
          <Image
            src={entry.resourceImage}
            alt={entry.standaloneLabel || "Resource"}
            width={300}
            height={200}
            className="object-contain max-h-48"
            unoptimized
          />
        </div>
      </div>
    );
  }

  // Standard standalone card with prompts
  return (
    <div className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm">
      {/* Card header */}
      <button
        onClick={() => hasPrompts && setIsExpanded(!isExpanded)}
        className="w-full text-left"
        disabled={!hasPrompts}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <span className="text-base">{isTimeCapsule && suggestions ? "✨" : "📝"}</span>
            <div>
              <p className="text-sm font-medium text-gray-800">
                {entry.standaloneLabel}
                {isTimeCapsule && suggestions && (
                  <span className="text-xs text-rose-400 font-normal ml-1.5">
                    auto-filled
                  </span>
                )}
              </p>
              {entry.standaloneHint && (
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {entry.standaloneHint}
                </p>
              )}
            </div>
          </div>
          {hasPrompts && (
            <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
              <span
                className={`text-xs ${
                  filled > 0 ? "text-rose-500 font-medium" : "text-gray-400"
                }`}
              >
                {filled}/{total}
              </span>
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
            </div>
          )}
        </div>
      </button>

      {/* Expanded fields */}
      {isExpanded && hasPrompts && (
        <div className="mt-3 space-y-3">
          {/* Use grid for short fields, stack for long ones */}
          {entry.prompts.every((p) => p.type === "short") &&
          entry.prompts.length >= 4 ? (
            <div className="grid grid-cols-2 gap-3">
              {entry.prompts.map((prompt) => (
                <StandaloneField
                  key={prompt.key}
                  slotKey={entry.slotKey}
                  prompt={prompt}
                  value={notes[entry.slotKey]?.[prompt.key] || ""}
                  onSave={setNote}
                />
              ))}
            </div>
          ) : (
            entry.prompts.map((prompt) => (
              <StandaloneField
                key={prompt.key}
                slotKey={entry.slotKey}
                prompt={prompt}
                value={notes[entry.slotKey]?.[prompt.key] || ""}
                onSave={setNote}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StandaloneField({
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

  // Sync local state when the store value changes (e.g. birthdate-driven auto-fill)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

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
          rows={4}
          className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-rose-300 focus:outline-none resize-none placeholder:text-gray-300"
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
        className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-rose-300 focus:outline-none placeholder:text-gray-300"
      />
    </div>
  );
}
