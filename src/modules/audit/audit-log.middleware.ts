import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AuditLogRecord, AuditLogService } from './audit-log.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READ_ONLY_POSTS = new Set([
  '/books/audiobook/preview',
  '/books/audiobook/preview-from-upload',
  '/koreader/documents/resolve',
]);

type AuditRequest = Request & { syncActor?: { id: string; email?: string } };

export function buildAuditRecord(
  request: Pick<AuditRequest, 'route' | 'method' | 'params' | 'headers' | 'user' | 'syncActor'>,
  statusCode: number,
  failedResult = false,
): AuditLogRecord | undefined {
  const matchedRoute: unknown = request.route;
  if (!matchedRoute || typeof matchedRoute !== 'object' || !('path' in matchedRoute)) return;
  const route = matchedRoute.path;
  if (typeof route !== 'string') return;
  const method = request.method;
  const download = method === 'GET' && route === '/books/:id/download' && !request.headers.range;
  if (!MUTATIONS.has(method) && !download) return;
  if (method === 'POST' && READ_ONLY_POSTS.has(route)) return;
  // Chunk transfers are transport details; audit the final book action instead.
  if (route === '/upload-sessions' || route.startsWith('/upload-sessions/')) return;
  if (method === 'PUT' && (route.includes('/saved-positions/') || route === '/koreader/syncs/progress')) return;

  const actor = request.user ?? request.syncActor;
  const actorId = actor?.id && UUID_PATTERN.test(actor.id) ? actor.id : null;
  const resourceIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.params)) {
    if (/^(id|[a-zA-Z]+Id)$/.test(key) && typeof value === 'string' && UUID_PATTERN.test(value)) {
      resourceIds[key] = value;
    }
  }
  return {
    actorId,
    actorLabel: actorId && actor?.email ? actor.email.slice(0, 320) : null,
    method,
    route,
    resourceIds,
    statusCode,
    outcome: statusCode >= 400 || failedResult ? 'failure' : 'success',
  };
}

@Injectable()
export class AuditLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditLogMiddleware.name);

  constructor(private readonly logs: AuditLogService) {}

  use(request: AuditRequest, response: Response, next: NextFunction) {
    let failedResult = false;
    const json = response.json;
    response.json = (body: unknown) => {
      failedResult ||= typeof body === 'object' && body !== null && 'success' in body && body.success === false;
      return json.call(response, body) as Response;
    };
    response.once('finish', () => {
      const entry = buildAuditRecord(request, response.statusCode, failedResult);
      if (!entry) return;
      // Finish observes guard failures and the final authenticated actor without buffering responses.
      void this.logs.record(entry).catch(() => this.logger.error('Failed to persist an audit log entry'));
    });
    next();
  }
}
