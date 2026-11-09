# Source + license a redistributable interlinear corpus (Phase 3)

## Risk
Phase 3 (Original Word hub + interlinear alignment + lexicon) needs a **redistributable** aligned original-language corpus. This is the open **non-schema** risk for P3 — the schema is validated, but it is empty without a source. Same discipline as the NASB lesson: licensing, not shape, is the blocker.

## What's needed
1. **Pick a corpus** — candidates: MACULA (Hebrew + Greek), STEPBible (TAGNT/TAHOT), OSHB + MorphGNT.
2. **License-check it is redistributable** in a bundled app (the reason `ow_id` is an *opaque external* id — [ADR-0007](../blob/main/docs/adr/0007-original-word-hub-is-a-morpheme-grained-externally-keyed-bridge.md) Q1 — is precisely so we can swap sources without migration).
3. **Confirm it supplies a lemma id per occurrence.** "Lemma is the spine" (occurrence stats hang off it) assumes this. If a source ships Strong's but no lemma, `original_word.lemma_id` is null at launch and stats hang off `strong_id` until a lemma source is added (additive, no migration). See the lemma sourcing caveat in [schema.dbml](../blob/main/schema.dbml).
4. **Confirm it provides alignment for the bundled reading translation(s)** (KJV/BSB), or a route to derive it — alignment is per-translation, materialized to `token_id` at ingest.

## Proven constraint (don't skip)
The reading translation's own inline `\w strong=` tags **cannot** bootstrap the hub — Phase-3 prototype Proof 2 showed WEB tags are systematically miscycled for Hebrew (e.g. `In|H8064`, the Greek article tagged `G1722`). The hub must key off a dedicated aligned corpus. ([prototype-usfm/README.md](../blob/main/prototype-usfm/README.md) Phase-3 verdict.)

## Acceptance criteria
- [ ] Corpus chosen, with a written license verdict (redistributable in a bundled app: yes/no/terms).
- [ ] Lemma-id availability confirmed; fallback recorded if absent.
- [ ] Alignment availability/derivation path for the v1 reading translation(s) confirmed.
- [ ] Findings recorded in [OVERVIEW.md §5](../blob/main/OVERVIEW.md) + ADR-0007 consequences.

## Refs
- [ADR-0007](../blob/main/docs/adr/0007-original-word-hub-is-a-morpheme-grained-externally-keyed-bridge.md), [data-architecture.md](../blob/main/data-architecture.md) §4
- memory: bible-data-sources-licensing

_Non-schema risk; surfaced during the Phase 1–3 schema review._


