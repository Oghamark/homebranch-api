import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { QuoteAnchor } from './koreader.entity';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Expected object');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) {
    throw new BadRequestException('Invalid text field');
  }
  return value;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value)) throw new BadRequestException('Invalid identifier');
  return value.toLowerCase();
}

export function identifier(value: unknown): string {
  const id = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new BadRequestException('Invalid identifier');
  return id;
}

export function documentId(value: unknown): string {
  const document = text(value, 32);
  if (!/^[a-f0-9]{32}$/i.test(document)) throw new BadRequestException('Use binary partial-MD5 document identity');
  return document.toLowerCase();
}

export function fraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequestException('Percentage must be a finite fraction between 0 and 1');
  }
  return value;
}

export function annotationInput(value: unknown) {
  const input = object(value);
  const raw = object(input.anchor);
  if (raw.version !== 1) throw new BadRequestException('Unsupported anchor version');
  const anchor: QuoteAnchor = { version: 1, exact: text(raw.exact, 32768) };
  if (raw.href !== undefined) {
    anchor.href = text(raw.href, 2048);
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(anchor.href) ||
      anchor.href.startsWith('//') ||
      /(^|\/)\.\.(\/|$)/.test(anchor.href)
    ) {
      throw new BadRequestException('Anchor href must be an EPUB resource path');
    }
  }
  for (const key of ['prefix', 'suffix'] as const) {
    if (raw[key] !== undefined) anchor[key] = text(raw[key], 2048, true);
  }
  if (raw.native !== undefined) {
    const native = object(raw.native);
    anchor.native = { pos0: text(native.pos0, 8192), pos1: text(native.pos1, 8192) };
    if (native.domVersion !== undefined) {
      if (!Number.isSafeInteger(native.domVersion) || (native.domVersion as number) < 0) {
        throw new BadRequestException('Invalid DOM version');
      }
      anchor.native.domVersion = native.domVersion as number;
    }
  }
  if (input.deleted !== undefined && typeof input.deleted !== 'boolean')
    throw new BadRequestException('Invalid deletion');
  return {
    mutationId: identifier(input.mutationId),
    quote: text(input.quote, 32768, true),
    note: text(input.note, 32768, true),
    color: text(input.color, 64),
    anchor,
    deleted: input.deleted === true,
  };
}
