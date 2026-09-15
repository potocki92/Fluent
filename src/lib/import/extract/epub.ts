/**
 * EPUB — the format that already knows what it is.
 *
 * An EPUB is not "a zip with some text files in it". It is a package with a
 * manifest of its resources, a SPINE giving the exact reading order, and a
 * navigation document naming the chapters. Every one of those is authored
 * metadata, which makes EPUB the format where Fluent has to guess least: the
 * chapter boundaries are declared, not detected, so a book whose headings are
 * images still splits correctly.
 *
 *     META-INF/container.xml  → where the package document is
 *     <package>/<metadata>    → title, author, language
 *     <package>/<manifest>    → id → href for every resource
 *     <package>/<spine>       → reading order, as manifest ids
 *     nav.xhtml / toc.ncx     → chapter titles, in order
 *
 * SECURITY: EPUB CONTENT IS UNTRUSTED. It is somebody's file, it contains
 * arbitrary XHTML, and it may contain `<script>`. Nothing here renders it:
 * documents are converted to TEXT by {@link htmlToPlainText}, which discards
 * `<script>`, `<style>` and `<template>` bodies outright and re-emits no tag of
 * any kind. There is no `dangerouslySetInnerHTML` anywhere in this feature and
 * there must never be one — the reader draws structure from rows, and the rows
 * hold plain text.
 *
 * PATHS ARE UNTRUSTED TOO. An href is resolved relative to the package document
 * and then checked: a manifest that points at `../../etc/passwd` resolves to
 * nothing inside the archive, and unresolvable entries are skipped rather than
 * followed. Nothing outside the zip is ever read, because the zip is all there
 * is — `fflate` unpacks into memory and no filesystem is touched.
 */

import { unzipSync, strFromU8 } from "fflate";

import { htmlToPlainText } from "@/lib/content/normalize";
import {
  attribute,
  findElement,
  findElements,
  textOf,
  type XmlElement,
} from "@/lib/import/extract/xml";
import type {
  BookExtractor,
  DeclaredChapter,
  ExtractedBook,
  ExtractedPage,
  FileIdentity,
} from "@/lib/import/types";

