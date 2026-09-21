import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  coverObjectPath,
  coverPublicUrl,
  MATERIAL_COVER_BUCKET,
} from "@/lib/library/covers";

/**
 * The artwork actions, exercised end to end against a fake Supabase.
 *
 * WHY THIS IS WORTH A FAKE. `covers.ts` proves the arithmetic — what a path
 * looks like, whether a URL is ours, what the bytes say — and
 * `supabase/tests/10_material_cover_security.sql` proves the database refuses
 * what it should. Between the two sits the part that has actually broken: the
 * ORDER of the steps, and which subject they act on. That a commit writes the
 * new URL before deleting the old object, that a rejected upload leaves the
 * previous picture in place, that a private import is refused before a signed
 * URL is ever minted, and — the bug this feature was rebuilt for — that a story
 * authored straight into the library, with chapters and no `texts` row, can be
 * given a picture at all. None of that is visible from either side alone.
 *
 * The fake is deliberately literal: rows in arrays, objects in a Map, and a
 * query builder that understands only the operators these actions use. A fake
 * that accepted more than the real client does would let a wrong query pass.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createService: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: mocks.createService,
}));

const {
  commitMaterialCoverUpload,
  commitTextCoverUpload,
  prepareMaterialCoverUpload,
  prepareTextCoverUpload,
  removeMaterialCover,
  removeTextCover,
} = await import("@/actions/admin-covers");

// ─────────────────────────────────────────────────────────────────────────────
// The world these actions run in
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://project.supabase.co";

/** „Der Schlüssel": a story authored in the library. No passage behind it. */
const STORY = "3e1f0a7c-1111-4aaa-8bbb-000000000001";
/** „Nikolaus Kopernikus": a legacy passage, reached through `legacy_text_id`. */
const PASSAGE = "3e1f0a7c-2222-4aaa-8bbb-000000000002";
const PASSAGE_TEXT_ID = 41;
/** Somebody's own uploaded book. Not an admin's to redecorate. */
const PRIVATE = "3e1f0a7c-3333-4aaa-8bbb-000000000003";

type Row = Record<string, unknown>;

let items: Row[];
let texts: Row[];
let objects: Map<string, Uint8Array>;
let removedPaths: string[];
let signedPaths: string[];

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 2048);
const PDF = bytes([0x25, 0x50, 0x44, 0x46], 2048);

function bytes(head: number[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(head, 0);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;

  items = [
    {
      id: STORY,
      slug: "der-schluessel",
      title: "Der Schlüssel",
      cover_url: null,
      legacy_text_id: null,
      rights: "first_party",
      owner_user_id: null,
    },
    {
      id: PASSAGE,
      slug: "nikolaus-kopernikus",
      title: "Nikolaus Kopernikus",
      cover_url: null,
      legacy_text_id: PASSAGE_TEXT_ID,
      rights: "first_party",
      owner_user_id: null,
    },
    {
      id: PRIVATE,
      slug: "privates-buch",
      title: "Privates Buch",
      cover_url: null,
      legacy_text_id: null,
      rights: "private_import",
      owner_user_id: "learner-1",
    },
  ];
  texts = [{ id: PASSAGE_TEXT_ID, title: "Nikolaus Kopernikus" }];
  objects = new Map();
  removedPaths = [];
  signedPaths = [];

  signInAsAdmin();
  mocks.createService.mockImplementation(() => serviceClient());
});

function signInAsAdmin() {
  mocks.requireAdmin.mockResolvedValue({ supabase: databaseClient(), user: { id: "admin-1" } });
}

function signOut() {
  mocks.requireAdmin.mockRejectedValue(new Error("Brak dostępu"));
}

