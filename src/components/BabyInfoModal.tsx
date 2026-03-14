"use client";

import { useState } from "react";
import { useSaveStore } from "@/store/save-store";

export function BabyInfoModal() {
  const showBabyInfoModal = useSaveStore((s) => s.showBabyInfoModal);
  const setShowBabyInfoModal = useSaveStore((s) => s.setShowBabyInfoModal);
  const setPendingBabyInfo = useSaveStore((s) => s.setPendingBabyInfo);

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [optOut, setOptOut] = useState(false);

  if (!showBabyInfoModal) return null;

  function handleSave() {
    setPendingBabyInfo(name.trim(), optOut ? "" : birthdate, optOut);
    setShowBabyInfoModal(false);
  }

  function handleOptOutChange(checked: boolean) {
    setOptOut(checked);
    if (checked) setBirthdate("");
  }

  const canSave = optOut || birthdate.length > 0;

  function handleDismiss() {
    setShowBabyInfoModal(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            Tell us about your baby
          </h2>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            We&apos;ll use this to personalize your experience and keep you on
            track for every milestone.
          </p>
        </div>

        {/* Baby name */}
        <div className="mb-4">
          <label
            htmlFor="baby-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Baby&apos;s name
          </label>
          <input
            id="baby-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Olive"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            We&apos;ll include your baby&apos;s name on your download and
            reference sheet.
          </p>
        </div>

        {/* Baby birthdate */}
        <div className="mb-5">
          <label
            htmlFor="baby-birthdate"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Baby&apos;s birthday{" "}
            <span className="text-rose-400">*</span>
          </label>
          <input
            id="baby-birthdate"
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            disabled={optOut}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            We&apos;ll send gentle milestone reminders so you never miss a photo
            moment. We never sell your info.
          </p>
        </div>

        {/* Opt-out checkbox */}
        <label className="flex items-start gap-2.5 cursor-pointer mb-5">
          <input
            type="checkbox"
            checked={optOut}
            onChange={(e) => handleOptOutChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-rose-400 focus:ring-rose-300 cursor-pointer"
          />
          <span className="text-sm text-gray-500 leading-snug">
            I don&apos;t want milestone reminders
          </span>
        </label>

        {/* Actions */}
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="w-full py-2.5 rounded-xl bg-rose-400 text-white text-sm font-semibold hover:bg-rose-500 active:bg-rose-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save details
        </button>
      </div>
    </div>
  );
}
