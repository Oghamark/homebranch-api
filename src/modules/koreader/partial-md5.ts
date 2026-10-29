import { createHash } from 'crypto';
import { IStorageService } from '../storage/storage.interface';

// LuaJIT bit.lshift(1024, -2) shifts by 30 modulo 32 and produces zero.
export const PARTIAL_MD5_OFFSETS = [0, ...Array.from({ length: 11 }, (_, i) => 1024 * 4 ** i)];

export function partialMd5(buffer: Buffer): string {
  const hash = createHash('md5');
  for (const offset of PARTIAL_MD5_OFFSETS) {
    if (offset >= buffer.length) break;
    hash.update(buffer.subarray(offset, offset + 1024));
  }
  return hash.digest('hex');
}

export async function partialMd5FromStorage(storage: IStorageService, key: string, size: number): Promise<string> {
  const hash = createHash('md5');
  for (const offset of PARTIAL_MD5_OFFSETS) {
    if (offset >= size) break;
    const end = Math.min(offset + 1023, size - 1);
    const { stream, contentRange } = await storage.getFileStream(key, { start: offset, end });
    let count = 0;
    try {
      if (contentRange !== `bytes ${offset}-${end}/${size}`) throw new Error('Storage did not honor byte range');
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        count += bytes.length;
        if (count > end - offset + 1) throw new Error('Storage exceeded byte range');
        hash.update(bytes);
      }
      if (count !== end - offset + 1) throw new Error('Storage returned incomplete byte range');
    } finally {
      stream.destroy();
    }
  }
  return hash.digest('hex');
}
