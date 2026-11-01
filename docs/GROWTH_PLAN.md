# Growth master plan

Started 1 Nov 2026. Six-month horizon (to end of April 2027). Living document: tick items off as PRs merge.

## 1. Goals

1. **More registrations.** Signups peaked at 81 in Aug 2026, then fell to 25 in Sep and 7 in Oct. The launch push has run out, so we need a steady source of new members.
2. **Better balance.** More women, more members under 30, more members outside North-West London.
3. **Recognition.** Be the name Google and AI tools give for Gujarati Hindu and Jain introductions in the UK.
4. **Renewals.** Keep existing members renewing each year.

Proposed targets for 30 Apr 2027 (to agree):

| Measure | Now (1 Nov 2026) | Target |
|---|---|---|
| Active members | 158 | 300 |
| Women share of active | 39% (61 of 158) | 45% |
| Members under 30 | 37 (1 under 25) | 70 |
| New signups per month | 7 (Oct) | 25+ steadily |
| AI test prompts that mention us | to measure | half of 20 |
| Google clicks per month (GSC) | to measure | grow monthly |

## 2. What the data says (active members, 1 Nov 2026)

- **Gender:** 97 men, 61 women. The biggest gap is men 30-34 (36) against women 30-34 (14).
- **Age:** almost nobody under 25 (1 member). 25-29 is small on both sides (19 men, 17 women).
- **Faith:** 97 Hindu, 60 Jain.
- **Place:** heavily North-West London. HA postcodes alone are 53 members, then UB 14, NW 10, Leicester 9, Ilford 8. Almost everyone is UK-based.
- **Referrals:** 8 of 171 signups came through recommend-a-friend.

So content should lean towards women (safety, verification, respect), people in their 20s, parents, and families outside Harrow and Wembley.

## 3. Fact sheet (single source of truth for all copy)

- Vanik Council (UK) was founded in **1978** as The National Council of Vanik Associations (UK).
- **Registered charity number 1137083.** Umbrella organisation for affiliated associations across the UK, many of them charities too.
- The Vanik Matrimonial Register has run for **over 40 years** (keep this wording, no exact year) and has led to **hundreds of marriages**.
- Open to adults **18+** from **all Gujarati Hindu and Jain families**, Vanik or not.
- **Mainly UK, members abroad welcome** (registration already accepts non-UK countries).
- **£10 a year**, not-for-profit, no adverts, data never sold.
- Every member is verified by a volunteer, including ID, **within 2 working days**.
- Up to three introductions at a time. Contact details only inside the dashboard. Nothing shown publicly.
- **Speed dating events twice a year.**

## 4. Decisions

| Topic | Decision |
|---|---|
| Audience | Singles and parents equally, with separate pages for each |
| Writing | Claude drafts, Akash approves |
| Tone | Warm community, plain English, occasional Gujarati where natural. Plain hyphens only, no em or en dashes |
| Approval | One PR per batch, Akash reviews the Vercel preview link |
| Analytics | Google Analytics 4, **public pages only** (never dashboard or admin), with a cookie consent banner, off by default |
| Signup source | Optional "How did you hear about us?" at registration |
| AI crawlers | Allow all on public pages, including training bots |
| Comparison page | Allowed to name other services, factually and fairly |
| Content cadence | Batch of about 10 guides, then 2 a month |

## 5. Work plan

### PR 1: Measurement (week 1)
- [ ] GA4 on public pages only, Consent Mode v2 with a banner (analytics off until accepted), CSP updated for Google tags
- [ ] "How did you hear about us?" (optional): friend or family, Google, ChatGPT or other AI, temple or association, social media, speed dating event, other. Store on `member_private`; show the breakdown in Admin > Analytics
- [ ] Baseline: 20 test prompts run in ChatGPT, Perplexity, Gemini and Google, results recorded in `docs/ai-visibility-log.md`

### PR 2: Crawlable foundation (week 1-2)
- [ ] Build-time static HTML for every public page: own title, description, canonical, social preview, full text
- [ ] Homepage renders the logged-out version in that HTML (no "Loading…")
- [ ] Demo profiles stay live-loaded. **No member data ever goes into static files**
- [ ] Real 404 status for unknown URLs
- [ ] Sitemap generated from the page list with last-modified dates
- [ ] robots.txt names and allows the AI crawlers; private areas stay blocked
- [ ] `llms.txt` with the fact sheet and key links
- [ ] Structured data per page: Organization (charity number, founding date, links to the Council site), FAQPage on the FAQ, BreadcrumbList, Event for speed dating
- [ ] Fuller footer: About, FAQ, For parents, Events, Guides, Privacy, Vanik Council

### PR 3: Core pages (weeks 2-3)
Content lives as Markdown files in the repo, turned into static pages at build.
- [ ] `/about` - Vanik Council, 1978, charity 1137083, volunteers, 40+ years, hundreds of marriages
- [ ] `/faq` - 30+ questions, grouped (joining, safety and privacy, introductions, cost, parents, abroad)
- [ ] `/for-parents` - how parents can help, why the single person registers, sharing the link
- [ ] `/how-it-works` - full walkthrough with what verification involves
- [ ] `/events` - speed dating twice a year, what happens, next dates
- [ ] `/jain-matrimonial-uk` and `/gujarati-hindu-matrimonial-uk` - community pages with real substance
- [ ] `/compared` - Vanik Register vs Shaadi.com, Jeevansathi and dating apps: price, verification, approach
- [ ] `/safety` - verification, privacy and safety, written with women in mind

### PR 4: First 10 guides (weeks 3-5)
1. How to write a matrimonial profile that gets replies
2. Questions to ask before saying yes
3. Helping your son or daughter find a partner: a guide for parents
4. Your first meeting after an introduction: what to expect
5. Hindu and Jain matches: talking about diet, faith and family
6. Matrimonial register or dating app: which suits you?
7. How we verify every member, and how to stay safe
8. Looking for a partner in your 20s, without the pressure
9. Speed dating at Vanik Council: what happens on the night
10. Leicester, London and beyond: finding a match outside your area

### Ongoing (from December)
- [ ] 2 guides a month, chosen from Search Console queries and the AI prompt log
- [ ] Monthly: rerun the 20 AI test prompts, review GSC and GA, check signups by source
- [ ] Quarterly: refresh member stats in this plan and adjust targets

## 6. Akash's to-do (off-site and accounts)
- [ ] Merge PR #11, then press Verify in Google Search Console and submit the sitemap
- [ ] Bing Webmaster Tools: import from Search Console (powers ChatGPT search and Copilot)
- [ ] Create a GA4 property and send the measurement ID (`G-...`)
- [ ] Prominent link from vanikcouncil.uk to the register
- [ ] List of affiliated associations with websites, and ask each for a link
- [ ] Volunteer names (and consent) for the About page
- [ ] Next speed dating dates and venues
- [ ] Later: success stories with consent, community press (Asian Voice, Garavi Gujarat)

## 7. Guardrails
- Never put member data in static pages, sitemaps or structured data.
- GA never runs inside the dashboard or admin.
- Every fact comes from the fact sheet above. If something isn't on it, ask before writing it.
- Any new Supabase table gets explicit grants in the same migration.
