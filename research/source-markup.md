# Markup in the pinned sources

What the seven pinned sources print that the chapter documents (ADR-0001, plan step 7) have to keep. Checked 2026-11-10 against the files `bun run ingest:download` unpacks, at the editions in README.md.

## Markers

The supported-marker table in ADR-0001 is the set of markers the seven sources use, plus `\sc`. The ingest stops on any other, so a new source that uses one more marker shows up as a stopped ingest naming it.

## Verse markers with no words

- **WEB, Sirach 11:15-16** ([eng-web_usfm.zip][web], `46-SIReng-web.usfm`): `\v 15-16 \f + \fr 11:15-16 \ft Verses 15 and 16 are omitted by the best authorities. \f*`. A bridge whose only content is a footnote. The verse is in the `web` scheme, so it gets a verse-text row with empty text.
- **WEB, Romans 16:25** ([eng-web_usfm.zip][web], `ROM` file): `\v 25 \f + \fr 16:25 \ft TR places Romans 14:24-26 at the end of Romans instead of at the end of chapter 14, and numbers these verses 16:25-27.\f*`. The `web` scheme ends Romans 16 at verse 24, so the marker gets no verse-text row and the ingest warns. The marker stays in the chapter document.

## Verses with no marker

- **BSB, Matthew 17:21** ([engbsb_usfm.zip][bsb], `MAT` file): chapter 17 goes from `\v 20` to `\v 22`. BSB leaves out 15 more New Testament verses the same way, listed under textual variants in [README.md](README.md). Such a verse gets no verse-text row.

## Paragraph marks printed as text

Counted in `build/corpus.db` on 2026-11-14.

- **KJV, pilcrow** ([eng-kjv_usfm.zip][kjv], for example `71-MRKeng-kjv.usfm`): `\v 9 ¶ Now \w when\w* \add Jesus\add* was \w risen\w*`. The pilcrow is plain text after the verse marker, where the printed KJV starts a paragraph. 2,970 of KJV's 31,218 verse units begin with `¶ `, and in none is it anywhere else. The other six editions have none. It is a punctuation token with no word index. Verse text leaves it out (ADR-0001 amendment, 2026-11-14).
- **WLC, `פ` and `ס`** (OSHB): a standalone unpointed `פ` or `ס` marks an open or closed paragraph break (ADR-0004 rule 6). WLC has 3,162 of them, each a punctuation token with no word index, in 3,130 of its 23,213 verse units. 3,072 units end with one after the verse's last word, and 88 hold one inside the verse, as 1 Chronicles 1:41 does. Verse text leaves them out (ADR-0001 amendment, 2026-11-14). KJV prints the same two letters once each as stanza labels of Psalm 119, in headings, where they are words.
- **API.Bible's KJV** prints the pilcrow too. In John 3 both have it at verses 14, 16, 18, 22, 23 and 25 (`src/provider/fixtures/api-bible-kjv-JHN.3.json`). The four kept NASB95, NLT and NIV chapters hold none.

[kjv]: https://ebible.org/Scriptures/eng-kjv_usfm.zip
[web]: https://ebible.org/Scriptures/eng-web_usfm.zip
[bsb]: https://ebible.org/Scriptures/engbsb_usfm.zip
