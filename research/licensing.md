# Licensing

Status: done 2026-11-09 for the step 3 sources. Each verdict answers three questions: may an app redistribute the text, what attribution it needs, and whether the raw files may be committed here. Every text below is downloaded by `bun run ingest:download` and gitignored, so "commit raw files" only matters for test fixtures.

The ebible.org catalog with its `Redistributable` and `Copyright` columns is [translations.csv][catalog]. Each zip carries a `copr.htm`, which is the same page as the edition's `copyright.htm` linked below.

## Verdicts

| Source | Text license | Redistribute in an app | Attribution | Commit raw files | Used |
|---|---|---|---|---|---|
| KJV + Apocrypha, ebible `eng-kjv` | Public domain, Crown letters patent in the UK ([copyright.htm][kjv]) | Yes. Printing in or importing printed copies into the UK needs permission. Apps are not printing | None required | Yes | Yes, pinned in step 1 |
| BSB, ebible `engbsb` | Public domain since 2023-04-30 ([berean.bible licensing][bsb]) | Yes | None required | Yes | Yes, pinned in step 1 |
| World English Bible Classic with deuterocanon, ebible `eng-web` | Public domain, "World English Bible" is a trademark ([copyright.htm][web]) | Yes. A changed text must not be called "World English Bible" | None required | Yes | Yes |
| Westminster Leningrad Codex with OSHB morphology, ebible `hboWLC` | WLC text public domain. OSHB lemma and morphology CC BY 4.0 upstream ([morphhb LICENSE][oshb-license], [README][oshb-readme]). ebible's page still says CC BY-SA 3.0 ([copyright.htm][wlc]) | Yes for the text. The ingest drops the `strong` and `x-morph` attributes and only counts them, so no OSHB data reaches `corpus.db` | Text: none. Morphology, when it ships: "Open Scriptures Hebrew Bible Project", CC BY 4.0, taken from upstream morphhb, not from ebible's copy | Yes for the text. Fixtures that keep `x-morph` attributes carry the OSHB credit | Yes |
| SBL Greek New Testament, upstream [LogosBible/SBLGNT][sbl] at commit `d7f35ad` | CC BY 4.0, © 2010 Society of Biblical Literature and Logos Bible Software ([SBLGNT README][sbl], [LICENSE][sbl-license]) | Yes, with attribution | "SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0", and a note that the text was changed if it was | Yes, with the attribution next to them | Yes, since 2026-11-09. Converted from XML to USFM (`src/ingest/sblgnt-xml.ts`), words and punctuation unchanged |
| SBL Greek New Testament, ebible `grcsbl` | Same as upstream ([copyright.htm][sbl-ebible]) | Yes, with attribution | As upstream | Yes | No. Its text is damaged, see the notes |
| Robinson-Pierpont 2018 Byzantine text, ebible `grcmt` | Public domain ([copyright.htm][rp]) | Yes | None required | Yes | Yes |
| 1904 Patriarchal text, ebible `grcbyz` | Public domain ([copyright.htm][byz]) | Yes | None required | Yes | No. It fits no scheme (extra JHN 1:52, ACT 19:41, REV 15:9), and RP 2018 already covers the Byzantine placements |
| Brenton's Greek Septuagint with Apocrypha, ebible `grcbrent` | Public domain ([copyright.htm][brenton]) | Yes | None required | Yes | Yes |
| Septuaginta, ebible `grclxx` (Orthodox Media Network) | Labelled "Public Domain ℗ Orthodox Media Network", but the page asks anyone who shares it to "publish the present text" ([copyright.htm][grclxx]) | Unclear. The condition contradicts the public-domain label | The page's text, if used | No | No. Brenton covers the Septuagint without the condition |
| Rahlfs-Hanhart Septuaginta | © Deutsche Bibelgesellschaft | No | n/a | No | No |
| Douay-Rheims 1899, ebible `engDRA` | Public domain | Yes | None required | Yes | No. WEB covers the deuterocanon and fits `eng` more closely |
| STEPBible TVTMS | CC BY 4.0, raw file not to be re-posted (`src/ingest/sources.ts`) | Compiled rows yes, with attribution | `TVTMS.attribution` in sources.ts | No | Yes, pinned in step 2 |
| libpalaso `.vrs` files | MIT (`src/ingest/vrs/libpalaso/LICENSE`) | Yes | MIT notice | Yes, committed | Yes, pinned in step 2 |

## Notes

- The SBLGNT ends Romans at 16:24 and keeps the doxology (16:25-27) only in a footnote. Upstream does the same ([Rom.txt][sbl-rom]), so this is the edition's text, not a conversion error.
- An earlier version of this file said the ebible SBLGNT differs from upstream only in the `‘p /’ ‘/book’` text after each book's last verse. That was wrong. Compared verse by verse with upstream's `data/sblgnt/text` at commit `d7f35ad` (2026-11-09), ebible's copy differs in 2,299 of 7,939 verses. Where ebible turned an apparatus mark into a footnote, it cut into words in 29 verses (HEB 7:4 `εωρεῖτε` for `Θεωρεῖτε`, EPH 4:7 `ἡ … ῶν` for `ἡμῶν`, which also adds a word), and dropped about 1,670 closing `⸃` signs and about 1,000 punctuation marks in 2,270 more. MRK 16:9 lost its opening `⟦`. The ingest therefore reads upstream's XML. The conversion only changes markup, and `sblgnt-xml.test.ts` checks every verse against upstream's plain-text edition. An app that ships it should still say it was converted (CC BY 4.0, section 3(a)(1)(B)).
- The ebible WEB has two places where a footnote stands between two words with no space on either side (2ES 7:36 `hell\f …\f*will`, 2ES 12:32 `will\f …\f*heap`), so the words ran together. The ingest adds the space with two counted text fixes. That changes whitespace only, not a word, which we read as outside WEB's "if you CHANGE the actual text" condition ([copyright.htm][web]). Report both to ebible.org, which asks for typo reports.
- OSHB morphology is the only data here that needs attribution and could reach an app later, through ADR-0003's original-word layer. Take it from upstream [morphhb][oshb-readme] at a pinned commit, under CC BY 4.0.

[catalog]: https://ebible.org/Scriptures/translations.csv
[kjv]: https://ebible.org/eng-kjv/copyright.htm
[bsb]: https://berean.bible/licensing.htm
[web]: https://ebible.org/eng-web/copyright.htm
[wlc]: https://ebible.org/hboWLC/copyright.htm
[oshb-license]: https://github.com/openscriptures/morphhb/blob/3d15126fb1ef74867fc1434be1942e837932691f/LICENSE.md
[oshb-readme]: https://github.com/openscriptures/morphhb/blob/3d15126fb1ef74867fc1434be1942e837932691f/README.md
[sbl]: https://github.com/LogosBible/SBLGNT/blob/master/README.md
[sbl-rom]: https://github.com/LogosBible/SBLGNT/blob/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/data/sblgnt/text/Rom.txt
[sbl-license]: https://github.com/LogosBible/SBLGNT/blob/d7f35adca9ec410e1d1499c63b4dd989d76c8d4d/LICENSE
[sbl-ebible]: https://ebible.org/grcsbl/copyright.htm
[rp]: https://ebible.org/grcmt/copyright.htm
[byz]: https://ebible.org/grcbyz/copyright.htm
[brenton]: https://ebible.org/grcbrent/copyright.htm
[grclxx]: https://ebible.org/grclxx/copyright.htm
