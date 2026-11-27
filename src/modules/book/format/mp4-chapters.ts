import { AudioChapter } from './audio-chapter';

type ReadBytes = (offset: number, length: number) => Promise<Buffer>;

export async function parseMp4Chapters(read: ReadBytes, fileSize: number): Promise<AudioChapter[]> {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error('Invalid MP4 file size');
  const readBytes = async (offset: number, length: number): Promise<Buffer> => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset + length > fileSize) {
      throw new Error('MP4 chapter data exceeds the file bounds');
    }
    const buffer = await read(offset, length);
    if (buffer.length !== length) throw new Error('Incomplete MP4 chapter data');
    return buffer;
  };

  const findAtom = async (
    start: number,
    end: number,
    type: string,
  ): Promise<{ start: number; end: number } | undefined> => {
    for (let offset = start; offset < end; ) {
      if (end - offset < 8) throw new Error('Incomplete MP4 atom header');
      const header = await readBytes(offset, 8);
      let size = header.readUInt32BE(0);
      let headerSize = 8;
      if (size === 1) {
        if (end - offset < 16) throw new Error('Incomplete extended MP4 atom header');
        size = Number((await readBytes(offset + 8, 8)).readBigUInt64BE());
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < headerSize || size > end - offset) {
        throw new Error('Invalid MP4 atom size');
      }
      if (header.toString('latin1', 4, 8) === type) {
        return { start: offset + headerSize, end: offset + size };
      }
      offset += size;
    }
    return undefined;
  };

  const movie = await findAtom(0, fileSize, 'moov');
  if (!movie) return [];
  const userData = await findAtom(movie.start, movie.end, 'udta');
  if (!userData) return [];
  const chapterAtom = await findAtom(userData.start, userData.end, 'chpl');
  if (!chapterAtom) return [];
  const length = chapterAtom.end - chapterAtom.start;
  if (length < 5 || length > 9 + 255 * (8 + 1 + 255)) throw new Error('Invalid MP4 chapter table size');
  const buffer = await readBytes(chapterAtom.start, length);
  const version = buffer[0];
  if (version !== 0 && version !== 1) throw new Error(`Unsupported MP4 chapter table version: ${version}`);
  let offset = version === 1 ? 8 : 4;
  if (offset >= buffer.length) throw new Error('Incomplete MP4 chapter table');
  const count = buffer[offset++];
  const chapters: AudioChapter[] = [];
  for (let index = 0; index < count; index++) {
    if (buffer.length - offset < 9) throw new Error('Incomplete MP4 chapter entry');
    // Nero chapter timestamps use 100-nanosecond units, independent of the audio sample rate.
    const startTime = Number(buffer.readBigUInt64BE(offset)) / 10_000_000;
    const titleLength = buffer[offset + 8];
    offset += 9;
    if (titleLength > buffer.length - offset) throw new Error('Incomplete MP4 chapter title');
    const title = buffer.toString('utf8', offset, offset + titleLength).trim() || `Chapter ${index + 1}`;
    offset += titleLength;
    chapters.push({ title, startTime });
  }
  return chapters.sort((left, right) => left.startTime - right.startTime);
}
