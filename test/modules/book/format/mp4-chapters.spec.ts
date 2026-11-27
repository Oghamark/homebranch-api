import { parseMp4Chapters } from 'src/modules/book/format/mp4-chapters';

function atom(type: string, payload: Buffer, extended = false): Buffer {
  const header = Buffer.alloc(extended ? 16 : 8);
  header.writeUInt32BE(extended ? 1 : header.length + payload.length);
  header.write(type, 4, 'latin1');
  if (extended) header.writeBigUInt64BE(BigInt(header.length + payload.length), 8);
  return Buffer.concat([header, payload]);
}

function chapterTable(version = 1): Buffer {
  const entries = [
    { title: 'Opening', startTime: 0 },
    { title: 'Second chapter', startTime: 943.177 },
  ].map(({ title, startTime }) => {
    const name = Buffer.from(title);
    const entry = Buffer.alloc(9);
    entry.writeBigUInt64BE(BigInt(Math.round(startTime * 10_000_000)));
    entry[8] = name.length;
    return Buffer.concat([entry, name]);
  });
  const header = Buffer.alloc(version === 1 ? 9 : 5);
  header[0] = version;
  header[header.length - 1] = entries.length;
  return Buffer.concat([header, ...entries]);
}

describe('MP4 Nero chapter tables', () => {
  it.each([0, 1])('reads version %i chapters when movie metadata follows the audio payload', async (version) => {
    const payload = Buffer.alloc(100_000);
    const file = Buffer.concat([
      atom('ftyp', Buffer.from('M4B ')),
      atom('mdat', payload, true),
      atom('moov', atom('udta', atom('chpl', chapterTable(version)))),
    ]);
    const read = jest.fn((offset: number, length: number) => Promise.resolve(file.subarray(offset, offset + length)));
    await expect(parseMp4Chapters(read, file.length)).resolves.toEqual([
      { title: 'Opening', startTime: 0 },
      { title: 'Second chapter', startTime: 943.177 },
    ]);
    expect(read.mock.calls.every(([, length]) => length < payload.length)).toBe(true);
  });

  it('returns no chapters when no chapter table exists', async () => {
    const file = atom('moov', atom('udta', atom('name', Buffer.from('No chapters'))));
    await expect(
      parseMp4Chapters((offset, length) => Promise.resolve(file.subarray(offset, offset + length)), file.length),
    ).resolves.toEqual([]);
  });

  it('rejects a truncated title instead of caching an empty chapter list', async () => {
    const table = chapterTable().subarray(0, -1);
    const file = atom('moov', atom('udta', atom('chpl', table)));
    await expect(
      parseMp4Chapters((offset, length) => Promise.resolve(file.subarray(offset, offset + length)), file.length),
    ).rejects.toThrow('Incomplete MP4 chapter title');
  });

  it('rejects atoms whose declared size extends beyond the file', async () => {
    const file = atom('moov', Buffer.alloc(0));
    file.writeUInt32BE(1000);
    await expect(
      parseMp4Chapters((offset, length) => Promise.resolve(file.subarray(offset, offset + length)), file.length),
    ).rejects.toThrow('Invalid MP4 atom size');
  });
});
