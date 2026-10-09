import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { BuiltOrder } from "./build-order";

/** Somewhere an order folder can be written. */
export interface OrderDestination {
  /** Write every image first, then the XML last (pfRouter only picks up a folder whose XML parses). */
  writeOrder(order: BuiltOrder): Promise<{ location: string }>;
}

/** Local folder: <root>/<external_id>/… XML goes in under a temp name and is renamed last. */
export class LocalFolderDestination implements OrderDestination {
  constructor(private readonly root: string) {}

  async writeOrder(order: BuiltOrder) {
    const dir = path.join(this.root, order.folderName);
    await fs.mkdir(dir, { recursive: true });
    for (const img of order.images) await fs.writeFile(path.join(dir, img.name), img.data);
    const tmp = path.join(dir, `.${order.xml.name}.tmp`);
    await fs.writeFile(tmp, order.xml.data);
    await fs.rename(tmp, path.join(dir, order.xml.name));
    return { location: dir };
  }
}

/**
 * NOT IMPLEMENTED — future cloud-folder delivery to Photo Finale's hotfolder
 * (delivery method still to be confirmed with Photo Finale). Intentionally
 * throws so nothing can be sent by accident.
 */
export class CloudFolderDestination implements OrderDestination {
  async writeOrder(): Promise<{ location: string }> {
    throw new Error("CloudFolderDestination is not implemented — nothing is sent to Photo Finale.");
  }
}

export function writeOrderFolder(order: BuiltOrder, destination: OrderDestination) {
  return destination.writeOrder(order);
}

/** The order folder as a ZIP (<external_id>/…), for inspection. */
export async function orderToZip(order: BuiltOrder): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder(order.folderName)!;
  for (const img of order.images) folder.file(img.name, img.data);
  folder.file(order.xml.name, order.xml.data);
  return zip.generateAsync({ type: "nodebuffer" });
}
