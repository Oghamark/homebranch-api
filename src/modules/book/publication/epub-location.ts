import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { posix } from 'path';
import * as AdmZip from 'adm-zip';
import { create } from 'xmlbuilder2';

export interface BoundaryAnchor {
  version: 1;
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface LocationMap {
  version: 1;
  capabilities?: { passageAnchor: 1 };
  formatId: string;
  contentHash: string;
  fingerprint: string;
  resources: { href: string; start: number; end: number; anchor?: BoundaryAnchor }[];
  chapters: {
    id: string;
    title: string;
    href: string;
    fragment?: string;
    kind: 'chapter' | 'resource';
    start: number;
    end: number;
    anchor?: BoundaryAnchor;
  }[];
}

export interface PortableLocation {
  version: 1;
  formatId: string;
  contentHash: string;
  mapFingerprint: string;
  href: string;
  resourceProgression: number;
  chapterId?: string;
  chapterProgression?: number;
  basis: 'text' | 'rendered';
  native?: { engine: 'crengine'; domVersion: number };
  passage?: BoundaryAnchor;
}

interface XmlNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  nodeValue: string | null;
  textContent: string | null;
  childNodes: ArrayLike<XmlNode | undefined>;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
}

export interface EpubTocEntry {
  href: string;
  title: string;
  children?: EpubTocEntry[];
}

export interface EpubPackage {
  items: { id: string; href: string; mediaType: string; properties: string }[];
  spine: string[];
  toc: EpubTocEntry[];
  language: string;
  readingProgression: string;
  tocFailure?: string;
}

const name = (node: XmlNode) => (node.localName ?? node.nodeName.split(':').at(-1) ?? '').toLowerCase();
const children = (node: XmlNode) =>
  Array.from(node.childNodes).filter((child): child is XmlNode => !!child && child.nodeType === 1);
const attr = (node: XmlNode, key: string) => node.getAttribute?.(key) ?? '';
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
const containsControls = (value: string) => Array.from(value).some((character) => character.charCodeAt(0) < 32);

function descendants(node: XmlNode, target: string): XmlNode[] {
  const found: XmlNode[] = [];
  const visit = (current: XmlNode, depth: number) => {
    if (depth > 128) throw new BadRequestException('EPUB XML nesting limit exceeded');
    if (name(current) === target) found.push(current);
    for (const child of children(current)) visit(child, depth + 1);
  };
  visit(node, 0);
  return found;
}

function xml(value: string): XmlNode {
  if (value.length > 8 * 1024 * 1024 || /<!ENTITY\b/i.test(value)) {
    throw new BadRequestException('Unsupported EPUB XML size or entity declaration');
  }
  try {
    return create(value.replace(/&nbsp;/g, '&#160;')).node;
  } catch (error) {
    throw new BadRequestException('Invalid EPUB XML', { cause: error });
  }
}

/** Resolve once, preserving literal percent signs in already-decoded archive paths. */
export function resolveEpubHref(base: string, value: string): string {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value) || value.includes('?')) {
    throw new BadRequestException('Invalid EPUB internal href');
  }
  const index = value.indexOf('#');
  const path = index < 0 ? value : value.slice(0, index);
  let decoded: string;
  let fragment: string;
  try {
    decoded = decodeURIComponent(path);
    fragment = index < 0 ? '' : decodeURIComponent(value.slice(index + 1));
  } catch (error) {
    throw new BadRequestException('Invalid EPUB href encoding', { cause: error });
  }
  const resolved = posix.normalize(posix.join(base, decoded));
  if (
    /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(decoded) ||
    resolved.length + (fragment ? fragment.length + 1 : 0) > 2048 ||
    resolved === '..' ||
    resolved.startsWith('../') ||
    resolved.startsWith('/') ||
    containsControls(resolved) ||
    resolved.includes('\\') ||
    resolved.includes('#') ||
    containsControls(fragment)
  ) {
    throw new BadRequestException('Invalid EPUB internal path');
  }
  return `${resolved}${fragment ? `#${fragment}` : ''}`;
}

