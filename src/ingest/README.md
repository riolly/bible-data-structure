# Corpus ingest (ADR-0001)

Build-time Node pipeline: USFM → USJ (usfm-grammar) → one stored document
per chapter → derived blocks, tokens and verse text → a read-only corpus
SQLite file. The chapter documents are the stored truth (ADR-0001 amendment,
plan step 7). Consumers read normalized rows through the Drizzle
schema in `src/db/corpus-schema.ts`, shared by the writer here and the reader in
`src/db/corpus-read.ts`.

The commands are in [CLAUDE.md](../../CLAUDE.md). Each file's header comment says what it does.

The ingest stops if the pivot lost anything compared with `fixtures/pivot.json`
(ADR-0006). When it only grew, copy `build/pivot.json` over the fixture to
accept the growth. `build/mapping-diff.tsv` lists the verses where TVTMS and
the `.vrs` files disagree.

## Golden fixtures

`fixtures/adversarial.usfm` and `fixtures/chapter-doc.usfm`, each with its
committed USJ. Pure-TS suites
(`tokenize.test.ts`, `normalize.test.ts`) always run. `parse.test.ts`
(USFM→USJ drift guard) and `roundtrip.test.ts` (write seam ↔ read seam)
skip where the native tree-sitter / better-sqlite3 bindings are unbuilt, and
the corpus tests skip until `bun run ingest` has run. There is no CI.

After editing a fixture's USFM, regenerate its committed USJ (shown for
`adversarial`):

```
node -e "const{readFileSync,writeFileSync}=require('node:fs');const{USFMParser}=require('usfm-grammar');writeFileSync('src/ingest/fixtures/adversarial.usj.json',JSON.stringify(new USFMParser(readFileSync('src/ingest/fixtures/adversarial.usfm','utf8')).toUSJ(),null,2)+'\n')"
```

## Native build note

Use Node 24, as `.node-version` says. Node 20 fails `bun install` inside
node-gyp with an error that doesn't name the version.

usfm-grammar needs `tree-sitter` / `tree-sitter-usfm3` (node-gyp). On Node 24
the tree-sitter 0.25 build fails against the C++20 `cppgc` headers; build it
with:

```
cd node_modules/tree-sitter        && CXXFLAGS='-std=gnu++20' npx node-gyp rebuild
cd node_modules/tree-sitter-usfm3  && CXXFLAGS='-std=gnu++20' npx node-gyp rebuild
```

`CXXFLAGS='-std=gnu++20' bun install` builds both in one step. better-sqlite3 builds cleanly.
