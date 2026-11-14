# The first apps' scope, and two support levels for an edition

Status: accepted 2026-11-10 with the owner, after a review of the model against licensed translations. Moved here from the README plan (step 5).

The first apps are our own, free, published by a registered organization, for English readers. AI features may come later. Every cut below can be undone, because addresses name their scheme (ADR-0002). A model feature lands when a contract call or a fixture from a target edition needs it. The target editions are the English editions in the Examples row below, plus the hub texts WLC and SBLGNT.

## In scope

1. The 66-book Protestant canon with English numbering.
2. Scripture text only, with a fixed list of USFM markers.
3. One Hebrew text (WLC) and one Greek text (SBLGNT) as the original-word hub (ADR-0003).
4. English text and English reference parsing.
5. One house set of cross-references and one outline, keyed to the pivot (ADR-0006).
6. Editions we hold as files never change in place. A revision is a new edition (ADR-0005). A fetched edition changes when its provider refreshes it, so each fetched chapter carries its own stamp.

## Out of scope for now

The Septuagint, the Vulgate, deuterocanonical books, Catholic and Orthodox canons, manuscript variants, study notes, book introductions, other languages, and guessing which translation word matches which original word.

The Brenton, WEB and Robinson-Pierpont ingests predate this cut. They stay while their tests pass (README plan, step 15).

## Support levels

The level is computed from the ingest checks and the edition's rights record, never set by hand.

| | Full | Reading |
|---|---|---|
| Requirement | We hold the files, they pass the checks, and each word that translates an original word has a Strong's number. Supplied words (`\add`) and words the tag source marks as having no counterpart need none | It passes the numbering and markup checks |
| Reading with formatting and footnotes | Yes | Yes |
| Verse highlight, note, bookmark, compare, cross-references | Yes | Yes |
| The verse's Hebrew or Greek words with Strong's numbers | Yes | Yes |
| Tap one English word to reach its original word, part-verse marks | Yes | No |
| Whole Bible offline, search on the device | Yes | Cached chapters, unless the license grants more |
| Examples | BSB and KJV, once their words have Strong's numbers | NASB, NLT, NIV, CSB, NKJV, ESV. Also BSB and KJV until then |

A Reading edition reaches the original-language verse through the pivot, one verse at a time. Closed-license routes and terms are in [research/licensing.md](../../research/licensing.md).

## Considered options

- **One support level.** Rejected. Licensed translations come without Strong's numbers on their words, so either they are excluded or every edition loses word taps.
- **Model every canon and language first.** Rejected. It delays the first app for data no first app reads, and none of it is expensive to add later.

## Amendment: questions the scope closes (2026-11-14)

Several questions were recorded as open before this ADR cut the scope. Each one only matters for text that is out of scope, so none is open work. A question comes back when its trigger happens, and not before. Nothing below blocks a target edition.

| Question | Where it was recorded | Trigger that reopens it |
|---|---|---|
| The pivot home of the Greek additions to Esther, of Baruch 6 or `LJE`, and of Daniel 3:24-90 or `S3Y`. Also the three Esther layouts, Daniel 13-14 or `SUS` and `BEL`, and Psalm 151 in `PSA` or `PS2` | ADR-0006, research/canons.md | A target edition prints a deuterocanonical book |
| 100 verses of the derived schemes `brenton` (97) and `web` (3) map nowhere: 2 Esdras 14 and 19, Proverbs 24:35-62 and Sirach 30 in Brenton, Baruch 1:22 and 4 Maccabees 7:24-25 in WEB | README plan step 3, `src/ingest/tvtms.test.ts` (`KNOWN_DERIVED`) | The Septuagint or a deuterocanonical book comes into scope |
| The lettered parts of Brenton's `ESG 1:1`, `4:17` and `8:12` read as absent. TVTMS divides those verses into parts that Brenton's printed parts don't match, so no row can name the right verse | `UNALIGNED_PARTS` in `src/ingest/tvtms.ts` (issues #69 and #70) | The same |
| The trouble-spot fixture for the Greek additions to Daniel and Esther | research/README.md | The same |
| Canon status values, the default Catholic order, the Ethiopian narrower and broader lists, and the unchecked Oriental Orthodox, OSIS and Russian sources | ADR-0002, research/canons.md | A Catholic or Orthodox canon is added |
| Research topics never started: textual variants, lexicons past Strong's numbers, tokenization of scripts without spaces | research/README.md | An app feature that needs one |

The pivot is extend-only (ADR-0006), so leaving a pivot home undecided costs nothing later: the ids are added when the decision is made, and no existing id moves. The test in `tvtms.test.ts` pins the count of unmapped verses, so a change that adds one fails.

Plan step 15 says to delete a Brenton, WEB or Robinson-Pierpont test that a later step breaks instead of fixing it. That rule covers a test only one of those editions needs. A wrong answer from shared code is fixed even when one of those editions is the only one that shows it, as issues #69, #70 and #71 were.