function resolveDocumentHref(documentHref: string, reference: string): string {
  return reference.startsWith('#')
    ? resolveEpubHref('', `${documentHref.split('/').map(encodeURIComponent).join('/')}${reference}`)
    : resolveEpubHref(posix.dirname(documentHref), reference);
}

export function parseEpubPackage(zip: Pick<AdmZip, 'readAsText'>): EpubPackage {
  const container = xml(zip.readAsText('META-INF/container.xml'));
  const rootfile = descendants(container, 'rootfile')[0];
  if (!rootfile) throw new BadRequestException('Missing EPUB package');
  const opfPath = resolveEpubHref('', attr(rootfile, 'full-path'));
  const opf = xml(zip.readAsText(opfPath));
  const base = posix.dirname(opfPath);
  const manifest = descendants(opf, 'manifest')[0];
  const spineNode = descendants(opf, 'spine')[0];
  if (!manifest || !spineNode) throw new BadRequestException('Missing EPUB manifest or spine');
  const items = children(manifest)
    .filter((node) => name(node) === 'item')
    .map((node) => ({
      id: attr(node, 'id'),
      href: resolveEpubHref(base, attr(node, 'href')),
      mediaType: attr(node, 'media-type'),
      properties: attr(node, 'properties'),
    }));
  if (
    items.length > 4096 ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some((item) => !item.id || item.id.length > 2048 || !item.mediaType || item.mediaType.length > 128)
  ) {
    throw new BadRequestException('Invalid or oversized EPUB manifest');
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const spine = children(spineNode)
    .filter((node) => name(node) === 'itemref')
    .map((node) => {
      const item = byId.get(attr(node, 'idref'));
      if (!item) throw new BadRequestException('EPUB spine refers to a missing resource');
      return item.href;
    });
  if (!spine.length || spine.length > 1024 || new Set(spine).size !== spine.length) {
    throw new BadRequestException('Unsupported EPUB spine');
  }
  const nav = items.find((item) => item.properties.split(/\s+/u).includes('nav'));
  const ncx = byId.get(attr(spineNode, 'toc'));
  let toc: EpubTocEntry[] = [];
  let tocFailure: string | undefined;
  try {
    if (nav) {
      const document = xml(zip.readAsText(nav.href));
      const tocNode = descendants(document, 'nav').find((node) =>
        (attr(node, 'epub:type') || attr(node, 'type')).split(/\s+/u).includes('toc'),
      );
      const parseList = (list: XmlNode, depth = 0): EpubTocEntry[] => {
        if (depth > 64) throw new BadRequestException('EPUB TOC nesting limit exceeded');
        return children(list).flatMap((li) => {
          const anchor = children(li).find((node) => name(node) === 'a');
          const nested = children(li).find((node) => name(node) === 'ol');
          const childItems = nested ? parseList(nested, depth + 1) : [];
          if (!anchor) return childItems;
          const target = attr(anchor, 'href');
          if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return childItems;
          return [
            {
              href: resolveDocumentHref(nav.href, target),
              title: normalize(anchor.textContent ?? '').slice(0, 512),
              ...(childItems.length ? { children: childItems } : {}),
            },
          ];
        });
      };
      const list = tocNode && children(tocNode).find((node) => name(node) === 'ol');
      if (list) toc = parseList(list);
    } else if (ncx) {
      const document = xml(zip.readAsText(ncx.href));
      const parsePoints = (parent: XmlNode, depth = 0): EpubTocEntry[] => {
        if (depth > 64) throw new BadRequestException('EPUB TOC nesting limit exceeded');
        return children(parent)
          .filter((node) => name(node) === 'navpoint')
          .flatMap((point) => {
            const content = children(point).find((node) => name(node) === 'content');
            const label = children(point).find((node) => name(node) === 'navlabel');
            const nested = parsePoints(point, depth + 1);
            if (!content) return nested;
            return [
              {
                href: resolveDocumentHref(ncx.href, attr(content, 'src')),
                title: normalize(label?.textContent ?? '').slice(0, 512),
                ...(nested.length ? { children: nested } : {}),
              },
            ];
          });
      };
      const navMap = descendants(document, 'navmap')[0];
      if (navMap) toc = parsePoints(navMap);
    }
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    tocFailure = error.message;
    toc = [];
  }
  return {
    items,
    spine,
    toc,
    language: descendants(opf, 'language')[0]?.textContent?.trim() || 'en',
    readingProgression: attr(spineNode, 'page-progression-direction') === 'rtl' ? 'rtl' : 'ltr',
    ...(tocFailure ? { tocFailure } : {}),
  };
}

const blocks = new Set(
  'address article aside blockquote br caption dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td th thead tr ul'.split(
    ' ',
  ),
);
const excluded = new Set(['script', 'style', 'head', 'template', 'noscript']);

function bodyText(source: string): { text: string; fragments: Map<string, number> } {
  const document = xml(source);
  const body = descendants(document, 'body')[0];
  if (!body) throw new BadRequestException('EPUB spine resource has no body');
  let raw = '';
  let nodes = 0;
  const marks = new Map<string, number | null>();
  const visit = (node: XmlNode, depth: number) => {
    if (++nodes > 250000 || depth > 128) throw new BadRequestException('EPUB text complexity limit exceeded');
    if (node.nodeType === 3 || node.nodeType === 4) {
      raw += node.nodeValue ?? '';
      return;
    }
    if (
      excluded.has(name(node)) ||
      node.hasAttribute?.('hidden') ||
      attr(node, 'aria-hidden') === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(node, 'style'))
    )
      return;
    if (blocks.has(name(node))) raw += ' ';
    const id = attr(node, 'id') || attr(node, 'xml:id') || (name(node) === 'a' ? attr(node, 'name') : '');
    if (id) marks.set(id, marks.has(id) ? null : raw.length);
    for (const child of Array.from(node.childNodes)) if (child) visit(child, depth + 1);
    if (blocks.has(name(node))) raw += ' ';
  };
  visit(body, 0);
  // Map raw boundaries to the next visible character after normalized whitespace.
  const offsets = new Uint32Array(raw.length + 1);
  let length = 0;
  let space = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/u.test(raw[i])) {
      space = length > 0;
      offsets[i] = length + (space ? 1 : 0);
    } else {
      if (space) length++;
      offsets[i] = length;
      length++;
      space = false;
    }
  }
  const text = normalize(raw);
  offsets[raw.length] = text.length;
  const fragments = new Map<string, number>();
  for (const [id, mark] of marks) {
    if (mark !== null) fragments.set(id, Math.min(offsets[mark], text.length));
  }
  return { text, fragments };
}

