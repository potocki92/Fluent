import { describe, expect, it } from "vitest";

import {
  COVER_ERROR_MESSAGES,
  coverFailure,
  coverObjectPath,
  coverPathExtension,
  coverPathPrefix,
  coverPublicUrl,
  coverStoragePath,
  isCoverMimeType,
  isCoverPathForItem,
  isManagedCoverPath,
  MAX_COVER_BYTES,
  MIN_COVER_BYTES,
  sniffCoverType,
  validateCoverFile,
} from "@/lib/library/covers";

const ORIGIN = "https://project.supabase.co";
const ITEM = "11111111-1111-1111-1111-111111111111";
const OTHER_ITEM = "22222222-2222-2222-2222-222222222222";

describe("validateCoverFile", () => {
  it("accepts the three formats the whole pipeline handles", () => {
    expect(
      validateCoverFile({ fileName: "cafe.jpg", mimeType: "image/jpeg", size: 200_000 }),
    ).toEqual({ ok: true, mimeType: "image/jpeg", extension: "jpg" });
    expect(
      validateCoverFile({ fileName: "cafe.PNG", mimeType: "image/png", size: 200_000 }),
    ).toEqual({ ok: true, mimeType: "image/png", extension: "png" });
    expect(
      validateCoverFile({ fileName: "cafe.webp", mimeType: "image/webp", size: 200_000 }),
    ).toEqual({ ok: true, mimeType: "image/webp", extension: "webp" });
  });

  it("treats .jpeg and .jpg as the same file", () => {
    expect(
      validateCoverFile({ fileName: "a.jpeg", mimeType: "image/jpeg", size: 9_000 }),
    ).toEqual({ ok: true, mimeType: "image/jpeg", extension: "jpg" });
  });

  it("refuses a type Fluent does not serve", () => {
    for (const candidate of [
      { fileName: "book.pdf", mimeType: "application/pdf", size: 9_000 },
      { fileName: "clip.gif", mimeType: "image/gif", size: 9_000 },
      { fileName: "cover.svg", mimeType: "image/svg+xml", size: 9_000 },
      { fileName: "cover.avif", mimeType: "image/avif", size: 9_000 },
      { fileName: "cover", mimeType: "image/png", size: 9_000 },
    ]) {
      expect(validateCoverFile(candidate)).toEqual({
        ok: false,
        code: "unsupported_type",
      });
    }
  });

  it("does not take the extension's word for it", () => {
    // A renamed file is the whole reason the declared type is checked too. They
    // have to agree; the bytes are confirmed again after the upload.
    expect(
      validateCoverFile({
        fileName: "payload.png",
        mimeType: "application/x-msdownload",
        size: 9_000,
      }),
    ).toEqual({ ok: false, code: "unsupported_type" });

    expect(
      validateCoverFile({ fileName: "photo.png", mimeType: "image/jpeg", size: 9_000 }),
    ).toEqual({ ok: false, code: "unsupported_type" });
  });

  it("falls back to the extension when the picker reports no type at all", () => {
    // Android's file picker routinely does this.
    expect(validateCoverFile({ fileName: "photo.jpg", mimeType: "", size: 9_000 })).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      extension: "jpg",
    });
    expect(validateCoverFile({ fileName: "photo.jpg", mimeType: null, size: 9_000 })).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      extension: "jpg",
    });
  });

  it("refuses an oversized file", () => {
    expect(
      validateCoverFile({
        fileName: "huge.jpg",
        mimeType: "image/jpeg",
        size: MAX_COVER_BYTES + 1,
      }),
    ).toEqual({ ok: false, code: "file_too_large" });

    expect(
      validateCoverFile({
        fileName: "exact.jpg",
        mimeType: "image/jpeg",
        size: MAX_COVER_BYTES,
      }).ok,
    ).toBe(true);
  });

  it("refuses an empty or truncated file", () => {
    for (const size of [0, -1, MIN_COVER_BYTES - 1, Number.NaN]) {
      expect(
        validateCoverFile({ fileName: "a.jpg", mimeType: "image/jpeg", size }),
      ).toEqual({ ok: false, code: "file_too_small" });
    }
  });

  it("knows which MIME types are covers", () => {
    expect(isCoverMimeType("image/webp")).toBe(true);
    expect(isCoverMimeType("image/gif")).toBe(false);
    expect(isCoverMimeType(null)).toBe(false);
  });
});

