import * as AdmZip from 'adm-zip';

/** Original prose generated for cross-engine tests; contains no published book content. */
export function portableEpubFixture(withToc = true): AdmZip {
  const zip = new AdmZip();
  const add = (path: string, value: string) => zip.addFile(path, Buffer.from(value));
  add('mimetype', 'application/epub+zip');
  add(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  add(
    'OPS/package.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="fixture">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixture">urn:homebranch:original-location-fixture</dc:identifier><dc:title>Unequal Garden Sections</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-29T00:00:00Z</meta></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="text/continued.xhtml" media-type="application/xhtml+xml"/>
    <item id="three" href="other/one%20space.xhtml" media-type="application/xhtml+xml"/></manifest>
    <spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>`,
  );
  const body = (value: string) =>
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>${value}</body></html>`;
  add(
    'OPS/nav.xhtml',
    body(
      withToc
        ? `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>
    <li><a href="text/one.xhtml#a">Repeated title</a><ol>
      <li><a href="text/one.xhtml#b">Repeated title</a></li>
      <li><a href="text/one.xhtml#alias">Alias</a></li>
    </ol></li>
    <li><a href="other/one%20space.xhtml#c">Repeated title</a><ol>
      <li><a href="other/one%20space.xhtml#d">Last section</a></li>
    </ol></li></ol></nav>`
        : '<p>No navigation is supplied.</p>',
    ),
  );
  add(
    'OPS/text/one.xhtml',
    body(`<section id="a"><h1>Seed gate</h1><p>A small brass latch opens the garden. A blue marker waits beside the path.</p></section>
    <section id="b"><span id="alias"></span><h2>Long orchard</h2><p>${'The orchard keeper counts new leaves and records the changing light. '.repeat(27)}</p></section>`),
  );
  add(
    'OPS/text/continued.xhtml',
    body(
      `<p>The orchard continues beyond the bridge.</p><p>${'On this side of the water, the apricot trees lean toward the morning sun. '.repeat(13)}</p>`,
    ),
  );
  add(
    'OPS/other/one space.xhtml',
    body(`<section id="c"><h1>Glass shelter</h1><p>Inside the shelter, young ferns grow beside a painted watering can.</p><p>${'Each tray has a different colored label. '.repeat(6)}</p></section>
    <section id="d"><h2>Evening notes</h2><p>The last visitor closes the ledger and leaves a lantern at the door.</p></section>`),
  );
  return zip;
}

export const fixtureFormatId = '631ed280-34cc-440f-b00c-53205e75ca9a';
