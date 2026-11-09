# Corpus ingest (ADR-0001)

Build-time Node pipeline: USFM → USJ (usfm-grammar) → normalize → a
read-only corpus SQLite file. Consumers read normalized rows through the Drizzle
schema in `src/db/corpus-schema.ts`, shared by the writer here and the reader in
`src/db/corpus-read.ts`.

```
bun run ingest:download   # once: fetch pinned ebible.org zips and TVTMS, verify sha256 → sources/ (gitignored)
bun run ingest            # sources → build/corpus.db, build/mapping-diff.tsv, build/pivot.json (gitignored)
```

The ingest stops if the pivot lost anything compared with `fixtures/pivot.json`
(ADR-0006). When it only grew, copy `build/pivot.json` over the fixture to
accept the growth. `build/mapping-diff.tsv` lists the verses where TVTMS and
the `.vrs` files disagree.

## Layout

- `tokenize.ts` — **the registered tokenization policy (ADR-0004).** Part of
  the locked anchor seam; a change here is an anchor migration.
- `normalize.ts` — USJ → `Token[]`/`Block[]` (the canonical model types) +
  stats bag of everything Phase 1 deliberately drops. Unknown structure throws.
- `parse.ts` — usfm-grammar wrapper (strict first, lenient with logged errors;
  versified-`\d` grammar-gap preprocess).
- Books, canons and English names live in `src/model/books.ts` and `src/model/canon.ts`; `write-db.ts` seeds them.
- `schemes.ts` — the scheme registry: `kjv` plus six Paratext schemes from
  `vrs/libpalaso/` (MIT, pinned by commit and sha256).
- `vrs.ts` — the Paratext `.vrs` parser (counts, excluded verses, segments,
  mappings, `#!` lines), read the way libpalaso reads them.
- `pivot.ts` — the extend-only pivot (`fixtures/pivot.json` is the previous
  build) and the `.vrs` mappings compiled to pivot rows (ADR-0006).
- `tvtms.ts` — STEPBible TVTMS compiled per scheme by evaluating its count
  tests, merged with the `.vrs` rows and diffed against them. The raw file is
  downloaded, never committed.
- `edition.ts` — deterministic `translation.edition` stamp (ADR-0005): sha256
  over the source text, immune to zip repackaging.
- `sources.ts` / `download.ts` — pinned upstream zips + checksums. A checksum
  mismatch means upstream revised the text: updating the pin is a NEW edition.
- `write-db.ts` / `run.ts` — Drizzle(better-sqlite3) writer + CLI with
  invariant validation and verse-coverage warnings.

## Golden fixtures

`fixtures/adversarial.usfm` + its committed USJ. Pure-TS suites
(`tokenize.test.ts`, `normalize.test.ts`) always run — including in CI, which
installs with `ignore-scripts` and has no native modules. `parse.test.ts`
(USFM→USJ drift guard) and `roundtrip.test.ts` (write seam ↔ read seam)
self-skip where the native tree-sitter / better-sqlite3 bindings are unbuilt.

After editing the fixture USFM, regenerate the committed USJ:

```
node -e "const{readFileSync,writeFileSync}=require('node:fs');const{USFMParser}=require('usfm-grammar');writeFileSync('src/ingest/fixtures/adversarial.usj.json',JSON.stringify(new USFMParser(readFileSync('src/ingest/fixtures/adversarial.usfm','utf8')).toUSJ(),null,2)+'\n')"
```

## Native build note

usfm-grammar needs `tree-sitter` / `tree-sitter-usfm3` (node-gyp). On Node 24
the tree-sitter 0.25 build fails against the C++20 `cppgc` headers; build it
with:

```
cd node_modules/tree-sitter        && CXXFLAGS='-std=gnu++20' npx node-gyp rebuild
cd node_modules/tree-sitter-usfm3  && CXXFLAGS='-std=gnu++20' npx node-gyp rebuild
```

`CXXFLAGS='-std=gnu++20' bun install` builds both in one step. better-sqlite3 builds cleanly.