export function buildLocationMap(zip: AdmZip, publication: EpubPackage, formatId: string): LocationMap {
  const hash = createHash('sha256');
  const texts = publication.spine.map((href) => {
    const entry = zip.getEntry(href);
    if (!entry || entry.header.size > 8 * 1024 * 1024) throw new BadRequestException('Missing or oversized EPUB text');
    const bytes = entry.getData();
    hash.update(bytes);
    return bodyText(bytes.toString('utf8'));
  });
  const fullText = texts.map((entry) => entry.text).join(' ');
  if (fullText.length > 16 * 1024 * 1024) throw new BadRequestException('EPUB text limit exceeded');
  const quoteSlice = (start: number, end: number) => {
    if (start > 0 && /[\uDC00-\uDFFF]/u.test(fullText[start] ?? '')) start++;
    if (/[\uD800-\uDBFF]/u.test(fullText[end - 1] ?? '')) end--;
    return fullText.slice(start, end);
  };
  const anchor = (start: number, end: number): BoundaryAnchor | undefined => {
    const exact = quoteSlice(start, Math.min(end, start + 192));
    if (!exact.trim()) return undefined;
    return {
      version: 1,
      exact,
      ...(start ? { prefix: quoteSlice(Math.max(0, start - 64), start) } : {}),
      ...(start + exact.length < fullText.length
        ? { suffix: quoteSlice(start + exact.length, start + exact.length + 64) }
        : {}),
    };
  };
  let offset = 0;
  const resources = publication.spine.map((href, index) => {
    const start = offset;
    const end = start + texts[index].text.length;
    offset = end + 1;
    return { href, start, end, anchor: anchor(start, end) };
  });
  const boundaries: {
    id: string;
    title: string;
    href: string;
    fragment?: string;
    start: number;
    depth: number;
    order: number;
    kind: 'chapter' | 'resource';
  }[] = [];
  const unusable = new Set<string>();
  let tocCount = 0;
  const visit = (entries: EpubTocEntry[], depth = 0) => {
    for (const entry of entries) {
      if (++tocCount > 4096) throw new BadRequestException('EPUB TOC limit exceeded');
      const separator = entry.href.indexOf('#');
      const href = separator < 0 ? entry.href : entry.href.slice(0, separator);
      const fragment = separator < 0 ? undefined : entry.href.slice(separator + 1);
      const index = publication.spine.indexOf(href);
      const local = index < 0 ? undefined : fragment ? texts[index].fragments.get(fragment) : 0;
      if (index >= 0 && local === undefined) unusable.add(href);
      if (index >= 0 && local !== undefined && resources[index].end > resources[index].start + local) {
        boundaries.push({
          id: entry.href,
          title: entry.title,
          href,
          ...(fragment ? { fragment } : {}),
          start: resources[index].start + local,
          depth,
          order: tocCount,
          kind: 'chapter',
        });
      }
      if (entry.children) visit(entry.children, depth + 1);
    }
  };
  visit(publication.toc);
  // An unknown fragment might start anywhere in its file. Do not extend an
  // earlier verified chapter across it and falsely identify that text.
  for (let index = boundaries.length - 1; index >= 0; index--) {
    if (unusable.has(boundaries[index].href)) boundaries.splice(index, 1);
  }
  for (const resource of resources) {
    if (unusable.has(resource.href))
      boundaries.push({
        id: resource.href,
        title: resource.href,
        href: resource.href,
        start: resource.start,
        depth: 0,
        order: 0,
        kind: 'resource',
      });
  }
  boundaries.sort((a, b) => a.start - b.start || b.depth - a.depth || a.order - b.order);
  const starts = boundaries.filter((entry, index) => index === 0 || boundaries[index - 1].start !== entry.start);
  const chapters: LocationMap['chapters'] = starts.flatMap((entry, index) =>
    entry.kind === 'chapter'
      ? [
          {
            id: entry.id,
            title: entry.title,
            href: entry.href,
            ...(entry.fragment ? { fragment: entry.fragment } : {}),
            kind: 'chapter' as const,
            start: entry.start,
            end: starts[index + 1]?.start ?? fullText.length,
            anchor: anchor(entry.start, starts[index + 1]?.start ?? fullText.length),
          },
        ]
      : [],
  );
  const fallbackRanges = [
    { start: 0, end: starts[0]?.start ?? fullText.length },
    ...starts.flatMap((entry, index) =>
      entry.kind === 'resource' ? [{ start: entry.start, end: starts[index + 1]?.start ?? fullText.length }] : [],
    ),
  ];
  for (const range of fallbackRanges) {
    for (const resource of resources) {
      const start = Math.max(resource.start, range.start);
      const end = Math.min(resource.end, range.end);
      if (start < end)
        chapters.push({
          id: resource.href,
          title: resource.href,
          href: resource.href,
          kind: 'resource',
          start,
          end,
          anchor: anchor(start, end),
        });
    }
  }
  chapters.sort((a, b) => a.start - b.start);
  const contentHash = hash.digest('hex');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ version: 1, contentHash, resources, chapters, toc: publication.toc }))
    .digest('hex');
  return { version: 1, formatId, contentHash, fingerprint, resources, chapters, capabilities: { passageAnchor: 1 } };
}

