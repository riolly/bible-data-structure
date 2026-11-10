# Markup in the pinned sources

What the seven pinned sources print that the chapter documents (ADR-0001, plan step 7) have to keep. Checked 2026-11-10 against the files `bun run ingest:download` unpacks, at the editions in README.md.

## Markers

The supported-marker table in ADR-0001 is the set of markers the seven sources use, plus `\sc`. The ingest stops on any other, so a new source that uses one more marker shows up as a stopped ingest naming it.

## Verse markers with no words

- **WEB, Sirach 11:15-16** ([eng-web_usfm.zip][web], `46-SIReng-web.usfm`): `\v 15-16 \f + \fr 11:15-16 \ft Verses 15 and 16 are omitted by the best authorities. \f*`. A bridge whose only content is a footnote. The verse is in the `web` scheme, so it gets a verse-text row with empty text.
- **WEB, Romans 16:25** ([eng-web_usfm.zip][web], `ROM` file): `\v 25 \f + \fr 16:25 \ft TR places Romans 14:24-26 at the end of Romans instead of at the end of chapter 14, and numbers these verses 16:25-27.\f*`. The `web` scheme ends Romans 16 at verse 24, so the marker gets no verse-text row and the ingest warns. The marker stays in the chapter document.

## Verses with no marker

- **BSB, Matthew 17:21** ([engbsb_usfm.zip][bsb], `MAT` file): chapter 17 goes from `\v 20` to `\v 22`. BSB leaves out 15 more New Testament verses the same way, listed under textual variants in [README.md](README.md). Such a verse gets no verse-text row.

[web]: https://ebible.org/Scriptures/eng-web_usfm.zip
[bsb]: https://ebible.org/Scriptures/engbsb_usfm.zip
