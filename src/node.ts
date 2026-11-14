/**
 * The Node-only part of the app entry: what an app's server needs beside
 * `src/index.ts` to read licensed editions (README, "Use from an app"). It
 * reads and writes files, so a browser or React Native bundle must not import it.
 */

export { ApiBibleHttpError, chapterFetcher, type CacheOptions } from './provider/api-bible-cache';
