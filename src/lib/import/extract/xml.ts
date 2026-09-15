/**
 * Just enough XML to read an EPUB's own description of itself.
 *
 * WHY NOT A PARSER LIBRARY. Three files are read with this — `container.xml`,
 * the OPF package document and a navigation document — and all three are asked
 * the same two questions: "which elements of this name are there?" and "what are
 * their attributes?". A general XML parser brings a DOM, entity handling and an
 * external-entity resolver, and the last of those is a vulnerability
 * (`XXE`) whose only defence is not having it. A scanner that cannot resolve an
 * external reference cannot be tricked into fetching one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: build a tree, honour namespaces as
 * namespaces (prefixes are stripped and names compared locally, which is
 * correct for EPUB and wrong in general), expand anything but the five XML
 * predefined entities and numeric references, or validate. An EPUB whose OPF is
 * ill-formed enough to defeat this is an EPUB whose spine we should not trust.
 *
 * Pure, deterministic, and never emits markup — the output is text and
 * attributes, so nothing read here can become an element on a page.
 */

import { decodeEntities } from "@/lib/content/normalize";

export interface XmlElement {
  /** Local name, lowercased: `dc:title` and `title` both come back as `title`. */
  name: string;
  attributes: Readonly<Record<string, string>>;
  /** Raw markup between the tags. Empty for a self-closing element. */
  inner: string;
}

/** Fresh instances per call: a shared `lastIndex` across nested scans is a bug. */
const openTagRe = () => /<([a-zA-Z_][\w.:-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
const anyTagRe = () => /<(\/?)([a-zA-Z_][\w.:-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
const attrRe = () =>
  /([a-zA-Z_][\w.:-]*)\s*=\s*"([^"]*)"|([a-zA-Z_][\w.:-]*)\s*=\s*'([^']*)'/g;

/** Strip a namespace prefix and case-fold: `opf:item` → `item`. */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

/**
 * Every element with this local name, in document order, nested ones included.
 *
 * Nested inclusion matters for NCX navigation, where a chapter's sections are
 * `navPoint`s inside the chapter's own `navPoint`. Flattening them into document
 * order is exactly the reading order the importer wants, so no tree is needed to
 * get it.
 */
export function findElements(source: string, tagName: string): XmlElement[] {
  const wanted = tagName.toLowerCase();
  const elements: XmlElement[] = [];

  const tags = openTagRe();
  let match: RegExpExecArray | null;

  while ((match = tags.exec(source)) !== null) {
    if (localName(match[1]) !== wanted) continue;

    const attributes = parseAttributes(match[2] ?? "");
    const openEnd = match.index + match[0].length;

    if (match[3] === "/") {
      elements.push({ name: wanted, attributes, inner: "" });
      continue;
    }

    const close = findClose(source, wanted, openEnd);
    elements.push({
      name: wanted,
      attributes,
      inner: close === -1 ? "" : source.slice(openEnd, close),
    });
  }

  return elements;
}

/** The first element with this name, or null. */
export function findElement(source: string, tagName: string): XmlElement | null {
  return findElements(source, tagName)[0] ?? null;
}

/** An element's text, with markup removed and entities decoded. */
export function textOf(element: XmlElement | null): string {
  if (!element) return "";
  return decodeEntities(element.inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Read an attribute by local name, ignoring any namespace prefix. */
export function attribute(element: XmlElement, name: string): string | null {
  return element.attributes[name.toLowerCase()] ?? null;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  const attributesRe = attrRe();
  let match: RegExpExecArray | null;
  while ((match = attributesRe.exec(source)) !== null) {
    const key = localName(match[1] ?? match[3] ?? "");
    const value = match[2] ?? match[4] ?? "";
    if (key && !(key in attributes)) attributes[key] = decodeEntities(value);
  }

  return attributes;
}

/**
 * Index of the matching `</name>`, accounting for nesting of the same name.
 *
 * Returns -1 when the document never closes the element — which is malformed,
 * and treated as "this element has no content" rather than as a reason to throw:
 * one broken `navPoint` should not cost a book its spine.
 */
function findClose(source: string, name: string, from: number): number {
  let depth = 1;

  const scanner = anyTagRe();
  scanner.lastIndex = from;

  let match: RegExpExecArray | null;
  while ((match = scanner.exec(source)) !== null) {
    if (localName(match[2]) !== name) continue;
    if (match[4] === "/") continue;

    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }

  return -1;
}
