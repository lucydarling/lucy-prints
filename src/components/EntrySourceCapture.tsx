"use client";

import { useEffect } from "react";
import { captureEntrySource } from "@/lib/entry-source";

/** Renders nothing; records how the visit arrived (see entry-source.ts). */
export function EntrySourceCapture() {
  useEffect(() => {
    captureEntrySource();
  }, []);
  return null;
}
