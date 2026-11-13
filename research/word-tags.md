# Strong's numbers on English words

Status: noted 2026-11-13 for plan step 12, from the files named below. Each number here was counted from those files and `build/corpus.db` on that date.

A Full edition (ADR-0008) needs a Strong's number on each English word that translates an original word. This file compares the sources of those numbers for BSB and KJV.

## BSB

### The BSB's own `strong=` tags: rejected

ebible's `engbsb` carries `\w` tags, but they are shifted the way ADR-0003 found WEB's: GEN 1:1 reads `In|H8064 the|H1254 beginning|H7225 God|H8064 created|H1254`. No check could repair them.

### Clear Bible's manual alignments: used

[Clear-Bible/Alignments][clear] at commit `c99bd0a` has two manual alignments of the BSB, made by Biblica's team:

- `data/eng/alignments/BSB/SBLGNT-BSB-manual.json`: SBLGNT words to BSB words, New Testament.
- `data/eng/alignments/BSB/WLCM-BSB-manual.json`: WLC morphemes to BSB words, Old Testament. Its `.toml` says `scope = "NT"`, which is wrong: every record is in the Old Testament.

Each record links a group of source ids to a group of target ids. The targets are Clear's own tokens of the BSB, in `data/eng/targets/BSB/nt_BSB.tsv` and `ot_BSB.tsv`, with ids `BBCCCVVVWWW` in the BSB's numbering (Psalm titles are verse 0), and punctuation marked `exclude = y`.

The source ids are MACULA's ids, which plan step 11 already joins:

- All 137,741 SBLGNT ids are MACULA Greek's `xml:id`, which are our `ow_id`s.
- All 469,476 WLCM ids are MACULA Hebrew's morpheme ids (`o010010010011`). Step 11 joins each MACULA Hebrew word to an OSHB word through the read text, so each morpheme id reaches an OSHB `ow_id`. Each morpheme has its own Strong's number in `strongnumberx` (`0871a` for the preposition בְּ, `7225` for רֵאשִׁית), so an English word aligned to a prefix alone gets the prefix's number, not the word's main number.

A record is a group. In GEN 1:1 one record links `In the beginning` to בְּ and רֵאשִׁית, so each of the three English words translates both morphemes, and each gets `H871` and `H7225`. The alignment says which group of English words translates which group of original parts, not which word translates which part.

Coverage, of the words Clear doesn't mark `exclude`:

| | Words | Aligned | Not aligned |
|---|---|---|---|
| New Testament | 171,894 | 171,172 | 722 |
| Old Testament | 554,818 | 553,480 | 1,338 |

Clear aligns no Psalm title: none of its records names a verse 0 target, so the 116 titles in the BSB (1,028 of our words) get no Strong's numbers. The other unaligned words are mostly function words (`the`, `of`, `and`).

#### The BSB revision

Clear's target text is the BSB of 2024-09-04 (its commit message, "changes from target_BSB_20240904.tsv"). Our pinned BSB is ebible's build from source files dated 2026-10-30. Both have the same 31,202 verses. 30,344 verses have the same words. 858 verses differ, for example GEN 2:14 `Tigris` (2024) and `Hiddekel` (2026), and EXO 29:18 `a food offering` and `an offering made by fire`.

The ingest joins the two texts verse by verse on their longest common sequence of words, comparing letters and digits without case or accents. A word of ours outside that sequence gets no Strong's number. In a verse that differs, a word also needs a joined neighbour on the same side in both texts, or must start or end both verses: a lone common word in a reworded phrase can belong to another phrase in Clear's text. Without that rule, 2SA 18:32 `what has become of the young man` took `H341` from `the enemies`, and ACT 19:15 `one of the evil spirits` took `G1161` from `But one day`.

A joined word then takes its Clear group's alignment only when every word of that group joined too. Where two phrases trade places, the edge of a run joins a word whose group's head moved: 1CH 13:1 reads `of hundreds and of thousands` in ours and `of thousands and of hundreds` in Clear's, and our `of` before `thousands` took `H3967`, hundreds, through Clear's group `and of hundreds`.

### The result

After `bun run ingest` on 2026-11-13, 721,761 of the BSB's 726,744 words have at least one alignment row (777,762 rows). 2,051 words are in Clear's text but unaligned, 1,028 of them in Psalm titles. 1,824 don't join a word of Clear's revision, and 1,108 join one whose group didn't join whole. By ADR-0008 the BSB is not Full until those 4,983 words have numbers or a source marks them as having no counterpart.

### The Berean interlinear tables: not used

[bsb_tables.xlsx][berean-tables] (55 MB, changed 2026-10-27) gives each Hebrew and Greek word its BSB phrase and Strong's number. Its Greek text is the Berean Greek text, not the SBLGNT, so its rows don't carry ids that join to our words. Clear's alignment does, so the tables were not needed. They are the fallback if a later BSB revision drifts too far from Clear's.

## KJV

No alignment of the KJV to MACULA exists in Clear's repository. ebible's `eng-kjv` carries `\w` tags whose numbers are right where tested (GEN 1:1 `beginning|H7225 God|H0430 created|H1254`). A tag can cover several words (`these things|G5023`), and words with no tag are common: GEN 1:1 tags none of `In the`.

Tested against the step 11 words: a tag passes when its number is a Strong's number of a word in the WLC or SBLGNT verse the KJV verse maps to through the pivot. The counts:

| | Tags | In the mapped verse | Not |
|---|---|---|---|
| Old Testament | 226,772 | 225,604 (99.5%) | 1,168 |
| New Testament | 121,902 | 117,031 (96.0%) | 4,871 |

The New Testament misses are mostly the KJV's Greek text (the Textus Receptus) having words the SBLGNT lacks. The Old Testament misses checked by hand are the same Hebrew word filed under another number: GEN 6:4 `men|H0582` where OSHB gives אַנְשֵׁי `H376`, GEN 13:7 `herdmen|H7462` where OSHB gives רֹעֵי `H7473`, and GEN 2:21 `Adam|H0121` where OSHB gives הָאָדָם `H120`.

Since the KJV tags leave words like `In the` untagged, and don't mark them as having no counterpart, the KJV can't be Full on these tags alone (ADR-0008).

### The result

After `bun run ingest` on 2026-11-13, 343,055 of the KJV's 349,308 tags pass and are stored in `word_alignment` (ADR-0003, KJV amendment). 6,043 name no word of their mapped verse, and 210 are in verses that map to no WLC or SBLGNT verse. Before the Psalm titles inside Hebrew verse 1 were mapped (issue #12), 107 more were in such verses. The counts are per tag and verse unit, so they differ a little from the table above. A tag names a number, not a word, so the ingest picks one original word for it: the n-th word with the number when the counts match, else the word nearest the tag's place in the verse. 354,801 of the KJV's 790,676 words have a row.

[clear]: https://github.com/Clear-Bible/Alignments/tree/c99bd0ae6946775f932517656308ca19fc706921
[berean-tables]: https://bereanbible.com/bsb_tables.xlsx