describe("sniffCoverType", () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));

  it("reads the format out of the bytes", () => {
    expect(sniffCoverType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(
      sniffCoverType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)),
    ).toBe("image/png");
    expect(
      sniffCoverType(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP"), 0)),
    ).toBe("image/webp");
  });

  it("is what makes the declared type a courtesy rather than the control", () => {
    // A PDF renamed `.png` and announced as `image/png` passes both browser-side
    // checks. It does not pass this one, so it never becomes a public URL.
    expect(sniffCoverType(bytes(...ascii("%PDF-1.7")))).toBeNull();
    expect(sniffCoverType(bytes(...ascii("GIF89a")))).toBeNull();
    expect(sniffCoverType(bytes(...ascii("<svg xmlns")))).toBeNull();
    expect(sniffCoverType(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")))).toBeNull();
    expect(sniffCoverType(bytes())).toBeNull();
    expect(sniffCoverType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("reads the extension a managed path was minted with", () => {
    expect(coverPathExtension(coverObjectPath(ITEM, "abc", "webp"))).toBe("webp");
    expect(coverPathExtension(coverObjectPath(ITEM, "abc", "jpg"))).toBe("jpg");
    expect(coverPathExtension("library/not-a-uuid/a.jpg")).toBeNull();
  });
});

describe("object paths", () => {
  it("puts every cover under its own material's prefix", () => {
    expect(coverPathPrefix(ITEM)).toBe(`library/${ITEM}/`);
    expect(coverObjectPath(ITEM, "abc-123", "webp")).toBe(
      `library/${ITEM}/abc-123.webp`,
    );
  });

  it("recognises a path it minted for this material", () => {
    const path = coverObjectPath(ITEM, "9f1c2d3e", "jpg");
    expect(isCoverPathForItem(path, ITEM)).toBe(true);
    expect(isManagedCoverPath(path)).toBe(true);
  });

  it("refuses a path belonging to another material", () => {
    // The guard on every destructive step: a tampered commit must not be able to
    // address anything outside the material it is about.
    const path = coverObjectPath(OTHER_ITEM, "9f1c2d3e", "jpg");
    expect(isCoverPathForItem(path, ITEM)).toBe(false);
  });

  it("refuses anything that is not a path we could have minted", () => {
    for (const path of [
      `library/${ITEM}/../${OTHER_ITEM}/a.jpg`,
      `library/${ITEM}/a.exe`,
      `library/${ITEM}/nested/a.jpg`,
      `other/${ITEM}/a.jpg`,
      `${ITEM}/a.jpg`,
      "",
      "a.jpg",
    ]) {
      expect(isCoverPathForItem(path, ITEM)).toBe(false);
      expect(isManagedCoverPath(path)).toBe(false);
    }
  });
});

describe("public URLs", () => {
  it("round-trips a managed cover", () => {
    const path = coverObjectPath(ITEM, "abc-123", "webp");
    const url = coverPublicUrl(ORIGIN, path);
    expect(url).toBe(
      `${ORIGIN}/storage/v1/object/public/content-covers/library/${ITEM}/abc-123.webp`,
    );
    expect(coverStoragePath(url, ORIGIN)).toBe(path);
  });

  it("tolerates a trailing slash on the project URL", () => {
    expect(coverPublicUrl(`${ORIGIN}/`, "library/x/a.jpg")).toBe(
      `${ORIGIN}/storage/v1/object/public/content-covers/library/x/a.jpg`,
    );
  });

  it("refuses to resolve a URL that is not ours to delete", () => {
    // `cover_url` is a general column — it may hold a publisher's URL one day —
    // so a removal may never turn an arbitrary URL into a Storage delete.
    for (const url of [
      null,
      "",
      "not a url",
      "https://evil.example/storage/v1/object/public/content-covers/library/x/a.jpg",
      `${ORIGIN}/storage/v1/object/public/private-book-imports/user/a.pdf`,
      `${ORIGIN}/storage/v1/object/public/content-covers/`,
      `${ORIGIN}/some/other/path.jpg`,
    ]) {
      expect(coverStoragePath(url, ORIGIN)).toBeNull();
    }
  });

  it("refuses a URL that walks out of the bucket", () => {
    expect(
      coverStoragePath(
        `${ORIGIN}/storage/v1/object/public/content-covers/..%2F..%2Fsecret.png`,
        ORIGIN,
      ),
    ).toBeNull();
  });
});

describe("coverFailure", () => {
  it("speaks Polish about images, not about tests", () => {
    const failure = coverFailure("file_too_large");
    expect(failure.ok).toBe(false);
    expect(failure.message).toBe(COVER_ERROR_MESSAGES.file_too_large);
    // Still classified on the shared taxonomy, so retry rules keep working.
    expect(failure.code).toBe("invalid_input");
    expect(coverFailure("forbidden").code).toBe("forbidden");
  });
});
