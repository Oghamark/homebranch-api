import { annotationInput, documentId, fraction, uuid } from 'src/modules/koreader/koreader-validation';
import { verifySecret, verifier } from 'src/modules/koreader/koreader-auth.service';

describe('KOReader bounded transport validation', () => {
  const input = {
    mutationId: 'op-1',
    quote: 'Repeated quote',
    note: '',
    color: 'yellow',
    anchor: {
      version: 1,
      exact: 'Repeated quote',
      native: { pos0: '/body/p[1]', pos1: '/body/p[2]', domVersion: 20230509 },
    },
  };

  test('persists unresolved exact selectors without inventing href or claiming rendering success', () => {
    expect(annotationInput(input)).toEqual({ ...input, deleted: false });
  });

  test.each([NaN, Infinity, -0.01, 1.01, '0.5', null])('rejects invalid fraction %s', (value) => {
    expect(() => fraction(value)).toThrow();
  });

  test.each([
    { ...input, anchor: { version: 2, exact: 'quote' } },
    { ...input, anchor: { version: 1, exact: '' } },
    { ...input, anchor: { version: 1, exact: 'quote', href: 'https://outside.test/book' } },
    { ...input, anchor: { version: 1, exact: 'quote', native: { pos0: '/p' } } },
    { ...input, note: 'x'.repeat(32769) },
    { ...input, quote: [] },
    { ...input, deleted: 'true' },
    { ...input, mutationId: 'unsafe/id' },
  ])('rejects malformed annotation %#', (value) => {
    expect(() => annotationInput(value)).toThrow();
  });

  test('requires binary document identity and valid account identifiers', () => {
    expect(() => documentId('book.epub')).toThrow();
    expect(documentId('A'.repeat(32))).toBe('a'.repeat(32));
    expect(() => uuid('not-a-uuid')).toThrow();
  });

  test('uses a non-recoverable SHA-256 verifier and fixed-size comparison', () => {
    const key = 'high-entropy-random-device-key';
    expect(verifier(key)).not.toContain(key);
    expect(verifySecret(key, verifier(key))).toBe(true);
    expect(verifySecret('wrong', verifier(key))).toBe(false);
    expect(verifySecret(key, 'invalid stored hash')).toBe(false);
  });
});
