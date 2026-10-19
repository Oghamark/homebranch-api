import { strict as assert } from 'assert';
import { spawn, spawnSync } from 'child_process';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'crypto';
import { once } from 'events';
import { request as httpRequest } from 'http';
import { createServer } from 'https';
import { appendFile, readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import * as AdmZip from 'adm-zip';
import { startKoreaderHarness } from './koreader.live-harness';

export async function runNativeAcceptance() {
  const runtime = process.env.KOREADER_TEST_RUNTIME_DIR;
  const driver = process.env.KOREADER_TEST_NATIVE_DRIVER;
  const fixture = process.env.KOREADER_FIXTURE_PATH;
  if (!runtime || !driver || !fixture) throw new Error('Set native runtime, driver and fixture environment variables');
  const root = process.env.KOREADER_TEST_WORKSPACE_ROOT ?? join(process.cwd(), '..');
  const originalCwd = process.cwd();
  const jwtSecret = randomBytes(32).toString('hex');
  process.env.KOREADER_TEST_JWT_SECRET = jwtSecret;
  delete process.env.KOREADER_TEST_TLS_KEY;
  delete process.env.KOREADER_TEST_TLS_CERT;
  const harness = await startKoreaderHarness();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  let caOriginal: Buffer | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let proxy: ReturnType<typeof createServer> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let exit: Promise<unknown[]> | undefined;
  const cache = `${fixture}.live.cache`;
  const existedCache = await stat(cache).then(
    () => true,
    () => false,
  );
  const events: string[] = [];
  try {
    // OpenSSL cannot reopen Node's socket-backed stdin; cat supplies an anonymous OS pipe.
    const certificate = spawnSync(
      'bash',
      [
        '-c',
        'set -o pipefail; cat | openssl req -new -x509 -sha256 -key /dev/stdin -subj /CN=localhost -days 1 -addext subjectAltName=DNS:localhost -outform PEM',
      ],
      { input: key, timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(certificate.status, 0, 'In-memory TLS certificate generation failed');
    process.chdir(runtime);
    const caPath = 'data/ca-bundle.crt';
    const target = await realpath(caPath);
    assert(!relative(runtime, target).startsWith('..'), 'Refusing to change a CA file outside the isolated runtime');
    caOriginal = await readFile(caPath);
    await appendFile(caPath, Buffer.concat([Buffer.from('\n'), certificate.stdout]));
    const backend = new URL(harness.info.url);
    proxy = createServer({ key, cert: certificate.stdout }, (incoming, outgoing) => {
      const upstream = httpRequest(
        new URL(incoming.url ?? '/', backend),
        {
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    });
    proxy.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve, reject) => {
      proxy!.once('error', reject);
      proxy!.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    assert(address && typeof address !== 'string');
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signing = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: harness.info.userId,
      roles: [],
      exp: Math.floor(Date.now() / 1000) + 600,
    })}`;
    const token = `${signing}.${createHmac('sha256', jwtSecret).update(signing).digest('base64url')}`;
    async function browser<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
      const response = await fetch(`${harness.info.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
      assert(response.ok, `Browser endpoint failed with status ${response.status}`);
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
    const prefix = `/koreader/books/${harness.info.bookId}`;
    async function annotation(id: string) {
      const page = await browser<{ items: Record<string, any>[] }>(`${prefix}/annotations?after=0`);
      const found = page.items.find((item) => item.id === id);
      assert(found, 'Expected private annotation was absent');
      return found;
    }
    async function writeAnnotation(id: string, row: Record<string, any>, changes: Record<string, unknown>) {
      return browser(`${prefix}/annotations/${id}`, 'PUT', {
        mutationId: randomUUID(),
        quote: row.quote,
        note: row.note,
        color: row.color,
        anchor: row.anchor,
        deleted: row.deleted ?? false,
        ...changes,
      });
    }
    let done = false;
    async function handle(message: Record<string, any>) {
      const event = message.event as string;
      events.push(event);
      let reply: Record<string, unknown> = { ok: true };
      switch (event) {
        case 'pairing':
          await harness.approve(message.userCode as string);
          break;
        case 'linked': {
          assert.equal(message.bookId, harness.info.bookId);
          assert.equal(message.formatId, harness.info.formatId);
          const id = randomUUID();
          const quote = 'A unique cross-reader highlight belongs here.';
          await writeAnnotation(
            id,
            { quote, note: 'Browser created', color: '#90ee90', anchor: { version: 1, exact: quote } },
            {},
          );
          reply = { ok: true, annotationId: id };
          break;
        }
        case 'native-edited': {
          const row = await annotation(message.annotationId as string);
          assert.equal(row.note, 'Native edited');
          assert.equal(row.revision, message.revision);
          assert(row.anchor.native?.pos0 && row.anchor.native?.pos1);
          break;
        }
        case 'native-deleted':
          assert.equal((await annotation(message.annotationId as string)).deleted, true);
          break;
        case 'native-created': {
          const row = await annotation(message.annotationId as string);
          assert.equal(row.note, 'Native created');
          assert(row.anchor.native?.pos0 && row.anchor.native?.pos1);
          await writeAnnotation(message.annotationId as string, row, { note: 'Browser edited' });
          break;
        }
        case 'browser-delete': {
          const row = await annotation(message.annotationId as string);
          await writeAnnotation(message.annotationId as string, row, { deleted: true });
          break;
        }
        case 'native-progress': {
          const progress = await browser<Record<string, any>>(`${prefix}/progress`);
          assert.equal(progress.source, 'koreader');
          assert.equal(progress.percentage, 0.27);
          assert(progress.nativeProgress);
          const zip = new AdmZip(await readFile(fixture!));
          const href = zip.getEntries().find((entry) => entry.entryName.endsWith('.xhtml'))?.entryName;
          assert(href, 'Fixture lacks an EPUB content resource');
          await browser(`/users/${harness.info.userId}/saved-positions/${harness.info.bookId}`, 'PUT', {
            position: JSON.stringify({ href, locations: { progression: 0.71, totalProgression: 0.71 } }),
            deviceName: 'Browser acceptance',
            percentage: 0.71,
          });
          break;
        }
        case 'revoke':
          await browser(`/koreader/devices/${message.deviceId}`, 'DELETE');
          break;
        case 'done':
          done = true;
          break;
        default:
          throw new Error('Unexpected native control event');
      }
      child!.stdin!.write(`${JSON.stringify(reply)}\n`);
    }
    child = spawn(
      './luajit',
      ['-e', 'require("setupkoenv"); G_reader_settings=require("luasettings"):wrap({})', driver, root, fixture],
      {
        cwd: runtime,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
          SDL_VIDEODRIVER: 'dummy',
          HOMEBRANCH_NATIVE_API: `https://localhost:${address.port}/koreader`,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    exit = once(child, 'exit');
    let buffered = '';
    let failure: Error | undefined;
    let assertionLine: string | undefined;
    let queue = Promise.resolve();
    child.stdout!.on('data', (bytes: Buffer) => {
      buffered += bytes.toString();
      let end: number;
      while ((end = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        if (!line.startsWith('HOMEBRANCH_NATIVE ')) continue;
        queue = queue
          .then(() => handle(JSON.parse(line.slice('HOMEBRANCH_NATIVE '.length)) as Record<string, any>))
          .catch((error: Error) => {
            failure = error;
            child!.kill('SIGTERM');
          });
      }
    });
    child.stderr!.on('data', (bytes: Buffer) => {
      assertionLine = /live-api\.lua:(\d+):/.exec(bytes.toString())?.[1] ?? assertionLine;
    });
    timer = setTimeout(() => {
      failure = new Error('Native acceptance deadline exceeded');
      child!.kill('SIGTERM');
    }, 120000);
    const [code] = await exit;
    await queue;
    if (failure) throw failure;
    assert.equal(
      code,
      0,
      `Native driver failed after ${events.at(-1) ?? 'startup'}, assertion line ${assertionLine ?? 'unknown'}`,
    );
    assert(done, 'Native driver did not finish its assertions');
    return { assertions: events, document: harness.info.document, contentHash: harness.info.contentHash };
  } finally {
    try {
      if (timer) clearTimeout(timer);
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await exit;
      }
      if (proxy) await new Promise<void>((resolve) => proxy!.close(() => resolve()));
      if (caOriginal) {
        await writeFile('data/ca-bundle.crt', caOriginal);
        assert((await readFile('data/ca-bundle.crt')).equals(caOriginal), 'CA bundle restoration failed');
      }
    } finally {
      process.chdir(originalCwd);
      try {
        if (!existedCache) await rm(cache, { recursive: true, force: true });
      } finally {
        key.fill(0);
        await harness.cleanup();
      }
    }
  }
}

if (require.main === module) {
  void runNativeAcceptance().then(
    ({ assertions }) => console.log(`Real native HTTPS/API acceptance passed: ${assertions.join(', ')}`),
    (error: Error) => {
      console.error(`Native acceptance failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
