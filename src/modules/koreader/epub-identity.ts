import { createHash } from 'crypto';
import * as AdmZip from 'adm-zip';
import { convert } from 'xmlbuilder2';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, v]) => key.split(':').at(-1) !== 'metadata' && !(typeof v === 'string' && !v.trim()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, canonical(v)]),
  );
}

/** Conservatively retain aliases only when all resource bytes and non-metadata package structure agree. */
export function metadataIndependentIdentity(buffer: Buffer): string | null {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    if (
      entries.length > 4096 ||
      new Set(entries.map((entry) => entry.entryName)).size !== entries.length ||
      entries.reduce((sum, entry) => sum + entry.header.size, 0) > 64 * 1024 * 1024
    )
      return null;
    const container = zip.readAsText('META-INF/container.xml');
    const path = /full-path=["']([^"']+\.opf)["']/i.exec(container)?.[1];
    if (!path || !zip.getEntry(path)) return null;
    const hash = createHash('sha256');
    for (const entry of entries.sort((a, b) => a.entryName.localeCompare(b.entryName))) {
      const bytes =
        entry.entryName === path
          ? Buffer.from(JSON.stringify(canonical(convert(entry.getData().toString('utf8'), { format: 'object' }))))
          : entry.getData();
      hash.update(`${Buffer.byteLength(entry.entryName)}:${entry.entryName}:${bytes.length}:`);
      hash.update(bytes);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}
