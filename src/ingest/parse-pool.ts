/**
 * Parses USFM files in worker threads and caches each outcome on disk. The
 * parse is most of an ingest's time; normalizing and writing stay on the main
 * thread, in book order, so the log and the row ids do not depend on which
 * worker finishes first.
 *
 * The cache key is a sha256 over the parse options, the USFM text after text
 * fixes, parse.ts itself and the installed versions of usfm-grammar,
 * tree-sitter and tree-sitter-usfm3. Changing any of them misses the cache.
 * A parse that throws is not cached. Delete the cache directory to force
 * fresh parses.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ParseOptions } from './parse';
import type { ParseReply, ParseRequest } from './parse-worker';

export interface ParsePool {
  /**
   * The outcome as JSON text. Callers parse it when they use it: a whole
   * edition of USJ objects held at once took gigabytes.
   */
  parse(usfm: string, opts: ParseOptions): Promise<string>;
  /** Cache hits and fresh parses so far. */
  readonly counts: { hits: number; parsed: number };
  close(): Promise<void>;
}

/**
 * One worker per physical core, assuming two hardware threads per core. A
 * worker holds up to about 600 MB while it parses a large book. On a 6-core,
 * 12-thread machine, 11 workers parsed WEB 15% faster than 5 but needed
 * 6.5 GB instead of 3.6 GB.
 */
const DEFAULT_THREADS = Math.max(1, Math.floor(availableParallelism() / 2));

export function createParsePool(cacheDir: string, threads = DEFAULT_THREADS): ParsePool {
  mkdirSync(cacheDir, { recursive: true });
  const salt = cacheSalt();
  const counts = { hits: 0, parsed: 0 };
  const queue: { req: ParseRequest; done: (r: ParseReply) => void }[] = [];
  const pending = new Map<number, (r: ParseReply) => void>();
  // One request per worker at a time. Two per worker made a cold ingest
  // slower (4:15 against 3:57): a worker could hold two large books while
  // others sat idle.
  const slots: Worker[] = [];
  const workers: Worker[] = [];
  let nextId = 0;
  let failure: string | null = null;
  let closing = false;

  const dispatch = () => {
    while (slots.length > 0 && queue.length > 0) {
      const { req, done } = queue.shift()!;
      pending.set(req.id, done);
      slots.pop()!.postMessage(req);
    }
  };
  // A worker that dies leaves its requests unanswered: fail every waiting parse.
  const fail = (why: string) => {
    failure ??= `a parse worker stopped: ${why}`;
    for (const done of [...pending.values(), ...queue.map((q) => q.done)]) done({ id: -1, error: failure });
    pending.clear();
    queue.length = 0;
  };
  const start = () => {
    const w = new Worker(new URL('./parse-worker.ts', import.meta.url));
    w.on('message', (r: ParseReply) => {
      const done = pending.get(r.id)!;
      pending.delete(r.id);
      slots.push(w);
      dispatch();
      done(r);
    });
    w.on('error', (e) => fail(e.message));
    w.on('exit', (code) => {
      if (!closing) fail(`exit code ${code}`);
    });
    workers.push(w);
    slots.push(w);
  };

  const parseFresh = (usfm: string, opts: ParseOptions) =>
    new Promise<ParseReply>((done) => {
      if (failure) return done({ id: -1, error: failure });
      if (workers.length < threads && slots.length === 0) start();
      queue.push({ req: { id: nextId++, usfm, opts }, done });
      dispatch();
    });

  return {
    counts,
    async parse(usfm, opts) {
      const key = createHash('sha256').update(salt).update(JSON.stringify(opts)).update('\0').update(usfm).digest('hex');
      const path = join(cacheDir, `${key}.json`);
      if (existsSync(path)) {
        counts.hits++;
        return readFileSync(path, 'utf8');
      }
      const reply = await parseFresh(usfm, opts);
      if ('error' in reply) throw new Error(reply.error);
      counts.parsed++;
      writeFileSync(`${path}.tmp`, reply.json);
      renameSync(`${path}.tmp`, path);
      return reply.json;
    },
    async close() {
      closing = true;
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

/** What a cached outcome depends on besides the input: the parse code and the parser versions. */
function cacheSalt(): string {
  const fromGrammar = createRequire(createRequire(import.meta.url).resolve('usfm-grammar'));
  const version = (pkg: string) =>
    (JSON.parse(readFileSync(fromGrammar.resolve(`${pkg}/package.json`), 'utf8')) as { version: string }).version;
  const parseSource = readFileSync(join(import.meta.dirname, 'parse.ts'), 'utf8');
  return JSON.stringify([
    version('usfm-grammar'),
    version('tree-sitter'),
    version('tree-sitter-usfm3'),
    createHash('sha256').update(parseSource).digest('hex'),
  ]);
}
