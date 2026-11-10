# The first apps' scope, and two support levels for an edition

Status: accepted 2026-11-10 with the owner, after a review of the model against licensed translations. Moved here from the README plan (step 5).

The first apps are our own, free, published by a registered organization, for English readers. AI features may come later. Every cut below can be undone, because addresses name their scheme (ADR-0002). A model feature lands when a contract call or a fixture from a target edition needs it.

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
| Requirement | We hold the files, they pass the checks, and each word has a Strong's number | It passes the numbering and markup checks |
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
