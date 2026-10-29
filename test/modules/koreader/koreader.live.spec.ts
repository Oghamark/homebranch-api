import { ChildProcess, fork } from 'child_process';
import { once } from 'events';
import { join } from 'path';
import { DataSource } from 'typeorm';

const url = process.env.KOREADER_TEST_DATABASE_URL;
const fixture = process.env.KOREADER_FIXTURE_PATH;
const integration = url && fixture ? describe : describe.skip;
type Ready = {
  type: 'ready';
  url: string;
  userId: string;
  bookId: string;
  formatId: string;
  document: string;
  contentHash: string;
  schema: string;
};

function ipc<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('exit', exit);
    };
    const message = (value: unknown) => {
      if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== type) return;
      clear();
      resolve(value as T);
    };
    const exit = () => {
      clear();
      reject(new Error('Harness exited before IPC response'));
    };
    const timer = setTimeout(() => {
      clear();
      reject(new Error('Harness IPC response timed out'));
    }, 20000);
    child.on('message', message);
    child.once('exit', exit);
  });
}

integration('Live Nest/PostgreSQL fixture and private pairing approval IPC', () => {
  jest.setTimeout(30000);

  test('approves through the real JWT endpoint without transferring tokens and shuts down its isolated schema', async () => {
    const child = fork(join(__dirname, 'koreader.live-harness.ts'), [], {
      cwd: process.cwd(),
      execArgv: ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'],
      env: { ...process.env, TS_NODE_FILES: 'true', KOREADER_TEST_MAX_DURATION_MS: '20000', KOREADER_TEST_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let info: Ready | undefined;
    const diagnostics: string[] = [];
    child.stdout?.on('data', (value: Buffer) => {
      if (diagnostics.length < 10) diagnostics.push(value.toString());
    });
    child.stderr?.on('data', (value: Buffer) => {
      if (diagnostics.length < 10) diagnostics.push(value.toString());
    });
    const exited = once(child, 'exit');
    const db = await new DataSource({ type: 'postgres', url }).initialize();
    try {
      info = await ipc<Ready>(child, 'ready');
      expect(info.document).toBe('840a5c4dd0419dd389ea956f985f8b8d');
      expect(info.contentHash).toBe('1060596e6363adce9ac22c3b7781a05134ba7947353e4f3059d9c0e57d0d7204');
      expect(Object.keys(info).sort()).toEqual([
        'bookId',
        'contentHash',
        'document',
        'formatId',
        'schema',
        'type',
        'url',
        'userId',
      ]);
      const post = async (path: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') => {
        const response = await fetch(`${info!.url}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<Record<string, any>>;
      };
      const pairing = await post('/koreader/pairings', { deviceName: 'Real IPC reader' });
      const approved = ipc<{ type: 'approved'; requestId: string; state: string }>(child, 'approved');
      child.send({ type: 'approve', requestId: 'approval-1', userCode: pairing.userCode });
      expect(await approved).toEqual({ type: 'approved', requestId: 'approval-1', state: 'approved' });
      const claimed = await post('/koreader/pairings/claim', { deviceCode: pairing.deviceCode });
      const headers = { 'x-auth-user': claimed.username as string, 'x-auth-key': claimed.key as string };
      expect(
        await post(
          '/koreader/documents/resolve',
          {
            document: info.document,
            contentHash: info.contentHash,
            formatId: info.formatId,
          },
          headers,
        ),
      ).toEqual({ bookId: info.bookId, formatId: info.formatId, title: 'Native fixture' });
      const progress = {
        document: info.document,
        percentage: 0.42,
        progress: '/body/DocFragment[1]/body/p[1]/text().0',
        device: 'Real IPC reader',
        device_id: 'ipc-reader',
        mutationId: 'ipc-progress',
      };
      const accepted = await post('/koreader/syncs/progress', progress, headers, 'PUT');
      expect(await post('/koreader/syncs/progress', progress, headers, 'PUT')).toEqual(accepted);
      const native = await fetch(`${info.url}/koreader/syncs/progress/${info.document}`, { headers });
      expect(await native.json()).toMatchObject({
        progress: progress.progress,
        percentage: 0.42,
        timestamp: accepted.timestamp,
      });
      const revoked = await fetch(`${info.url}/koreader/devices/${claimed.deviceId}`, { method: 'DELETE', headers });
      expect(revoked.status).toBe(204);
      expect((await fetch(`${info.url}/koreader/users/auth`, { headers })).status).toBe(401);
      expect(diagnostics.join('')).not.toContain(claimed.key);
      child.send({ type: 'shutdown' });
      expect((await exited)[0]).toBe(0);
      expect(await db.query(`SELECT nspname FROM pg_namespace WHERE nspname=$1`, [info.schema])).toEqual([]);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
      if (info && /^koreader_live_[a-f0-9]{32}$/.test(info.schema)) {
        await db.query(`DROP SCHEMA IF EXISTS "${info.schema}" CASCADE`);
      }
      await db.destroy();
    }
  });
});
