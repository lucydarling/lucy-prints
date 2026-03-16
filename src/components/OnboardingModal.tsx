"use client";

import { useEffect, useState } from "react";

const ONBOARDED_KEY = "lucy-prints-onboarded";

export function OnboardingModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(ONBOARDED_KEY)) {
      setShow(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Top accent */}
        <div className="h-1.5 bg-gradient-to-r from-rose-300 to-pink-300" />

        <div className="p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-rose-400 mb-2">
              Lucy Darling Photo Prints
            </p>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">
              Get your photos perfectly sized for your memory book
            </h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              We&apos;ll guide you through every page — then give you print-ready files to take anywhere.
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-4 mb-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center shrink-0 text-base">
                📖
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Pick your book theme</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Select the theme that matches the memory book you have.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center shrink-0 text-base">
                📸
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Upload &amp; crop your photos</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  We&apos;ll prompt you for every slot with the exact size needed — no guessing.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center shrink-0 text-base">
                🖨️
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Download &amp; print</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  You&apos;ll get a ZIP of perfectly sized files. Print at home or drop them at any photo lab — Walgreens, CVS, Costco, or Shutterfly.
                </p>
              </div>
            </div>
          </div>

          {/* Coming soon note */}
          <p className="text-xs text-center text-rose-500 bg-rose-50 rounded-lg px-3 py-2 mb-5">
            Direct print ordering is coming soon — this gets your photos perfectly prepared in the meantime.
          </p>

          {/* CTA */}
          <button
            onClick={dismiss}
            className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