export function parsePortableLocation(value: unknown): PortableLocation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid portable location');
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    'version',
    'formatId',
    'contentHash',
    'mapFingerprint',
    'href',
    'resourceProgression',
    'chapterId',
    'chapterProgression',
    'basis',
    'native',
    'passage',
  ]);
  const fraction = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const bounded = (value: unknown) =>
    typeof value === 'string' && value.length > 0 && value.length <= 2048 && !containsControls(value);
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    input.version !== 1 ||
    typeof input.formatId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.formatId) ||
    typeof input.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.contentHash) ||
    typeof input.mapFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.mapFingerprint) ||
    !bounded(input.href) ||
    !fraction(input.resourceProgression) ||
    (input.basis !== 'text' && input.basis !== 'rendered') ||
    (input.chapterId === undefined) !== (input.chapterProgression === undefined) ||
    (input.chapterId !== undefined && (!bounded(input.chapterId) || !fraction(input.chapterProgression)))
  ) {
    throw new BadRequestException('Invalid portable location');
  }
  let native: PortableLocation['native'];
  let passage: PortableLocation['passage'];
  if (input.passage !== undefined) {
    if (!input.passage || typeof input.passage !== 'object' || Array.isArray(input.passage))
      throw new BadRequestException('Invalid portable passage anchor');
    const anchor = input.passage as Record<string, unknown>;
    const text = (value: unknown, limit: number) =>
      typeof value === 'string' && value.length > 0 && value.length <= limit && !containsControls(value);
    if (
      Object.keys(anchor).some((key) => !['version', 'exact', 'prefix', 'suffix'].includes(key)) ||
      anchor.version !== 1 ||
      !text(anchor.exact, 256) ||
      (anchor.exact as string).trim().length < 8 ||
      (anchor.prefix !== undefined && !text(anchor.prefix, 64)) ||
      (anchor.suffix !== undefined && !text(anchor.suffix, 64))
    )
      throw new BadRequestException('Invalid portable passage anchor');
    passage = {
      version: 1,
      exact: anchor.exact as string,
      ...(anchor.prefix === undefined ? {} : { prefix: anchor.prefix as string }),
      ...(anchor.suffix === undefined ? {} : { suffix: anchor.suffix as string }),
    };
  }
  if (input.native !== undefined) {
    if (!input.native || typeof input.native !== 'object' || Array.isArray(input.native)) {
      throw new BadRequestException('Invalid portable native provenance');
    }
    const provenance = input.native as Record<string, unknown>;
    if (
      Object.keys(provenance).some((key) => key !== 'engine' && key !== 'domVersion') ||
      provenance.engine !== 'crengine' ||
      typeof provenance.domVersion !== 'number' ||
      !Number.isSafeInteger(provenance.domVersion) ||
      provenance.domVersion <= 0 ||
      provenance.domVersion > 2147483647
    ) {
      throw new BadRequestException('Invalid portable native provenance');
    }
    native = { engine: 'crengine', domVersion: provenance.domVersion };
  }
  return {
    version: 1,
    formatId: input.formatId,
    contentHash: input.contentHash,
    mapFingerprint: input.mapFingerprint,
    href: input.href as string,
    resourceProgression: input.resourceProgression as number,
    basis: input.basis,
    ...(native ? { native } : {}),
    ...(input.chapterId === undefined
      ? {}
      : { chapterId: input.chapterId as string, chapterProgression: input.chapterProgression as number }),
    ...(passage ? { passage } : {}),
  };
}

