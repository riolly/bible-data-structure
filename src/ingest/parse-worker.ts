/**
 * Worker thread for parse-pool.ts: runs usfmToUsj and returns the outcome as
 * JSON text, so a fresh parse and a cache hit reach the caller the same way.
 */

import { parentPort } from 'node:worker_threads';

import { usfmToUsj, type ParseOptions } from './parse';

export interface ParseRequest {
  id: number;
  usfm: string;
  opts: ParseOptions;
}

export type ParseReply = { id: number; json: string } | { id: number; error: string };

parentPort!.on('message', ({ id, usfm, opts }: ParseRequest) => {
  let reply: ParseReply;
  try {
    reply = { id, json: JSON.stringify(usfmToUsj(usfm, opts)) };
  } catch (e) {
    reply = { id, error: e instanceof Error ? e.message : String(e) };
  }
  parentPort!.postMessage(reply);
});
