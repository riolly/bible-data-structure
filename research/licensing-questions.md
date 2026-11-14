# Licensing questions to send

Two letters that only a person can send. Each is ready to paste. Put your name at the end, send it, and record the answer under "Answers" with its date. An answer that changes a limit also changes the edition's rights record in `src/contract/rights.ts`.

Both letters say what is true today: one developer, no registered organization. The facts behind each question are in [licensing.md](licensing.md), "Closed-license translations".

## To API.Bible

Send through the Contact link on [care.api.bible](https://care.api.bible/), API.Bible's help site, and name the account that owns the API key. API.Bible's terms cover "any individual or entity", so this letter can go out now.

> Subject: Four questions about the terms, for a free Bible reading app
>
> Hello,
>
> I am an individual developer, not an organization. I am building a free, non-commercial Bible reading app for English readers, with no ads, revenue, subscriptions or in-app purchases. It reads the NASB 1995, the NLT and the NIV through API.Bible on the Starter plan. Before I release it I want to be sure that four things are within your terms.
>
> 1. Converting the JSON for display. I request chapters with `content-type=json` and convert that JSON into my own chapter format, which the app draws on screen. I keep every word, the punctuation, the capitalization, the footnotes and the copyright line you send, and I change no text. Does this conversion count as a change to "any part of the structure or content" under section 4.1 of the terms?
> 2. Storing chapters on a device. The terms allow offline storage with a refresh every 30 days. The Express Licensing FAQ says caching is allowed and recommended, and the developer FAQ asks for fewer than 500 consecutive verses. May the app keep a whole Bible on the user's device for offline reading if it refreshes each chapter within 30 days? If not, what is the limit in verses or chapters, and does it differ between the NASB 1995, the NLT and the NIV?
> 3. Caching on my server. May my own server keep the chapters it fetched and serve them to the app, with the same 30-day refresh, so that each reader's request does not call your API?
> 4. Moving to an organization later. If I register an organization to publish the app, does the account and its Express license carry over, or do I apply again?
>
> I will follow whatever limits you give me. A written answer lets me build them into the app.
>
> Thank you,
> [name]

## To the Lockman Foundation

Send through Lockman's [Email Us form](https://www.lockman.org/email-us/), which takes a name, an email address, a subject and a message. The [permission to quote request form](https://www.lockman.org/permission-to-quote-request-form/) is for quoting verses in a work, not for licensing text files, so it doesn't fit. Nothing in the repo waits on this answer: NASB stays a Reading edition (ADR-0008) until a license for files with Strong's numbers exists. Lockman may only license to an organization, and the first question asks.

> Subject: License for NASB text files with Strong's numbers, for a free app
>
> Hello,
>
> I am an individual developer, not an organization. I am building a free, non-commercial Bible reading app for English readers. Today it shows the NASB 1995 through API.Bible, whose responses carry no Strong's numbers. I would like a reader to tap an English word and see the Hebrew or Greek word it translates, and that needs a Strong's number on each word of the NASB.
>
> 1. Do you license NASB 1995 text files with a Strong's number on each word to an individual developer of a free app, or only to an organization? Is the NASB 2020 available the same way?
> 2. Which file format would I receive (USFM, USX, OSIS or another), and does it mark the words the translators supplied, which print in italics?
> 3. What are the terms: the fee, the attribution text, and whether the app may keep the whole Bible on the user's device for offline reading and search?
> 4. Your permissions page allows up to 1,000 verses stored in an electronic retrieval system without written permission. Does that limit apply to chapters an app receives under API.Bible's license and keeps on a device for offline reading?
>
> Thank you,
> [name]

## Answers

- API.Bible: sent on 2026-11-14 through the help site's contact widget. No answer yet.
- Lockman Foundation: not sent.
