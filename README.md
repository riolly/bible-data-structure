# bible-data-structure

A data model of the Bible (canons, versification schemes, editions, text units, original languages) and a pipeline that ingests real sources into it. It is the starting point for a range of Bible apps. Each app will get a compiled projection of this model instead of its own copy of the research.

Started 2026-11-09 from the research in [bible-codex](https://github.com/riolly/bible-codex) at commit `c2643a2`. Commands and rules are in [CLAUDE.md](CLAUDE.md), terms in [CONTEXT.md](CONTEXT.md).

## Plan

1. **Extract** the research from bible-codex. Done.
2. **Model the Bible itself.** Research each topic in [research/](research/README.md) from primary sources and fold the findings into CONTEXT.md, ADRs and the code. Versification and canons are researched and decided (ADR-0002, ADR-0006), and their code is built:
   1. Address module, `src/model/address.ts`: parses and formats `PSA 51:3/org`, `REV 13:1a/kjv`, `GEN 1:1-31/kjv` and `MAT 2:1!3/kjv`, with 1-based word numbers in strings and 0-based in storage. Done.
   2. Books keyed by USFM code and canons as rows (`book`, `canon`, `canon_section`, `canon_entry`, `canon_entry_book`, `book_name`), seeded with the USFM spec's 101 books, their English names and the protestant canon. `book.slug`, `testament`, `position` and `src/ingest/books.ts` are gone. Done.
   3. Scheme registry, `src/ingest/schemes.ts`: `kjv` plus the six Paratext schemes, with verse counts from libpalaso's `.vrs` files (MIT, copied from libpalaso commit `f1f70e9` and checked by sha256). KJV and BSB ingested under `kjv`, and ingest rejects verses a scheme lacks. Done. BSB later moved to `bsb` (step 3.3).
   4. Full `.vrs` parser and `scheme_mapping` rows to an extend-only `pivot` scheme, with a coverage check in place of the bijection check. `versification_map` and `divergent.vrs` are gone; `fixtures/real-cases.vrs` holds real lines for the ADR-0006 cases. Done.
   5. TVTMS compiled per scheme, pinned by URL and sha256 in `src/ingest/sources.ts`. TVTMS rows are stored where TVTMS decides from verse counts, `.vrs` rows elsewhere, and `build/mapping-diff.tsv` lists where they disagree. Done.

   Left open by this step, recorded in ADR-0006's amendments: the pivot home of the additions to Esther is undecided. TVTMS's text tests, also left open here, now run per edition (ADR-0006 amendment, text tests). Some libpalaso mapping lines name ESG verses missing from the same file's counts; `src/ingest/pivot.test.ts` reports them.
3. **Test against texts that disagree.** Import KJV, BSB, a Bible with deuterocanonical books, OSHB Hebrew, a Greek New Testament and, if licensable, the Septuagint. Make the trouble-spot fixtures in research/README.md pass.
   1. Licensing verdicts per source in [research/licensing.md](research/licensing.md). Every text below is public domain except SBLGNT (CC BY 4.0). Done.
   2. Each source lists the books it must have, and may carry counted text fixes. WLC (OSHB's Hebrew, from upstream since ADR-0007) and SBLGNT ingest under `org`. ADR-0004 v1.2 records that Hebrew and Greek tokenize under the v1.1 rules unchanged. Done.
   3. Derived schemes (ADR-0002 amendment): `rp` for Robinson-Pierpont 2018, `web` for the World English Bible with deuterocanon, and `brenton` for Brenton's Greek Septuagint, and `bsb` for the BSB's order of Philippians 1:16-17 (ADR-0006 amendment, text tests). Done.
   4. Trouble-spot fixtures and `src/ingest/trouble-spots.test.ts`. Every spot but the Greek additions to Daniel and Esther passes. Done.

   Left open by this step: 100 verses in chapters a derived scheme changes map nowhere, Brenton's 97 and WEB's 3. TVTMS's text tests run per edition and don't decide them (ADR-0006 amendment, text tests). There is no Catholic or Orthodox canon yet, so the deuterocanonical books have no canon order.
4. **Design app projections.** Replaced on 2026-11-10 by steps 5 to 15, after a review of the model against licensed translations. The scope they assume is in [ADR-0008](docs/adr/0008-scope-and-support-levels.md).
5. **Record the scope and the support levels.** The scope and the Full and Reading levels are in [ADR-0008](docs/adr/0008-scope-and-support-levels.md). CONTEXT.md has the terms Full edition, Reading edition, rights record and provider, and CLAUDE.md the new product principle. Done.
6. **Make a clean checkout build.** ebible rebuilt the KJV zip on 2026-11-10, so the zip hash pinned on 2026-11-09 fails and `bun run ingest:download` stops. This amends ADR-0005 rule 1 and the pin rule in CLAUDE.md, which stop the download on a zip mismatch. The new rule pins the edition stamp. A zip whose text gives the pinned stamp passes, and a changed stamp stops the download and is a new edition. Keep our own copy of every pinned source, and key the Editions table below by edition stamp. Done when the ADR and CLAUDE.md carry the new rule and a fresh clone runs `ingest:download` and `ingest` to the end.
7. **Store each chapter as a document, and derive tokens from it.** Amend ADR-0001. The stored truth is the USJ of one chapter, with its whitespace, character styles, footnotes, cross-references, stanza breaks and published verse numbers (`\va`, `\vp`). A block keeps its USFM marker and level (`pi2`, `li2`, `s2`) in place of the role vocabulary. Tokens, blocks and verse text are derived by the same tokenizer, so word addresses and both stamps stay as they are. List the supported markers in the ADR, and stop the ingest on any other. Done when fixtures pass for a footnote, a cross-reference, `\add`, `\nd`, `\sc`, `\wj`, a stanza break and an omitted verse, and the KJV and BSB words stamps are unchanged.
8. **Give a verse bridge its range.** Amend ADR-0004 rule 6. A verse unit holds a first and a last verse, every number in the range resolves to the unit, and word indexes count within the unit. NLT prints Numbers 1:20-21 as one unit. Check the rule that each unit has one number or one unbroken range, in rising order within its chapter. Done when the `\v 5-6` fixture resolves both `5` and `6`, and no stored reference exists yet.
9. **Write the app contract.** Five calls, with the reading screen as the first consumer: `chapter`, `passage`, `verseText`, `map` and `rights`. The edition supplies the scheme, so app code writes `JHN 3:16`. Human references go through `bible-passage-reference-parser`, English only. Every address returns the verse, the bridge that contains it, or "absent in this edition". Record the display rule for each mapping result (one verse, several, part of a verse, absent) in the contract. Done when the contract is a typed module with tests against KJV and BSB.
10. **Add the rights record and two providers.** A rights record per edition holds the route, offline (`none`, `cache` or `full`), refresh days, copy limit, AI use and attribution. The providers are a local pack and API.Bible. The API.Bible provider caches by chapter and refreshes within 30 days. Its adapter maps API.Bible's JSON content blocks to the step 7 chapter document and keeps the fetched response beside it, unchanged. A marker outside the supported list keeps its text as a plain run and is counted, because a fetch on a reader's device can't stop the way the ingest does. Each fetched chapter carries the hash of its response as its stamp. Licensed text is fetched with a key and never committed. Needs the API.Bible key and the answer on section 4.1 from the human steps below. Done when NASB 2020 John 3 and Psalm 119 and NLT Numbers 1, which has the 20-21 bridge, render through the step 9 contract.
11. **Put Strong's numbers and glosses on the original words.** Keep OSHB's lemma field, which holds the Strong's number and which `oshb-xml.ts` drops today. OSHB has no glosses, so choose a Hebrew gloss source keyed to WLC words (MACULA Hebrew or STEPBible TAHOT). Choose a Greek source of Strong's numbers and glosses that is keyed to the SBLGNT words we ingest. MACULA Greek ships an SBLGNT edition. TAGNT is its own text and doesn't qualify unless its words join to ours. Record each license verdict in research/licensing.md. Done when `map` plus one read returns the Hebrew or Greek words of any verse of any edition, each with a Strong's number and a gloss.
12. **Put Strong's numbers on the English words of BSB and KJV.** This is what makes an edition Full, and until it is done both are Reading editions. Inline `strong=` tags can't be trusted without a check, because WEB's are shifted (ADR-0003). Find a source of word tags for BSB (the Berean interlinear tables are the first candidate) and for KJV, record each license verdict, and test the tags against the step 11 words before storing them. Done when a word address in BSB returns its Strong's number, or research/licensing.md records that no usable source exists and ADR-0008's table lists no Full edition.
13. **Compile packs and measure.** The pack is what ships, and `corpus.db` never does. Baseline from 2026-11-10 for KJV: token rows with the current indexes are 71.3 MB (22.0 MB gzipped), and one compressed document per chapter plus one text row per verse is 9.7 MB (3.6 MB gzipped). Done when a pack builds for KJV and BSB, and its size and chapter read time are recorded here.
14. **Anchor user marks to a verse.** Amend ADR-0005. A mark's truth is the verse address plus the quote, and a word index is a hint. Word anchors exist only on Full editions. A fetched edition reconciles on the device when a refreshed chapter's stamp (step 10) changes. Done when the amendment is written. Apps build the storage.
15. **Decide what stays in the build.** The Brenton, WEB and Robinson-Pierpont tests stay while they pass. When a step above breaks one, delete it instead of fixing it.

Steps only a person can do:

- Sign up for API.Bible's Starter plan and put the key in the environment (blocks step 10).
- Ask API.Bible in writing whether converting its JSON content to our own chapter document for display counts as a change under section 4.1 of its terms (blocks step 10).
- Ask API.Bible in writing whether NASB and NLT may be stored whole on a device, and whether our server may cache chapters for our app.
- Ask the Lockman Foundation for terms on NASB files with Strong's numbers. That license moves NASB from Reading to Full.

## Carried over from bible-codex

| Old item | Here | Verdict |
|---|---|---|
| Token stream with Block overlays (old ADR-0001, 0010) | ADR-0001 | Keep |
| Single fixed KJV versification as the hub (old ADR-0001) | ADR-0002 | Replaced: addresses name their scheme |
| `book` with English slug id, `testament`, fixed `position` | `src/db/corpus-schema.ts`, `src/model/books.ts`, `src/model/canon.ts` | Replaced: USFM codes, canon as data (ADR-0002) |
| Original Word hub, morpheme grain, external ids (old ADR-0007) | ADR-0003 | Keep, not built |
| Registered tokenizer policy (old ADR-0014) | ADR-0004 | Keep. Revisit verse bridges and non-English scripts |
| Edition stamp and quote witness (old ADR-0013) | ADR-0005 | Keep |
| Headings not addressable | ADR-0001 | Revisit in structure research |
| Textual variants (not modeled) | research/README.md | New topic |
| Ingest pipeline, tokenizer, `.vrs` parser, fixtures | `src/ingest/` | Keep. The `.vrs` parser was rewritten for the full format (step 2.4), `divergent.vrs` replaced |
| Corpus schema and reader | `src/db/` | Keep. `listBooks` became `canonBooks`, which reads order and names from the canon tables |
| Interlinear sourcing (old issue #2) | research/interlinear-corpus-sourcing.md | Keep, open |
| Licensing notes (an old agent memory) | research/licensing.md | Lost, redone in step 3 |
| User data, storage and sync design (old ADR-0006, 0009, 0011) | docs/prior-art/ | Input for step 4 |
| Literary edition (old ADR-0017), hub sourcing (old ADR-0021) | docs/prior-art/ | Input for structure and sourcing research |
| Reading modes, presets, library ring, ink, typography (old ADR-0002 to 0005, 0008, 0012, 0015, 0016, 0018 to 0020) | not carried | Drop: app-specific |

## Editions

Every pin update in `src/ingest/sources.ts` is a new edition (ADR-0005). Record it here. The words stamp (ADR-0005 amendment) changes whenever stored words change, so record it after any ingest that changes one.

| Edition | Pinned zip sha256 | Edition stamp | Words stamp | Pinned on | Note |
|---|---|---|---|---|---|
| KJV | `c7ba60db…621aaf` | `sha256:7ead3d28b2b34c9b` | `sha256:13f8787f02884340` | 2026-11-09 | July pin no longer matched. No July stamp exists, so a text change can't be confirmed |
| BSB | `75ca91d5…f7fbc4` | `sha256:3b0004861fcf2481` | `sha256:f5dbe0632c8c21ad` | 2026-11-09 | Same as KJV. Scheme `bsb` since the TVTMS text tests (ADR-0006 amendment) |
| WLC | `f56c1507…177b4c7` | `sha256:b15b041bc282f9b8` | `sha256:027a6cea9c1feb67` | 2026-11-10 | Upstream openscriptures/morphhb at `3d15126`, scheme `org`, with 1,260 qere readings (ADR-0007). Replaced ebible `hboWLC` (`464225e1…bd1df7`, stamps `sha256:a548fe69e09108f4` and `sha256:496bcbfec1bf8375`), which dropped the qere and leaked markup into 10 verses |
| SBLGNT | `bcb9cfd8…3cbf56` | `sha256:33876ae1d14e3756` | `sha256:b029321cde54e6b7` | 2026-11-09 | Upstream LogosBible/SBLGNT at `d7f35ad`, scheme `org`. Replaced ebible `grcsbl` (`04c5c536…b10a73`, stamp `sha256:89a22750abd8cdbe`), whose text was damaged (research/licensing.md) |
| RP | `33b208ee…874048` | `sha256:1defb25636d232d6` | `sha256:f991602ae5d26c3f` | 2026-11-09 | ebible `grcmt`, scheme `rp` |
| WEB | `05b0440b…3589c8` | `sha256:5f722b4d8f3f4e8e` | `sha256:8fa638d577ba7d01` | 2026-11-09 | ebible `eng-web`, scheme `web` |
| Brenton | `9de434f4…86e9a4` | `sha256:3db40d92c53c8d1d` | `sha256:968ebb8e2132bf89` | 2026-11-09 | ebible `grcbrent`, scheme `brenton` |
