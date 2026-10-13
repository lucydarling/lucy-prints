// Bundled by run.py and loaded into a headless browser page. Builds the same
// ZIP the review page builds, from fixed generated "cropped" images, so two
// versions of the app can be compared file by file.
import { downloadPhotosZip, type DownloadOptions } from "@/lib/download-zip";
import { getBookSlots, getPrintDimensions } from "@/lib/photo-slots";

/** A fixed, deterministic image: flat colour from the index, with its index drawn on it. */
function testImage(width: number, height: number, n: number): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  g.fillStyle = `hsl(${(n * 47) % 360} 55% 62%)`;
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#222";
  g.font = `${Math.round(width / 8)}px sans-serif`;
  g.fillText(`#${n}`, width / 10, height / 2);
  g.strokeStyle = "#222";
  g.lineWidth = 6;
  g.strokeRect(3, 3, width - 6, height - 6);
  return c.toDataURL("image/png");
}

const OPTIONS: Record<string, DownloadOptions> = {
  "as-is": {},
  "pad-3x3-to-4x4": { pad3x3to4x4: true },
  "all-on-4x6": { padAllTo4x6: true },
};

(window as unknown as { runZip: (theme: string, option: string) => Promise<void> }).runZip = async (
  theme,
  option
) => {
  const photos: Record<string, never> = {} as never;
  const entries: Record<string, unknown> = photos;
  getBookSlots(theme).forEach((slot, i) => {
    const { width, height } = getPrintDimensions(slot.size, slot.orientation);
    entries[slot.key] = {
      slotKey: slot.key,
      previewUrl: null,
      croppedUrl: testImage(width, height, i + 1),
      status: "cropped",
    };
  });
  const extras = [
    { id: "extra_1", size: "4x4", orientation: "portrait", previewUrl: null, croppedUrl: testImage(1200, 1200, 901), quantity: 1 },
    { id: "extra_2", size: "4x6", orientation: "landscape", previewUrl: null, croppedUrl: testImage(1800, 1200, 902), quantity: 1 },
  ];
  await downloadPhotosZip(entries as never, extras as never, theme, { ...OPTIONS[option], babyName: "Test" });
};
