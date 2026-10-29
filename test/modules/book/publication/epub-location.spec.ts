import * as AdmZip from 'adm-zip';
import {
  buildLocationMap,
  parseEpubPackage,
  parsePortableLocation,
  resolveEpubHref,
  validatePortableLocation,
} from 'src/modules/book/publication/epub-location';
import { fixtureFormatId, portableEpubFixture } from 'test/fixtures/epub-portable-location';
import { ContentHashService } from 'src/modules/book/format/content-hash.service';

const mapFor = (zip: AdmZip) => buildLocationMap(zip, parseEpubPackage(zip), fixtureFormatId);

describe('portable EPUB map and wire contract', () => {
  test('measures unequal sections, nested fragments, aliases and a chapter spanning resources', () => {
    const zip = portableEpubFixture();
    const map = mapFor(zip);
    expect(map.contentHash).toBe(
      new ContentHashService({} as never).computeHashFromBuffer(zip.toBuffer(), 'fixture.epub'),
    );
    expect(map.resources.map((resource) => resource.href)).toEqual([
      'OPS/text/one.xhtml',
      'OPS/text/continued.xhtml',
      'OPS/other/one space.xhtml',
    ]);
    expect(map.chapters.map((chapter) => chapter.id)).toEqual([
      'OPS/text/one.xhtml#a',
      'OPS/text/one.xhtml#b',
      'OPS/other/one space.xhtml#c',
      'OPS/other/one space.xhtml#d',
    ]);
    expect(map.chapters.every((chapter) => chapter.start < chapter.end && chapter.kind === 'chapter')).toBe(true);
    expect(map.chapters[1].end).toBe(map.resources[2].start);
    expect(map.chapters[1].end - map.chapters[1].start).toBeGreaterThan(
      20 * (map.chapters[0].end - map.chapters[0].start),
    );
    expect(map.chapters[0].anchor?.exact).toBe(
      'Seed gate A small brass latch opens the garden. A blue marker waits beside the path. ',
    );
    expect(map.chapters[1].anchor?.exact.startsWith('Long orchard The orchard keeper')).toBe(true);
    expect(map.resources[1].start).toBe(map.resources[0].end + 1);
    expect(map.chapters.at(-1)?.end).toBe(map.resources.at(-1)?.end);
    expect(mapFor(zip)).toEqual(map);
  });

  test('resource-only fallback is explicit when the TOC is absent or points to unknown fragments', () => {
    for (const withToc of [false, true]) {
      const zip = portableEpubFixture(withToc);
      if (withToc)
        zip.updateFile(
          'OPS/nav.xhtml',
          Buffer.from(
            '<html><body><nav type="toc"><ol><li><a href="text/one.xhtml#missing">Unknown</a></li></ol></nav></body></html>',
          ),
        );
      const map = mapFor(zip);
      expect(map.chapters).toHaveLength(3);
      expect(map.chapters.every((chapter) => chapter.kind === 'resource' && chapter.id === chapter.href)).toBe(true);
    }
  });

  test('fingerprint invalidates on TOC-only changes, including discarded aliases', () => {
    const zip = portableEpubFixture();
    const original = mapFor(zip);
    zip.updateFile('OPS/nav.xhtml', Buffer.from(zip.readAsText('OPS/nav.xhtml').replace('>Alias<', '>Renamed alias<')));
    const changed = mapFor(zip);
    expect(changed.contentHash).toBe(original.contentHash);
    expect(changed.fingerprint).not.toBe(original.fingerprint);
  });

  test('resolves fragment-only TOC links against the actual navigation document', () => {
    const zip = portableEpubFixture();
    zip.updateFile(
      'OPS/package.opf',
      Buffer.from(zip.readAsText('OPS/package.opf').replace('href="nav.xhtml"', 'href="text/one.xhtml"')),
    );
    zip.updateFile(
      'OPS/text/one.xhtml',
      Buffer.from(
        zip
          .readAsText('OPS/text/one.xhtml')
          .replace(
            '</body>',
            '<nav type="toc"><ol><li><a href="#a">Start</a></li><li><a href="#b">Later</a></li></ol></nav></body>',
          ),
      ),
    );
    expect(mapFor(zip).chapters.map((chapter) => chapter.id)).toEqual(['OPS/text/one.xhtml#a', 'OPS/text/one.xhtml#b']);
  });

  test('an unresolved fragment never makes the previous chapter swallow an unknown section', () => {
    const zip = portableEpubFixture();
    zip.updateFile(
      'OPS/nav.xhtml',
      Buffer.from(
        zip
          .readAsText('OPS/nav.xhtml')
          .replace(
            '<li><a href="other/one%20space.xhtml#c">',
            '<li><a href="text/continued.xhtml#missing">Unknown section</a></li><li><a href="other/one%20space.xhtml#c">',
          ),
      ),
    );
    const map = mapFor(zip);
    expect(map.chapters.find((chapter) => chapter.id === 'OPS/text/one.xhtml#b')?.end).toBe(map.resources[1].start);
    expect(map.chapters.find((chapter) => chapter.id === 'OPS/text/continued.xhtml')).toMatchObject({
      kind: 'resource',
      start: map.resources[1].start,
      end: map.resources[1].end,
    });
  });

  test('malformed navigation explicitly falls back to resources, while invalid package XML is rejected', () => {
    const zip = portableEpubFixture();
    zip.updateFile('OPS/nav.xhtml', Buffer.from('<html><body><p attr="bad></p></body></html>'));
    expect(mapFor(zip).chapters.every((chapter) => chapter.kind === 'resource')).toBe(true);
    expect(parseEpubPackage(zip).tocFailure).toBeDefined();
    zip.updateFile('OPS/package.opf', Buffer.from('<package></broken>'));
    expect(() => mapFor(zip)).toThrow();
  });

  test('visible text inserts block spaces, excludes hidden content, counts UTF16 and handles repeated IDs conservatively', () => {
    const zip = portableEpubFixture(false);
    zip.updateFile(
      'OPS/text/one.xhtml',
      Buffer.from(
        `<html><head><title>Not body</title></head><body><h1>Sun</h1><p>🌻&nbsp;&#160;<span>and</span>&#8239;rain</p><p hidden="">No</p><p style="display:none">No</p><script>No</script><div id="target">Next</div><div id="dup">One</div><div id="dup">Two</div></body></html>`,
      ),
    );
    const map = mapFor(zip);
    const text = 'Sun 🌻 and rain Next One Two';
    expect(map.resources[0].end).toBe(text.length);
    expect(map.resources[0].anchor?.exact).toBe(text);
  });

  test('decodes internal paths once and rejects escapes or external paths', () => {
    expect(resolveEpubHref('OPS', 'text/literal%2520.xhtml#part%201')).toBe('OPS/text/literal%20.xhtml#part 1');
    for (const href of ['../../outside.xhtml', '%2Foutside.xhtml', 'https://other.example/x', 'x%5cy', 'x%00y']) {
      expect(() => resolveEpubHref('OPS', href)).toThrow();
    }
  });

  test('validates identity, fractions, paired chapter fields and chapter/resource membership', () => {
    const map = mapFor(portableEpubFixture());
    const valid = {
      version: 1,
      formatId: fixtureFormatId,
      contentHash: map.contentHash,
      mapFingerprint: map.fingerprint,
      href: map.resources[1].href,
      resourceProgression: 0.4,
      chapterId: map.chapters[1].id,
      chapterProgression: 0.7,
      basis: 'rendered',
    };
    expect(() => validatePortableLocation(parsePortableLocation(valid), map)).not.toThrow();
    expect(parsePortableLocation({ ...valid, native: { engine: 'crengine', domVersion: 20240101 } }).native).toEqual({
      engine: 'crengine',
      domVersion: 20240101,
    });
    for (const native of [
      null,
      {},
      { engine: 'other', domVersion: 1 },
      { engine: 'crengine', domVersion: 0 },
      { engine: 'crengine', domVersion: 1.5 },
      { engine: 'crengine', domVersion: Infinity },
      { engine: 'crengine', domVersion: 2147483648 },
      { engine: 'crengine', domVersion: 1, guess: true },
    ]) {
      expect(() => parsePortableLocation({ ...valid, native })).toThrow();
    }
    for (const patch of [
      { resourceProgression: NaN },
      { resourceProgression: Infinity },
      { resourceProgression: -0.01 },
      { chapterProgression: undefined },
      { chapterId: undefined },
      { version: 2 },
      { href: '' },
      { basis: 'percent' },
      { native: 'not permitted' },
      { chapterProgression: null },
    ])
      expect(() => parsePortableLocation({ ...valid, ...patch })).toThrow();
    for (const patch of [
      { formatId: '20376f55-ab4b-4555-bcb3-b5a359c4c433' },
      { contentHash: 'f'.repeat(64) },
      { mapFingerprint: 'f'.repeat(64) },
      { href: 'other/one space.xhtml' },
      { chapterId: map.chapters[0].id },
    ])
      expect(() => validatePortableLocation(parsePortableLocation({ ...valid, ...patch }), map)).toThrow();
    const last = map.chapters.at(-1)!;
    expect(() =>
      validatePortableLocation(
        parsePortableLocation({
          ...valid,
          href: last.href,
          resourceProgression: 1,
          chapterId: last.id,
          chapterProgression: 1,
          basis: 'text',
        }),
        map,
      ),
    ).not.toThrow();
  });
});
