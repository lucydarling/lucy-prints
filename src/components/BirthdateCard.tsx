"use client";

import { useState, useSyncExternalStore } from "react";
import { useSaveStore } from "@/store/save-store";
import { usePhotoStore } from "@/store/photo-store";
import { getProductForTheme } from "@/lib/photo-slots";
import {
  birthdateCardKey,
  localDateString,
  parseBirthdateChoice,
  serializeBirthdateChoice,
  shouldShowBirthdateCard,
  type BirthdateChoice,
} from "@/lib/birthdate-card";

const CHANGE_EVENT = "ld-birthdate-card-change";

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function readRaw(token: string | null): string | null {
  if (!token) return null;
  try {
    return localStorage.getItem(birthdateCardKey(token));
  } catch {
    return null;
  }
}

function writeChoice(token: string, choice: NonNullable<BirthdateChoice>) {
  try {
    localStorage.setItem(birthdateCardKey(token), serializeBirthdateChoice(choice));
  } catch {
    // No usable storage: the card just comes back next visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Asks, once and gently, for the baby's birthdate when a saved memory book has
 * none. Dismissable ("Not now" for a week, or "I'd rather not say"). Saving
 * goes through the same PATCH the baby-details modal uses.
 */
export function BirthdateCard() {
  const sessionToken = useSaveStore((s) => s.sessionToken);
  const babyName = useSaveStore((s) => s.babyName);
  const babyBirthdate = useSaveStore((s) => s.babyBirthdate);
  const optedOut = useSaveStore((s) => s.birthdateOptOut);
  const updateBabyInfo = useSaveStore((s) => s.updateBabyInfo);
  const bookTheme = usePhotoStore((s) => s.bookTheme);

  // Server render and first paint see an empty choice; the client then reads storage.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(sessionToken),
    () => null
  );
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!mounted) return null;
  const show = shouldShowBirthdateCard({
    hasToken: Boolean(sessionToken),
    isMemoryBook: getProductForTheme(bookTheme) === "memory_book",
    babyBirthdate,
    optedOutOfReminders: optedOut,
    choice: parseBirthdateChoice(raw),
    now: Date.now(),
  });
  if (!show || !sessionToken) return null;

  async function save() {
    if (!date || saving || !sessionToken) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${sessionToken}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyBirthdate: date }),
      });
      if (!res.ok) throw new Error(String(res.status));
      updateBabyInfo(babyName ?? "", date, false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const who = babyName?.trim() ? babyName.trim() : "your baby";

  return (
    <div className="mx-4 my-3 max-w-2xl sm:mx-auto rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-3">
      <p className="text-sm font-medium text-gray-900">When was {who} born?</p>
      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
        We use it to time your milestone reminders.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label htmlFor="birthdate-card-date" className="sr-only">
          Birthday
        </label>
        <input
          id="birthdate-card-date"
          type="date"
          value={date}
          max={localDateString(new Date())}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-transparent"
        />
        <button
          type="button"
          onClick={save}
          disabled={!date || saving}
          className="px-4 py-2 rounded-lg bg-rose-400 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-500 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => writeChoice(sessionToken, { kind: "not_now", at: Date.now() })}
          className="px-2 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={() => writeChoice(sessionToken, { kind: "never" })}
          className="px-2 py-2 text-sm text-gray-400 hover:text-gray-600"
        >
          I&apos;d rather not say
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-red-600 mt-2">
          We couldn&apos;t save that just now. Please try again.
        </p>
      )}
    </div>
  );
}
