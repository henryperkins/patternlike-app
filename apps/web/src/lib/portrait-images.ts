import type { ImagePixels } from "./image-sculpture.js";

const MAX_IMAGE_SIDE = 128;

/** Decode four references independently of Sun sign or reading metadata. */
export async function loadPortraitImages(urls: readonly string[], signal: AbortSignal): Promise<ImagePixels[]> {
  if (urls.length !== 4 || urls.some((url) => !url.trim())) {
    throw new Error("A portrait requires four image references.");
  }
  signal.throwIfAborted();
  return Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Unable to load a portrait reference (${response.status}).`);
    const blob = await response.blob();
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    try {
      signal.throwIfAborted();
      if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height)
        || bitmap.width <= 0 || bitmap.height <= 0) throw new Error("A portrait reference has invalid dimensions.");
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Image decoding requires a canvas context.");
      context.drawImage(bitmap, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, width, height);
      signal.throwIfAborted();
      return { width, height, data };
    } finally {
      bitmap.close();
    }
  }));
}