function item(id: string): Row {
  const found = items.find((row) => row.id === id);
  if (!found) throw new Error(`no fixture for ${id}`);
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// A Supabase that only understands what these actions ask for
// ─────────────────────────────────────────────────────────────────────────────

function databaseClient() {
  return {
    from(table: string) {
      const rows = table === "library_items" ? items : table === "texts" ? texts : [];
      return builder(rows);
    },
  } as never;
}

function builder(rows: Row[]) {
  const predicates: ((row: Row) => boolean)[] = [];
  let patch: Row | null = null;

  const apply = () => {
    const matched = rows.filter((row) => predicates.every((test) => test(row)));
    if (patch) for (const row of matched) Object.assign(row, patch);
    return matched;
  };

  const chain = {
    select: () => chain,
    update(next: Row) {
      patch = next;
      return chain;
    },
    eq(column: string, value: unknown) {
      predicates.push((row) => row[column] === value);
      return chain;
    },
    is(column: string, value: unknown) {
      predicates.push((row) => row[column] === value);
      return chain;
    },
    neq(column: string, value: unknown) {
      predicates.push((row) => row[column] !== value);
      return chain;
    },
    async maybeSingle() {
      return { data: apply()[0] ?? null, error: null };
    },
    // An update with no `.select()` is awaited directly.
    then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
      return Promise.resolve({ data: apply(), error: null }).then(resolve);
    },
  };

  return chain as never;
}

function serviceClient() {
  return {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(MATERIAL_COVER_BUCKET);
        return {
          async createSignedUploadUrl(path: string) {
            signedPaths.push(path);
            return { data: { signedUrl: `${ORIGIN}/upload/${path}` }, error: null };
          },
          async download(path: string) {
            const stored = objects.get(path);
            if (!stored) return { data: null, error: new Error("not found") };
            return { data: new Blob([stored as BlobPart]), error: null };
          },
          async remove(paths: string[]) {
            for (const path of paths) {
              removedPaths.push(path);
              objects.delete(path);
            }
            return { data: null, error: null };
          },
        };
      },
    },
  } as never;
}

/** What the browser does between prepare and commit. */
function upload(path: string, content: Uint8Array = JPEG) {
  objects.set(path, content);
}

// ─────────────────────────────────────────────────────────────────────────────
// A library-native story — the case that had no screen at all
// ─────────────────────────────────────────────────────────────────────────────

