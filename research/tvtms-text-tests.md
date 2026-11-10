# TVTMS text tests per edition

Researched 2026-11-09 for ADR-0006 decision 3, which says TVTMS's word-count tests run per edition at ingest. Decided the same day in ADR-0006's text-tests amendment: a 20% margin for word tests, and the derived scheme `bsb` for BSB. The counts below use no margin unless a section says so. Sources: [TVTMS][tvtms] at the pinned commit, and the corpus built from commit 126ebc3 (seven editions, README Editions).

## What the tests mean

The TVTMS header defines them at lines 117-127.

- `A>B` is true if the Bible has more words in A than in B, and `A<B` if it has fewer. A side can be a sum (`Num.1:32+Num.1:33`) or doubled (`1Ki.10:21*2`). The expanded rows hold 97 distinct word tests, 2,378 uses in all. Every reference in them names its book. The header also defines `A<B.0` (subverse 0), but no row uses it.
- `TextBeforeV1` is true if there is canonical text, such as a psalm title, before verse 1. It has 3,300 uses, all in Psalms.
- The header says the word tests are "designed with enough leeway to work for whatever language". The file gives no tolerance, so a test is a plain comparison.

## How they were evaluated

- A verse's word count is the number of `word` tokens with that verse number in the edition. A verse the edition lacks counts 0. A verse bridge puts all its words in the first verse (ADR-0004 rule 6).
- `TextBeforeV1` holds when the chapter has a `\d` block (a Psalm title) before its first verse-1 token. Section headings (BSB's "Deliver Me, O LORD!") are not canonical text and don't count. KJV, BSB and WEB have unnumbered titles. In WLC and Brenton the title is part of verse 1.
- A row is evaluated only if the edition has every book its text tests name. Otherwise it stays undecided, as today.
- After its count tests pass, a row whose text tests all pass is kept, and a row with a failing text test is dropped. `compileTvtms` then runs unchanged.

## Results per edition

`needsText` is the number of rows each scheme leaves undecided today (the ingest log's count). "Close" counts the evaluated rows where some word test's two sides differ by less than 10%.

| Edition | Scheme | needsText | Pass | Fail | Book absent | Close |
|---|---|---|---|---|---|---|
| KJV | `kjv` | 1,202 | 668 | 503 | 0 | 92 |
| BSB | `kjv` | 1,202 | 668 | 503 | 0 | 40 |
| WLC | `org` | 2,039 | 1,504 | 458 | 37 | 116 |
| SBLGNT | `org` | 2,039 | 2 | 2 | 1,995 | 2 |
| RP | `rp` | 1,202 | 3 | 3 | 1,165 | 0 |
| WEB | `web` | 1,418 | 775 | 603 | 0 | 70 |
| Brenton | `brenton` | 2,195 | 1,750 | 321 | 4 | 70 |

## Results per scheme

Each scheme takes the results of all its editions. A row whose result differs between editions stays undecided. The Paratext schemes `eng`, `lxx`, `vul`, `rso` and `rsc` have no edition, so nothing changes for them.

| Scheme | Rows that differ between editions | needsText | Stored TVTMS rows | Stored `.vrs` rows | Unmapped verses |
|---|---|---|---|---|---|
| `kjv` | 14 | 1,202 → 14 | 0 → 2 | 0 → 0 | 0 → 0 |
| `org` | 0 | 2,039 → 44 | 1,426 → 2,546 | 1,422 → 306 | 2 → 2 |
| `rp` | 0 | 1,202 → 1,196 | 3 → 3 | 0 → 0 | 0 → 0 |
| `web` | 0 | 1,418 → 12 | 133 → 176 | 0 → 0 | 3 → 3 |
| `brenton` | 0 | 2,195 → 173 | 3,075 → 4,639 | 3,293 → 1,971 | 102 → 97 |

## Two editions under one scheme

- **`kjv`: KJV and BSB give different results on 14 rows.** All 14 map a verse to itself, so the stored rows are the same for both.
  - Nehemiah 7:68-73 (12 rows) test `Neh.7:56<Neh.7:68`. BSB writes "They had 736 horses, 245 mules" in numerals: 6 words, against 9 in 7:56. KJV spells the numbers out: 14 words, against 8. The test reads BSB as following the Latin column. Its numbering is the same either way.
  - Revelation 12:17 and 13:1 (2 rows) test where the clause "he stood on the sand of the sea" sits. BSB ends 12:17 with it (42 words against 30), and KJV starts 13:1 with it (32 against 39). Verse mapping can't express a moved clause (ADR-0006, Consequences).
- **`org`: WLC (Old Testament) and SBLGNT (New Testament) share no book**, so no row has a result from both.

## A word test that misfires in English

TVTMS lines 4084-4087 tell the KJV order of Philippians 1:16-17 from the Greek order by `Php.1:16>Php.1:17`. That holds in Greek, where the "contention" verse is the longer one. In English it doesn't:

| Edition | Order | 1:16 words | 1:17 words | Test reads | Right? |
|---|---|---|---|---|---|
| KJV | KJV | 15 | 16 | Greek, swap | No |
| WEB | KJV | 16 | 18 | Greek, swap | No |
| BSB | critical | 17 | 22 | Greek, swap | Yes |
| SBLGNT | critical | | | Greek, swap | Yes |

So the `kjv` scheme gets `PHP 1:16 → 1:17` and `PHP 1:17 → 1:16`, which is right for BSB and wrong for KJV. KJV and BSB need different rows here, and only the wrong text tests make them agree.

Requiring a 20% margin between a word test's two sides leaves close tests undecided. It removes the KJV and WEB swaps, and BSB keeps its swap (23%). In `org` it removes two of the five new disagreements with `.vrs` (`PSA 13:6a` and `13:6b`), and `1KI 22:43` is no longer decided. It also makes `kjv` need different rows for KJV and BSB (the two swap rows) with no way to store them.

## Agreement with the `.vrs` witness

- `org`: text tests decide 1,534 more verses. 1,115 of them have a `.vrs` row, and the two witnesses agree on 1,110. The five that differ are PHP 1:16-17 (from SBLGNT; TVTMS is right, `.vrs` maps them to themselves), `1KI 22:43` and `PSA 13:6a`, `13:6b` (from WLC).
- `web`: 43 new disagreements, all in Greek Esther. TVTMS sends WEB's additions at `ESG 1:1a-r` to the KJV-Apocrypha positions `ESG 11:2-12:6`, and `.vrs` keeps `ESG 1:1a`. That is the open question of where the additions go in the pivot ([canons.md](canons.md), "What to decide next" item 5), not a test result.
- `brenton`: 245 new disagreements, such as `1KI 10:22!a1`: TVTMS sends it to `1KI 9:15`, the verse it repeats (`LongVerseElsewhere`), and `.vrs` to the pivot subverse `1KI 10:22!a1`.

## Still unmapped

Text tests map Brenton's 5 unmapped verses in Sirach 36. Its other 97 stay unmapped (2 Esdras 14 and 19, Proverbs 24, Sirach 30), and so do WEB's 3 (Baruch 1:22, 4 Maccabees 7:24-25).

## As built

With the 20% margin, BSB under `bsb`, and a row decided for a scheme only when all its editions agree, from `src/ingest/fixtures/edition-text.json`. A `-` means the scheme has no `.vrs` witness.

| Scheme | needsText | Stored TVTMS rows | Stored `.vrs` rows | Witness diff lines | Unmapped verses |
|---|---|---|---|---|---|
| `kjv` | 1,202 → 37 | 0 → 0 | 0 → 0 | - | 0 → 0 |
| `bsb` | 1,202 → 38 | 0 → 2 | 0 → 0 | - | 0 → 0 |
| `org` | 2,039 → 170 | 1,426 → 2,531 | 1,422 → 319 | 434 → 437 | 2 → 2 |
| `rp` | 1,202 → 1,198 | 3 → 3 | 0 → 0 | - | 0 → 0 |
| `web` | 1,418 → 69 | 133 → 164 | 0 → 0 | 17 → 48 | 3 → 3 |
| `brenton` | 2,195 → 281 | 3,075 → 4,629 | 3,293 → 1,977 | 581 → 818 | 102 → 97 |

`bsb`'s two TVTMS rows are the Philippians 1:16-17 swap. No edition's own results differ from its scheme's rows.

A verse bridge puts all its words in its first verse (ADR-0004 rule 6), so a word test on the bridge's second verse would read 0. The pinned editions' only bridges are six in WEB's Sirach and 4 Maccabees, and no tested verse falls in one.

[tvtms]: https://github.com/STEPBible/STEPBible-Data/tree/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/Versification