export const epubExtractor: BookExtractor = {
  format: "epub",

  canHandle(identity: FileIdentity): boolean {
    return identity.format === "epub";
  },

  async extract(bytes: Uint8Array): Promise<ExtractedBook> {
    const archive = unzipSync(bytes);
    const read = (path: string): string | null => {
      const entry = archive[path];
      return entry ? strFromU8(entry) : null;
    };

    const opfPath = packageDocumentPath(read);
    const opf = read(opfPath);
    if (!opf) throw new Error("epub package document is missing");

    const base = directoryOf(opfPath);
    const manifest = readManifest(opf, base, Object.keys(archive));
    const spine = readSpine(opf, manifest);
    if (spine.length === 0) throw new Error("epub spine is empty");

    const pages: ExtractedPage[] = [];
    const pageByHref = new Map<string, number>();

    for (const item of spine) {
      const source = read(item.path);
      if (source === null) continue;

      const text = htmlToPlainText(source);
      const number = pages.length + 1;
      pages.push({ number, text, href: item.path });
      pageByHref.set(item.path, number);
    }

    if (pages.length === 0) throw new Error("epub contained no readable documents");

    return {
      format: "epub",
      pages,
      metadata: readMetadata(opf),
      // An EPUB is reflowable: it has no pages, and inventing a number from a
      // character count would be a fiction the UI would then display.
      pageCount: null,
      declaredChapters: readNavigation(read, opf, manifest, base, pageByHref, spine),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// package document
// ─────────────────────────────────────────────────────────────────────────────

type Reader = (path: string) => string | null;

interface ManifestItem {
  id: string;
  /** Archive-absolute path, already resolved against the package document. */
  path: string;
  mediaType: string;
  properties: string;
}

/**
 * Where the package document lives.
 *
 * `META-INF/container.xml` is the one path the EPUB specification fixes, and
 * everything else in the archive is found from it. A reader that guessed
 * `OEBPS/content.opf` would work on most books and fail on the rest.
 */
function packageDocumentPath(read: Reader): string {
  const container = read("META-INF/container.xml");
  if (!container) throw new Error("epub container.xml is missing");

  for (const rootfile of findElements(container, "rootfile")) {
    const path = attribute(rootfile, "full-path");
    if (path) return normalizePath(path);
  }

  throw new Error("epub container.xml names no package document");
}

function readMetadata(opf: string): ExtractedBook["metadata"] {
  const metadata = findElement(opf, "metadata");
  const scope = metadata?.inner ?? opf;

  const title = textOf(findElement(scope, "title")) || null;
  const language = textOf(findElement(scope, "language")) || null;

  // `dc:creator` is the author; a book with several gets the first, because a
  // single `author` column is what the library has and a joined list would be a
  // worse answer than a correct one.
  const creator = findElements(scope, "creator")
    .map((element) => textOf(element))
    .find(Boolean);

  return {
    title,
    author: creator ?? null,
    language: language ? language.slice(0, 2).toLowerCase() : null,
  };
}

function readManifest(
  opf: string,
  base: string,
  entries: readonly string[],
): Map<string, ManifestItem> {
  const present = new Set(entries);
  const items = new Map<string, ManifestItem>();

  const manifest = findElement(opf, "manifest");
  for (const element of findElements(manifest?.inner ?? opf, "item")) {
    const id = attribute(element, "id");
    const href = attribute(element, "href");
    if (!id || !href) continue;

    const path = resolveHref(base, href);
    // An href that does not resolve to an entry in this archive is skipped, not
    // followed. That is the whole of the path-traversal defence, and it holds
    // because there is nothing outside the archive to traverse to.
    if (!present.has(path)) continue;

    items.set(id, {
      id,
      path,
      mediaType: (attribute(element, "media-type") ?? "").toLowerCase(),
      properties: (attribute(element, "properties") ?? "").toLowerCase(),
    });
  }

  return items;
}

/**
 * The reading order.
 *
 * `linear="no"` marks auxiliary content — a pop-up note, a plate — that is
 * reachable from the text but not part of it, so it is excluded. Everything else
 * is a document of the book, in the order the author put it in.
 */
function readSpine(opf: string, manifest: Map<string, ManifestItem>): ManifestItem[] {
  const spine = findElement(opf, "spine");
  const items: ManifestItem[] = [];

  for (const itemref of findElements(spine?.inner ?? opf, "itemref")) {
    if ((attribute(itemref, "linear") ?? "").toLowerCase() === "no") continue;
    const id = attribute(itemref, "idref");
    const item = id ? manifest.get(id) : undefined;
    if (item) items.push(item);
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// navigation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The chapter list, from whichever navigation the book carries.
 *
 * EPUB 3 uses an XHTML `nav` document; EPUB 2 uses an NCX. Both are read,
 * because a learner's shelf contains both, and neither is preferred over the
 * other beyond "try the modern one first".
 *
 * WHEN THERE IS NO NAVIGATION, the spine itself is the answer: one document per
 * chapter is what almost every EPUB producer emits. That is a weaker claim than
 * a declared table of contents, so the titles come from each document's own
 * first line rather than being invented.
 */
function readNavigation(
  read: Reader,
  opf: string,
  manifest: Map<string, ManifestItem>,
  base: string,
  pageByHref: Map<string, number>,
  spine: readonly ManifestItem[],
): DeclaredChapter[] {
  const fromNav = readEpub3Nav(read, manifest, pageByHref);
  if (fromNav.length > 0) return fromNav;

  const fromNcx = readNcx(read, opf, manifest, base, pageByHref);
  if (fromNcx.length > 0) return fromNcx;

  return spine.map((item) => ({
    title: null,
    startPage: pageByHref.get(item.path) ?? 1,
    href: item.path,
  }));
}

function readEpub3Nav(
  read: Reader,
  manifest: Map<string, ManifestItem>,
  pageByHref: Map<string, number>,
): DeclaredChapter[] {
  const navItem = [...manifest.values()].find((item) =>
    item.properties.split(/\s+/).includes("nav"),
  );
  if (!navItem) return [];

  const source = read(navItem.path);
  if (!source) return [];

  // The `toc` nav, not the landmarks or the page list — those are different
  // lists of the same links and would produce a book of duplicated chapters.
  const nav =
    findElements(source, "nav").find(
      (element) => (attribute(element, "type") ?? "").includes("toc"),
    ) ?? findElement(source, "nav");
  if (!nav) return [];

  const navBase = directoryOf(navItem.path);
  return linksToChapters(findElements(nav.inner, "a"), navBase, pageByHref);
}

function readNcx(
  read: Reader,
  opf: string,
  manifest: Map<string, ManifestItem>,
  base: string,
  pageByHref: Map<string, number>,
): DeclaredChapter[] {
  const spine = findElement(opf, "spine");
  const tocId = spine ? attribute(spine, "toc") : null;

  const ncxItem =
    (tocId ? manifest.get(tocId) : undefined) ??
    [...manifest.values()].find(
      (item) => item.mediaType === "application/x-dtbncx+xml",
    );
  if (!ncxItem) return [];

  const source = read(ncxItem.path);
  if (!source) return [];

  const ncxBase = directoryOf(ncxItem.path);
  const chapters: DeclaredChapter[] = [];

  for (const navPoint of findElements(source, "navpoint")) {
    const content = findElement(navPoint.inner, "content");
    const src = content ? attribute(content, "src") : null;
    if (!src) continue;

    const path = resolveHref(ncxBase || base, stripFragment(src));
    const page = pageByHref.get(path);
    if (page === undefined) continue;

    chapters.push({
      title: textOf(findElement(navPoint.inner, "text")) || null,
      startPage: page,
      href: path,
    });
  }

  return dedupeByPage(chapters);
}

function linksToChapters(
  anchors: readonly XmlElement[],
  base: string,
  pageByHref: Map<string, number>,
): DeclaredChapter[] {
  const chapters: DeclaredChapter[] = [];

  for (const anchor of anchors) {
    const href = attribute(anchor, "href");
    if (!href) continue;

    const path = resolveHref(base, stripFragment(href));
    const page = pageByHref.get(path);
    if (page === undefined) continue;

    chapters.push({ title: textOf(anchor) || null, startPage: page, href: path });
  }

  return dedupeByPage(chapters);
}

/**
 * One chapter per document.
 *
 * A navigation document routinely lists several anchors into the same file — a
 * chapter and its sections. Fluent's unit of reading is the document, so the
 * first anchor wins and the rest would otherwise produce empty chapters that all
 * start at the same place.
 */
function dedupeByPage(chapters: readonly DeclaredChapter[]): DeclaredChapter[] {
  const seen = new Set<number>();
  const unique: DeclaredChapter[] = [];

  for (const chapter of chapters) {
    if (seen.has(chapter.startPage)) continue;
    seen.add(chapter.startPage);
    unique.push(chapter);
  }

  return unique.sort((a, b) => a.startPage - b.startPage);
}

// ─────────────────────────────────────────────────────────────────────────────
// paths
// ─────────────────────────────────────────────────────────────────────────────

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function stripFragment(href: string): string {
  const hash = href.indexOf("#");
  return hash === -1 ? href : href.slice(0, hash);
}

/**
 * Resolve an href against the directory of the document that contains it.
 *
 * `..` segments are applied rather than rejected, because a legitimate EPUB uses
 * them (`../Styles/main.css`). What makes that safe is that the result is only
 * ever looked up in the archive's own entry list: a path that climbs above the
 * root simply matches nothing.
 */
function resolveHref(base: string, href: string): string {
  const decoded = safeDecode(href);
  if (decoded.startsWith("/")) return normalizePath(decoded.slice(1));

  const segments = [...base.split("/").filter(Boolean), ...decoded.split("/")];
  const resolved: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.join("/");
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
