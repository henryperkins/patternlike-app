import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPortraitImages } from "./portrait-images.js";

const urls = ["/image-01.png", "/image-02.png", "/image-03.png", "/image-04.png"];

describe("portrait image decoding", () => {
  const fetchMock = vi.fn();
  const decodeMock = vi.fn();
  const drawImage = vi.fn();
  const getImageData = vi.fn();
  let bitmaps: Array<{ width: number; height: number; close: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    bitmaps = Array.from({ length: 4 }, (_, index) => ({ width: 1024 + index * 100, height: 1536, close: vi.fn() }));
    fetchMock.mockReset().mockImplementation(async () => ({ ok: true, blob: async () => new Blob() }));
    decodeMock.mockReset();
    for (const bitmap of bitmaps) decodeMock.mockResolvedValueOnce(bitmap);
    drawImage.mockReset();
    getImageData.mockReset().mockImplementation((_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", decodeMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches four references with cancellation and returns only ordered RGBA pixels", async () => {
    const signal = new AbortController().signal;
    const images = await loadPortraitImages(urls, signal);
    expect(fetchMock.mock.calls).toEqual(urls.map((url) => [url, { signal }]));
    expect(images.map((image) => [image.width, image.height])).toEqual([[85, 128], [94, 128], [102, 128], [110, 128]]);
    for (const image of images) {
      expect(Object.keys(image).sort()).toEqual(["data", "height", "width"]);
      expect(image.data).toBeInstanceOf(Uint8ClampedArray);
      expect(image.data.length).toBe(image.width * image.height * 4);
    }
    expect(drawImage.mock.calls.map((call) => call[0])).toEqual(bitmaps);
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it("preserves small references without upscaling and bounds landscape references", async () => {
    bitmaps[0].width = 40;
    bitmaps[0].height = 60;
    bitmaps[1].width = 2000;
    bitmaps[1].height = 1000;
    const images = await loadPortraitImages(urls, new AbortController().signal);
    expect([images[0].width, images[0].height]).toEqual([40, 60]);
    expect([images[1].width, images[1].height]).toEqual([128, 64]);
  });

  it.each([[], urls.slice(0, 3), [...urls, "/extra.png"], ["", ...urls.slice(1)]].map((input) => ({ input })))("rejects invalid input count or missing URLs before any request: $input", async ({ input }) => {
    await expect(loadPortraitImages(input, new AbortController().signal)).rejects.toThrow("four image references");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an already aborted request before fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPortraitImages(urls, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects HTTP failures instead of substituting an image", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("404");
    expect(decodeMock).not.toHaveBeenCalled();
  });

  it("rejects network and decoding failures", async () => {
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("Network unavailable");
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    decodeMock.mockReset().mockRejectedValue(new Error("Invalid image"));
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("Invalid image");
  });

  it("closes every decoded bitmap when cancellation happens during decoding", async () => {
    const controller = new AbortController();
    const resolvers: Array<(bitmap: typeof bitmaps[number]) => void> = [];
    decodeMock.mockReset().mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const pending = loadPortraitImages(urls, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(4));
    controller.abort();
    resolvers.forEach((resolve, index) => resolve(bitmaps[index]));
    await rejected;
    expect(drawImage).not.toHaveBeenCalled();
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it("closes decoded bitmaps even when the canvas cannot read pixels", async () => {
    getImageData.mockImplementation(() => { throw new Error("Pixel read failed"); });
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("Pixel read failed");
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it("rejects unavailable canvas contexts and empty decodes while closing bitmaps", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("canvas");
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
    decodeMock.mockReset().mockResolvedValue({ width: 0, height: 0, close: vi.fn() });
    await expect(loadPortraitImages(urls, new AbortController().signal)).rejects.toThrow("dimensions");
  });
});
