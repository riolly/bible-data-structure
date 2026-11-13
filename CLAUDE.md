# bible-data-structure

A data model of the Bible as it actually exists (canons, versification schemes, editions, text units, original languages) plus the pipeline that ingests real sources into it. Apps are not built here. Later, apps get compiled projections of this model.

Phase: v0.0.x since 2026-11-09. Research and prototyping: no CI gates, no reviews. Care only about what is expensive to undo, listed below.

## Commands

```
CXXFLAGS='-std=gnu++20' bun install   # Node 24 (.node-version): Node 20 fails in node-gyp. The flag is for tree-sitter's native build
bun run test                          # vitest, runs under Node
bun run typecheck
bun run ingest:download               # fetch pinned ebible.org zips, upstream SBLGNT, OSHB, TVTMS, MACULA and Clear's BSB alignments, check edition stamps (mirror if upstream changed) → src/ingest/sources/
bun run ingest                        # sources → build/corpus.db, mapping-diff.tsv, pivot.json (about 20 s; 13 s when build/usj-cache has the parses. Four minutes when the CPU is throttled to 800 MHz)
bun run pack                          # build/corpus.db → build/packs/KJV.db and BSB.db (with WLC and SBLGNT), checked against the corpus DB and measured (several minutes)
bun run api-bible:chapter NASB95 JHN 3   # fetch one licensed chapter into build/api-bible/, or read the kept copy (30 days)
bun run api-bible:facts NASB95            # fetch a whole licensed edition (196 calls) and rewrite its counts in src/provider/facts/
```

API.Bible calls read `API_BIBLE_KEY` from `.env`, which git ignores (research/api-bible.md). Starter allows 5,000 calls a month, so fetch through `src/provider/api-bible-cache.ts`.

## Product principle

Model the Bible as it is, independent of any app. A model feature lands when a contract call or a fixture from a target edition needs it (ADR-0008). If a concept only exists because one app needs it, it belongs in that app's projection, not here.

## Rules that are expensive to break

- **Every verse address names its versification scheme** (ADR-0002). Never add code that assumes one shared numbering.
- **A book's id is its USFM code** (ADR-0002). Names and slugs are display data.
- **Outside references point at addresses or external `ow_id`s, never at row ids.** Row ids are rebuilt on every ingest.
- **A failing tokenizer test is an address migration, not a test to update** (ADR-0004). Don't change `src/ingest/tokenize.ts` rules without an ADR amendment.
- **A text source is pinned by its edition stamp, and changing the pin is a new edition** (ADR-0005 amendment, step 6). A rebuilt zip that gives the pinned stamp passes. A changed stamp stops `ingest:download`. Never update `edition` in `SOURCES` (`src/ingest/sources.ts`) to make the download pass without recording the new edition in README.md and uploading its zip to the mirror release. Updating the `TVTMS` pin can change mapping rows: compare `build/mapping-diff.tsv` before and after, and the pivot check must pass. It also needs `bun run api-bible:facts` for each licensed edition, or the ingest stops.
- **Licensing before bundling.** Check that a source can be redistributed before any output that leaves this machine includes it.

## Where things go

Each fact has one home. Don't restate it elsewhere, link to it.

| What | Where |
|---|---|
| Terms | `CONTEXT.md` |
| The model | the code: `src/model/` (types), `src/db/corpus-schema.ts` (tables), with comments |
| Proof | fixtures and tests in `src/**/*.test.ts` and `src/ingest/fixtures/` |
| Findings from sources | `research/<topic>.md`, with links to primary sources |
| Decisions that are hard to reverse | `docs/adr/`, short. Only when the reason isn't obvious from the code |
| Old repo material | `docs/prior-art/`, read-only |

Workflow for a model change: research file, then the ADR or CONTEXT.md edit, then a failing fixture, then the code.

Code comments that cite "old-repo ADR-00xx" refer to github.com/riolly/bible-codex at commit `c2643a2`.
