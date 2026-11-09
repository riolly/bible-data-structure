# Research

One file per topic, written from primary sources with links. A finding that changes the model becomes an ADR or a CONTEXT.md edit. A finding that a test can check becomes a fixture.

## Topics

| Topic | File | Status | Questions to answer |
|---|---|---|---|
| Canons and book identity | `canons.md` | done 2026-11-09 | Book lists and orders per tradition. Is the USFM code list complete for Ethiopian books? Books that differ between traditions (Esther, Daniel, Psalm 151). |
| Versification schemes | `versification.md` | done 2026-11-09 | Which schemes exist. How TVTMS and SWORD map between them, and their licenses. Splits, merges and absent verses. The address syntax. |
| Editions and revisions | `editions.md` | not started | How publishers revise texts (BSB revision notes, ebible.org republishing). How to tell a text change from repackaging. |
| Textual variants | `variants.md` | not started | The 2026-11-09 BSB ingest has no text for Matthew 17:21, 18:11, 23:14, Mark 7:16, 9:44, 9:46, 11:26, 15:28, Luke 17:36, 23:17, John 5:4, Acts 8:37, 15:34, 24:7, 28:29 and Romans 16:24 (see `bun run ingest` warnings). Also Mark 16:9-20, John 7:53-8:11, Romans 16:25-27. How critical texts and translations mark them. Present, absent, bracketed or moved. |
| Original-language texts and alignment | `interlinear-corpus-sourcing.md` | carried (old issue #2) | MACULA, STEPBible TAHOT/TAGNT, OSHB, MorphGNT, Robinson-Pierpont. Lemma id per occurrence? Alignment to KJV and BSB? Licenses. |
| Lexicons and morphology | `lexicons.md` | not started | Strong's, BDB, Thayer, Louw-Nida. Morphology code systems per source. Licenses. |
| Structure | `structure.md` | not started | Paragraphing and section headings across editions. Pericope systems. Literary units that cross chapters. |
| Notes and cross-references | `apparatus.md` | not started | USFM footnotes (`\f`), cross-references (`\x`), the Treasury of Scripture Knowledge, OpenBible.info. |
| Tokenization beyond English | `tokenization.md` | not started | Rules for Greek, Hebrew and other scripts. Verse bridges (ADR-0004 open item). |
| Licensing | `licensing.md` | not started | Per source, whether it can be redistributed in an app. The old repo's licensing notes were lost and need redoing. |

## Trouble-spot fixtures

The model is done when these import and round-trip with no special cases:

- Psalm titles (Masoretic counts the title as verse 1)
- Joel 2/3 and Malachi 3/4 (chapter boundaries differ)
- Revelation 12:18 and 3 John 14-15 (verse boundaries differ)
- Romans 16:25-27 (placed at different points in different texts)
- Mark 16:9-20, John 7:53-8:11, Acts 8:37 (present, absent or bracketed)
- One deuterocanonical chapter under a second scheme (ADR-0002 migration check)
- The Greek additions to Daniel and Esther (later, with the traditions that include them)

Already covered by the carried fixtures: tokenizer edge cases (`src/ingest/fixtures/adversarial.usfm`) and real `.vrs` mapping lines for the ADR-0006 cases (`src/ingest/fixtures/real-cases.vrs`).
