# bible-data-structure

A data model of the Bible as it actually exists (canons, versification schemes, editions, text units, original languages) plus the pipeline that ingests real sources into it. Apps are not built here. Later, apps get compiled projections of this model.

Phase: v0.0.x since 2026-11-09. Research and prototyping: no CI gates, no reviews. Care only about what is expensive to undo, listed below.

## Commands

```
CXXFLAGS='-std=gnu++20' bun install   # the flag is needed for tree-sitter's native build on Node 24
bun run test                          # vitest, runs under Node
bun run typecheck
bun run ingest:download               # fetch pinned ebible.org zips, upstream SBLGNT, OSHB and TVTMS, verify sha256 → src/ingest/sources/
bun run ingest                        # sources → build/corpus.db, mapping-diff.tsv, pivot.json (4 min; 2 min when build/usj-cache has the parses)
```

## Product principle

Model the Bible as it is, independent of any app. A model feature lands when a contract call or a fixture from a target edition needs it (ADR-0008). If a concept only exists because one app needs it, it belongs in that app's projection, not here.

## Rules that are expensive to break

- **Every verse address names its versification scheme** (ADR-0002). Never add code that assumes one shared numbering.
- **A book's id is its USFM code** (ADR-0002). Names and slugs are display data.
- **Outside references point at addresses or external `ow_id`s, never at row ids.** Row ids are rebuilt on every ingest.
- **A failing tokenizer test is an address migration, not a test to update** (ADR-0004). Don't change `src/ingest/tokenize.ts` rules without an ADR amendment.
- **Updating a text pin in `SOURCES` (`src/ingest/sources.ts`) is a new edition** (ADR-0005). Record the new edition stamp in README.md. Updating the `TVTMS` pin can change mapping rows: compare `build/mapping-diff.tsv` before and after, and the pivot check must pass.
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
