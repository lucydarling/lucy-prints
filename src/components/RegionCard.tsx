"use client";

import {
  getBookSlots,
  getPrintSizeLabel,
  getRegion,
  isSquarePrintSize,
  resolveRegionChoice,
  type PrintOrientation,
  type RegionLayout,
} from "@/lib/photo-slots";
import { usePhotoStore } from "@/store/photo-store";
import { useSaveStore } from "@/store/save-store";
import { PhotoSlotCard } from "./PhotoSlotCard";

/**
 * Part of a page that holds several photos the parent arranges by hand. The
 * parent picks a layout (each one fits the page by design), then adds a photo
 * to each spot; we size and crop them, they place the prints.
 *
 * Copy here is DRAFT — pending Haily's voice pass.
 */
export function RegionCard({ regionKey }: { regionKey: string }) {
  const bookTheme = usePhotoStore((s) => s.bookTheme);
  const photos = usePhotoStore((s) => s.photos);
  const regionLayouts = usePhotoStore((s) => s.regionLayouts);
  const setRegionChoice = usePhotoStore((s) => s.setRegionChoice);

  const region = getRegion(bookTheme, regionKey);
  if (!region) return null;

  const { layout, orientation } = resolveRegionChoice(region, regionLayouts[regionKey]);
  const spots = getBookSlots(bookTheme, regionLayouts).filter((s) => s.region === regionKey);
  const canTurn = !isSquarePrintSize(layout.size) && layout.orientations.length > 1;

  function choose(next: RegionLayout, nextOrientation: PrintOrientation) {
    const hasCrops = spots.some((s) => photos[s.key]?.croppedUrl);
    const shapeChanges =
      next.size !== layout.size ||
      (!isSquarePrintSize(next.size) && nextOrientation !== orientation);
    if (
      hasCrops &&
      shapeChanges &&
      !window.confirm(
        "Changing the print size means re-cropping the photos you've added here. Continue?"
      )
    ) {
      return;
    }
    const cleared = setRegionChoice(regionKey, {
      layoutId: next.id,
      orientation: nextOrientation,
    });
    // Re-cropped photos must upload again, so they can't stay marked as uploaded.
    if (cleared.length > 0) {
      useSaveStore.setState((s) => ({
        uploadedSlots: s.uploadedSlots.filter((k) => !cleared.includes(k)),
      }));
    }
  }

  return (
    <div className="p-3 rounded-xl bg-white border border-gray-100 shadow-sm" data-region={regionKey}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">{region.prompt}</p>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Page {region.page}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
        {describeLayouts(region.layouts)} Choose how you&apos;d like to fill it — we&apos;ll
        size each photo to fit, and you arrange the prints on the page.
      </p>
      {region.guidance && (
        <p className="text-xs text-rose-700 mt-1.5 leading-relaxed">{region.guidance}</p>
      )}

      {region.layouts.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5" role="radiogroup" aria-label="Layout">
          {region.layouts.map((l) => {
            const active = l.id === layout.id;
            return (
              <button
                key={l.id}
                role="radio"
                aria-checked={active}
                onClick={() =>
                  !active &&
                  choose(l, l.orientations.includes(orientation) ? orientation : l.orientations[0])
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  active
                    ? "bg-rose-500 text-white"
                    : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                }`}
              >
                {layoutLabel(l)}
              </button>
            );
          })}
        </div>
      )}

      {canTurn && (
        <div className="flex gap-1.5 mt-2" role="radiogroup" aria-label="Orientation">
          {layout.orientations.map((o) => {
            const active = o === orientation;
            return (
              <button
                key={o}
                role="radio"
                aria-checked={active}
                onClick={() => !active && choose(layout, o)}
                className={`px-3 py-1 text-[11px] font-medium rounded-full border transition-colors ${
                  active
                    ? "border-rose-400 text-rose-600 bg-white"
                    : "border-gray-200 text-gray-500 hover:border-rose-200"
                }`}
              >
                {o === "portrait" ? "Portrait" : "Landscape"} ·{" "}
                {getPrintSizeLabel(layout.size, o)}&quot;
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {spots.map((spot) => (
          <PhotoSlotCard
            key={spot.key}
            slot={{
              ...spot,
              prompt:
                spots.length > 1 ? `Photo ${spot.regionIndex} of ${spots.length}` : "Photo",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function layoutLabel(l: RegionLayout): string {
  return `${l.count} ${l.count === 1 ? "photo" : "photos"} · ${l.size}"`;
}

/** "This page holds up to 4 photos." / "This page holds 1 photo." */
function describeLayouts(layouts: RegionLayout[]): string {
  const max = Math.max(...layouts.map((l) => l.count));
  return max === 1
    ? "This page holds 1 photo."
    : `This page holds up to ${max} photos.`;
}