describe("a material authored straight into the library", () => {
  it("gets a cover with no texts row and no legacy_text_id", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "schluessel.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.libraryItemId).toBe(STORY);
    expect(prepared.storagePath.startsWith(`library/${STORY}/`)).toBe(true);
    expect(prepared.storagePath.endsWith(".jpg")).toBe(true);

    upload(prepared.storagePath);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.coverUrl).toBe(coverPublicUrl(ORIGIN, prepared.storagePath));

    // ONE SOURCE OF TRUTH: the URL landed on the library item, and no `texts`
    // row was invented to hold it.
    expect(item(STORY).cover_url).toBe(committed.coverUrl);
    expect(item(STORY).legacy_text_id).toBeNull();
    expect(texts).toHaveLength(1);
  });

  it("mints a fresh object name per upload, so no CDN serves the old picture", async () => {
    const paths = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prepared = await prepareMaterialCoverUpload({
        libraryItemId: STORY,
        fileName: "a.png",
        mimeType: "image/png",
        fileSize: 4096,
      });
      if (prepared.ok) paths.add(prepared.storagePath);
    }
    expect(paths.size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A legacy passage — the same code, addressed differently
// ─────────────────────────────────────────────────────────────────────────────

describe("a legacy passage", () => {
  it("reaches the same library item through legacy_text_id", async () => {
    const prepared = await prepareTextCoverUpload({
      textId: PASSAGE_TEXT_ID,
      fileName: "kopernikus.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.libraryItemId).toBe(PASSAGE);

    upload(prepared.storagePath);

    const committed = await commitTextCoverUpload({
      textId: PASSAGE_TEXT_ID,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(true);
    expect(item(PASSAGE).cover_url).toBe(coverPublicUrl(ORIGIN, prepared.storagePath));
    // The picture is the LIBRARY's fact: nothing was written onto the passage.
    expect(texts[0]).toEqual({ id: PASSAGE_TEXT_ID, title: "Nikolaus Kopernikus" });
  });

  it("refuses a passage that does not exist", async () => {
    const result = await prepareTextCoverUpload({
      textId: 9999,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });
    expect(result.ok).toBe(false);
    expect(signedPaths).toHaveLength(0);
  });

  it("treats removing a cover that was never there as a success", async () => {
    texts.push({ id: 77, title: "Bez biblioteki" });
    const result = await removeTextCover(77);
    expect(result.ok).toBe(true);
    expect(removedPaths).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Who may do this
// ─────────────────────────────────────────────────────────────────────────────

describe("authorisation", () => {
  it("refuses everything to a caller who is not an admin", async () => {
    signOut();

    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });
    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: coverObjectPath(STORY, "abcdef", "jpg"),
    });
    const removed = await removeMaterialCover({ libraryItemId: STORY });
    const legacy = await prepareTextCoverUpload({
      textId: PASSAGE_TEXT_ID,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });

    for (const result of [prepared, committed, removed, legacy]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("forbidden");
    }
    // Nothing was minted, read back or deleted on the way to saying no.
    expect(signedPaths).toHaveLength(0);
    expect(removedPaths).toHaveLength(0);
  });

  it("refuses a learner's private import, even to an admin", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: PRIVATE,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });

    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe("forbidden");
    // Refused BEFORE a signed URL exists: an upload slot into a public bucket is
    // itself the thing being protected.
    expect(signedPaths).toHaveLength(0);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: PRIVATE,
      storagePath: coverObjectPath(PRIVATE, "abcdef", "jpg"),
    });
    expect(committed.ok).toBe(false);

    const removed = await removeMaterialCover({ libraryItemId: PRIVATE });
    expect(removed.ok).toBe(false);

    expect(item(PRIVATE).cover_url).toBeNull();
  });

  it("refuses an id that is not a material it can find", async () => {
    for (const libraryItemId of [
      "not-a-uuid",
      "",
      "3e1f0a7c-9999-4aaa-8bbb-000000000099",
    ]) {
      const result = await prepareMaterialCoverUpload({
        libraryItemId,
        fileName: "a.jpg",
        mimeType: "image/jpeg",
        fileSize: 4096,
      });
      expect(result.ok).toBe(false);
    }
    expect(signedPaths).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What may become a cover
// ─────────────────────────────────────────────────────────────────────────────

describe("what the bytes have to be", () => {
  it("refuses a type Fluent does not serve, before anything is minted", async () => {
    const result = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "clip.gif",
      mimeType: "image/gif",
      fileSize: 4096,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
    expect(signedPaths).toHaveLength(0);
  });

  it("deletes an object whose bytes are not the image it claimed to be", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "payload.jpg",
      mimeType: "image/jpeg",
      fileSize: PDF.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");

    // A PDF PUT to a path minted for a JPEG. Both browser-side checks passed;
    // this is the one the client cannot author.
    upload(prepared.storagePath, PDF);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(false);
    expect(removedPaths).toContain(prepared.storagePath);
    expect(objects.has(prepared.storagePath)).toBe(false);
    expect(item(STORY).cover_url).toBeNull();
  });

  it("refuses a commit for a path belonging to another material", async () => {
    const foreign = coverObjectPath(PASSAGE, "aaaabbbb", "jpg");
    upload(foreign);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: foreign,
    });

    expect(committed.ok).toBe(false);
    expect(item(STORY).cover_url).toBeNull();
    // And the other material's object was NOT touched on the way out.
    expect(removedPaths).toHaveLength(0);
    expect(objects.has(foreign)).toBe(true);
  });

  it("refuses a commit for a path we could never have minted", async () => {
    for (const storagePath of [
      `library/${STORY}/../${PASSAGE}/a.jpg`,
      `library/${STORY}/a.exe`,
      `other-bucket/${STORY}/a.jpg`,
      "a.jpg",
    ]) {
      upload(storagePath);
      const committed = await commitMaterialCoverUpload({
        libraryItemId: STORY,
        storagePath,
      });
      expect(committed.ok).toBe(false);
    }
    expect(item(STORY).cover_url).toBeNull();
    expect(removedPaths).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replacing
// ─────────────────────────────────────────────────────────────────────────────

describe("replacing a cover", () => {
  const OLD_PATH = coverObjectPath(STORY, "11112222", "jpg");

  beforeEach(() => {
    upload(OLD_PATH);
    item(STORY).cover_url = coverPublicUrl(ORIGIN, OLD_PATH);
  });

  it("deletes the previous object only after the new URL is saved", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "new.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");
    upload(prepared.storagePath);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(true);
    expect(item(STORY).cover_url).toBe(coverPublicUrl(ORIGIN, prepared.storagePath));
    expect(removedPaths).toEqual([OLD_PATH]);
    expect(objects.has(prepared.storagePath)).toBe(true);
  });

  it("leaves the old picture in place when the new upload never arrives", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "new.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");

    // The browser's PUT failed: nothing was ever stored at the minted path.
    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(false);
    expect(item(STORY).cover_url).toBe(coverPublicUrl(ORIGIN, OLD_PATH));
    expect(objects.has(OLD_PATH)).toBe(true);
    expect(removedPaths).toHaveLength(0);
  });

  it("leaves the old picture in place when the new upload is the wrong format", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "new.jpg",
      mimeType: "image/jpeg",
      fileSize: PDF.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");
    upload(prepared.storagePath, PDF);

    const committed = await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    expect(committed.ok).toBe(false);
    expect(item(STORY).cover_url).toBe(coverPublicUrl(ORIGIN, OLD_PATH));
    expect(objects.has(OLD_PATH)).toBe(true);
    // Only the rejected object was cleaned up.
    expect(removedPaths).toEqual([prepared.storagePath]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removing
// ─────────────────────────────────────────────────────────────────────────────

describe("removing a cover", () => {
  it("clears the column and deletes the object we own", async () => {
    const path = coverObjectPath(STORY, "33334444", "webp");
    upload(path);
    item(STORY).cover_url = coverPublicUrl(ORIGIN, path);

    const result = await removeMaterialCover({ libraryItemId: STORY });

    expect(result.ok).toBe(true);
    expect(item(STORY).cover_url).toBeNull();
    expect(removedPaths).toEqual([path]);
  });

  it("never turns a URL that is not ours into a Storage delete", async () => {
    // `cover_url` is a general column — it may hold a publisher's URL one day.
    for (const foreign of [
      "https://publisher.example/covers/der-schluessel.jpg",
      `https://evil.example/storage/v1/object/public/${MATERIAL_COVER_BUCKET}/library/${STORY}/a.jpg`,
      `${ORIGIN}/storage/v1/object/public/private-book-imports/learner-1/book.pdf`,
      `${ORIGIN}/storage/v1/object/public/${MATERIAL_COVER_BUCKET}/library/${PASSAGE}/a.jpg`,
    ]) {
      item(STORY).cover_url = foreign;

      const result = await removeMaterialCover({ libraryItemId: STORY });

      expect(result.ok).toBe(true);
      // The column is cleared unconditionally; the file is not.
      expect(item(STORY).cover_url).toBeNull();
      expect(removedPaths).toHaveLength(0);
    }
  });

  it("is idempotent — pressing it twice is not an error", async () => {
    const path = coverObjectPath(STORY, "55556666", "png");
    upload(path);
    item(STORY).cover_url = coverPublicUrl(ORIGIN, path);

    expect((await removeMaterialCover({ libraryItemId: STORY })).ok).toBe(true);
    expect((await removeMaterialCover({ libraryItemId: STORY })).ok).toBe(true);
    expect(item(STORY).cover_url).toBeNull();
    expect(removedPaths).toEqual([path]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What a cover change is allowed to move
// ─────────────────────────────────────────────────────────────────────────────

describe("cache invalidation", () => {
  it("refreshes the screens that render the picture, and only those", async () => {
    const prepared = await prepareMaterialCoverUpload({
      libraryItemId: STORY,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");
    upload(prepared.storagePath);
    await commitMaterialCoverUpload({
      libraryItemId: STORY,
      storagePath: prepared.storagePath,
    });

    const paths = mocks.revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toEqual(
      expect.arrayContaining(["/today", "/library", "/library/der-schluessel", "/admin/library"]),
    );
    // A material with no passage behind it must not revalidate a legacy route
    // that does not exist for it.
    expect(paths.some((path) => path.startsWith("/learn/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/admin/texts/"))).toBe(false);
  });

  it("also refreshes the legacy routes for a material that has a passage", async () => {
    const prepared = await prepareTextCoverUpload({
      textId: PASSAGE_TEXT_ID,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      fileSize: JPEG.length,
    });
    if (!prepared.ok) throw new Error("prepare should have succeeded");
    upload(prepared.storagePath);
    await commitTextCoverUpload({
      textId: PASSAGE_TEXT_ID,
      storagePath: prepared.storagePath,
    });

    const paths = mocks.revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/library/nikolaus-kopernikus",
        `/learn/${PASSAGE_TEXT_ID}`,
        `/admin/texts/${PASSAGE_TEXT_ID}`,
      ]),
    );
  });
});