export function validatePortableLocation(location: PortableLocation, map: LocationMap): void {
  if (
    location.formatId !== map.formatId ||
    location.contentHash !== map.contentHash ||
    location.mapFingerprint !== map.fingerprint
  ) {
    throw new BadRequestException('Portable location publication map is stale or incompatible');
  }
  const resource = map.resources.find((entry) => entry.href === location.href);
  if (!resource) throw new BadRequestException('Portable location resource is not in this publication');
  if (location.chapterId !== undefined) {
    const chapter = map.chapters.find((entry) => entry.id === location.chapterId);
    if (!chapter || chapter.start >= resource.end || chapter.end <= resource.start) {
      throw new BadRequestException('Portable location chapter does not intersect this resource');
    }
    if (location.basis === 'text') {
      const resourcePoint = resource.start + (resource.end - resource.start) * location.resourceProgression;
      const chapterPoint = chapter.start + (chapter.end - chapter.start) * location.chapterProgression!;
      if (
        Math.abs(resourcePoint - chapterPoint) > 2 ||
        resourcePoint < chapter.start ||
        resourcePoint > chapter.end ||
        (resourcePoint === chapter.end && chapter.end !== map.resources.at(-1)?.end)
      ) {
        throw new BadRequestException('Portable location text coordinates disagree');
      }
    }
  }
}
