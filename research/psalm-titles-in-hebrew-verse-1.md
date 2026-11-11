# Psalm titles inside Hebrew verse 1

Issue [#12](https://github.com/riolly/bible-data-structure/issues/12). Probed on 2026-11-11 against `build/corpus.db` at `aacb4f1`, with TVTMS pinned at STEPBible-Data commit `5de0a47`.

## What happens

English Bibles print a short Psalm title before verse 1 and number it as verse 0 (`PSA 23:0/kjv`, "A Psalm of David."). The Hebrew text puts the same words at the start of verse 1 (WLC `PSA 23:1/org` starts מִזְמ֥וֹר לְדָוִ֑ד). For 53 Psalms the `org` scheme has no mapping row for the title, so the pivot's `PSA N:0` has no `org` counterpart:

11, 14, 15, 16, 17, 23, 24, 25, 26, 27, 28, 29, 32, 35, 37, 50, 66, 72, 73, 74, 78, 79, 82, 86, 87, 90, 98, 100, 101, 103, 109, 110, 120 to 134, 138, 139, 141, 143, 144, 145.

`map(KJV, PSA 23:0, WLC)` gives `absent` with no `missing` entry, and `map(WLC, PSA 23:1, KJV)` gives KJV 23:1 alone. BSB gives the same 53. Titles that Hebrew numbers as their own verse map correctly, because TVTMS and `eng.vrs` both have rows for them (`PSA 51:0 = PSA 51:1` and `= PSA 51:2`, `eng.vrs` lines 230-231).

## What TVTMS records

TVTMS says where these titles go in three places, and they disagree for Psalm 37.

1. **The expanded rows** give no relation. The Hebrew row for verse 1 is `EngTitleMerged+Hebrew Psa.23:1 → Psa.23:1`, action `Keep verse`, test `Psa.23:TextBeforeV1=NotExist` (TVTMS line 11326). No row sends a Hebrew verse to `Psa.23:Title`.
2. **The notes column of the English rows** gives the parts. `EngTitleSeparate Psa.23:Title` has the note `(Hebrew=23:1a • Latin=22:1a • Greek=22:1a)`, and `Psa.23:1` has `(Hebrew=23:1b …)` (lines 11327-11328). 52 of the 53 say `Hebrew=N:1a`. Psalm 37 says `Hebrew=37:1` for the title and `Hebrew=37:2` for English verse 1 (lines 11983-11984). The second is wrong: Hebrew 37:2 is English 37:2, as the row's own `Keep verse` action says.
3. **The short tables** say it the same way for all 53. The Hebrew column of the title row reads `Absent [=Psa.23:1]`, meaning no verse of its own, with the text inside 23:1 (line 1206). Psalm 37 reads `Absent [=Psa.37:1]` (line 1352).

The `.vrs` witness has nothing for these Psalms: `eng.vrs` maps only the titles Hebrew numbers as their own verses.

## Which schemes it touches

Pivot titles with no counterpart, per scheme: `org` 54, `rso` 3, `rsc` 2, every other scheme 1. The one shared by all schemes is not one of the 53. Among the ingested editions only WLC (`org`) is affected. SBLGNT is also `org`, but it has no Psalms.

## Options

- **Rows from the short tables (recommended).** Where a scheme's short-table column says `Absent [=Psa.N:1]` for `Psa.N:Title`, and the scheme keeps verse 1 as the Standard's verse 1, add two rows: `PSA N:1a → pivot PSA N:0` and `PSA N:1b → pivot PSA N:1`. The short tables are consistent for all 53, and `Relation.forward` already sends a whole verse wherever its parts go. `map(KJV, PSA 23:0, WLC)` becomes `part` (the whole of WLC 23:1, marked partly matching), and `map(WLC, PSA 23:1, KJV)` becomes `several` (KJV 23:0 and 23:1). `map(KJV, PSA 23:1, WLC)` also becomes `part`, where it is `one` today, which is true: KJV 23:1 is the second part of WLC 23:1. The pivot doesn't change. The compiler reads the short tables for the first time, so the rows need their own `kind` and `source` tags for `build/mapping-diff.tsv`.
- **Rows from the notes column.** The same rows, read from `Hebrew=N:1a`. Rejected: the notes are wrong for Psalm 37, and they are prose meant for readers.
- **No rows, and a new absent reason.** `map` would say "inside verse 1" instead of absent. Rejected: step 11 needs `map` to return the Hebrew words of every English verse, and this returns none.
