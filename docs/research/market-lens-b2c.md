# B2C Market Opportunity Scan: Attacking the Blind Spot (July 2026)

Prepared 2026-07-31 as a deliberate counter-scan to `market-lens.md`, which eliminated B2C wholesale on churn/CAC/delight-not-budget grounds. This report tests where that rule breaks, with the same rigor and the same fixed constraints (solo/small AI-assisted team, Next.js 15 + Supabase + shadcn, no ad budget, success = demand > organic acquisition > conversion > 12–24mo compounding).

---

## 1. Where B2C actually works for a small team — the exception patterns, tested

Testing the five hypotheses against evidence rather than accepting them:

**(a) Urgent life events — CONFIRMED, strongest pattern.** When the trigger is death, a denied claim, a tax assessment, a divorce, or an immigration deadline, three things happen simultaneously: willingness to pay spikes, price anchors shift to professional fees (thousands), and search behavior becomes high-intent and artifact-shaped ("small estate affidavit form Texas," not "what is probate"). Evidence that consumers pay real money here: Hello Divorce charges $400–$4,000 ([Top Consumer Reviews](https://www.topconsumerreviews.com/best-online-divorce-companies/reviews/hello-divorce)); Boundless charges $750–$1,500 for immigration prep ([Immigration Start Guide](https://immigrationstartguide.com/blog/boundless-immigration-review-alternatives)); Atticus charges $175–$499 for estate settlement ([Atticus](https://www.weareatticus.com/)); Claimable charges $50 per insurance-appeal letter ([WABE](https://www.wabe.org/ai-powered-tool-claimable-helps-patients-fight-insurance-claim-denials/)).

**(b) Prosumer / "consumer who is really a business" — REJECTED for the flagship example.** The small-landlord category (1–4 units) looked ideal and is instead a cautionary tale: TurboTenant, Innago, Avail, Baselane, and Stessa all offer genuinely complete **free** tiers, monetizing via tenant-paid screening fees, embedded banking, and premium add-ons — "the free tier is the product, not a teaser" ([Rentlane](https://getrentlane.com/blog/best-free-property-management-software), [TenantCloud comparison](https://www.tenantcloud.com/review/property-management-software-for-small-landlords), [Baselane](https://www.baselane.com/resources/best-landlord-accounting-software)). A small team cannot sell software subscriptions against fintech-subsidized free, and cannot match the embedded-banking monetization without becoming a fintech. Freelancer tooling has the same shape (invoice/proposal tools saturated, free tiers everywhere). Prosumer only works where no fintech subsidy exists.

**(c) High-ticket one-time purchases — CONFIRMED, and it inverts the churn problem.** The consumer subscription numbers (section 2) are so bad that for episodic problems, one-time/transactional pricing is not a fallback — it is the correct model. You cannot churn from a purchase.

**(d) "$99 feels free next to a $2,000 professional" — CONFIRMED.** Probate attorneys cost 3–6% of estate value ([Elayne](https://www.elayne.com/resources/estate-settlement-process-guide)); divorce attorneys anchor Hello Divorce's $400 DIY tier; property-tax firms take 25%+ of savings, anchoring $49 flat-fee DIY packets ([AppealDesk](https://www.appealdesk.com/compare/ownwell-alternative)); immigration attorneys anchor Boundless. This anchor is the entire pricing strategy for every shortlisted candidate below.

**(e) Recurring-obligation categories — PARTIALLY CONFIRMED.** Property tax assessments recur annually (real re-purchase), but taxes are owned by TurboTax, renewals are too cheap to charge for, and pet/child admin is delight-not-budget. Only annual-appeal-type obligations survive this filter.

**The synthesized rule:** B2C works for a small team when the product is a **one-time, high-anchor, artifact-producing purchase triggered by a life event that generates high-intent transactional search** — and fails when it is a subscription competing with free, fintech-subsidized, or incumbent-bundled alternatives.

---

## 2. The honest economics of B2C in 2026

Real numbers, mostly from [RevenueCat's State of Subscription Apps](https://www.revenuecat.com/state-of-subscription-apps) and the [2026 free-to-paid conversion report](https://www.growthunhinged.com/p/free-to-paid-conversion-report):

- **Freemium converts at ~2.1%** download-to-paid by day 35; hard paywalls convert ~10.7% (5x better). Median free-to-paid across products: ~8%, skewed by outliers.
- **Free trials requiring a credit card convert ~30%** to paid — 5x trials without one. Trial-to-paid global median ~25.6%.
- **Churn is brutal:** >90% of users churn from most apps within 30 days; average paid-subscription churn is ~5.3%/month; **~72% of annual subscribers cancel within year 1** ([Business of Apps](https://www.businessofapps.com/data/app-subscription-trial-benchmarks/), [Marketing LTB](https://marketingltb.com/blog/statistics/subscription-statistics/)).
- **AI-branded consumer apps earn 41% more per customer but churn 30% faster** ([RevenueCat 2026 trends](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/)).

Implications, stated plainly:

1. A consumer subscription at $10/mo with 5–8% monthly churn has an LTV of roughly $125–$200 — and you have no ad budget to buy users against that. Consumer *subscriptions* remain correctly eliminated.
2. **One-time pricing at $50–$250 captures the same LTV in one transaction**, with zero retention infrastructure, and matches how episodic problems actually occur. The catch: revenue does not compound through retention — it compounds only if the *acquisition asset* (an SEO/tool library, a referral network) compounds. "$10k MRR" becomes "$10k/month in transactional revenue," which requires a permanent flow of ~50–100 new buyers/month forever.
3. Hard paywall or credit-card trial beats freemium 5x — generosity is punished in B2C.

---

## 3. Acquisition: where consumers still search with an artifact-shaped need

The AI-Overview collapse documented in `market-lens.md` (top-10 ranking → AI citation overlap down from 75% to 17–38%; ~70% zero-click — [Omnibound](https://www.omnibound.ai/blog/ai-seo-statistics)) applies with double force to consumer informational content. What survives:

- **Jurisdiction-specific tool pages.** "Executor fee calculator [state]," "probate threshold checker [state]," "property tax appeal deadline [county]," "small estate affidavit generator [state]." AI Overviews answer the generic question but cannot produce the county-correct document — and the query intent is *do*, not *know*. Life-event legal/administrative categories are uniquely rich here because the US has 50 states × 3,000+ counties of genuine variation. This is the single best organic surface identified in either scan.
- **Reddit and niche forums.** Peer communities are where consumers in crisis actually ask ("r/EstatePlanning," "r/personalfinance," "r/Insurance," "r/legaladvice") — and buyers increasingly consult peer communities and AI engines over ads ([HubSpot organic marketing](https://blog.hubspot.com/marketing/organic-marketing), [Moburst](https://www.moburst.com/blog/app-organic-marketing-strategies-compared/)).
- **Short-form video for emotionally-charged events.** TikTok/Reels/Shorts organic reach remains real for consumer products; creator partnerships outperform paid ([MobileAction](https://www.mobileaction.co/blog/organic-app-growth-in-2025/), [Y77](https://www.y77.ai/blogs/mobile-app-user-acquisition-2026-guide-for-growth-teams)). "What no one tells you about being an executor" is native TikTok material; "DOT compliance" is not.
- **Professional referral channels that don't compete with you:** funeral homes, estate attorneys who decline small estates, patient advocates, real estate agents — all get asked for help they can't provide and have nothing to hand over.

---

## 4. Ranked B2C shortlist — six concrete products

### #1. "SettleKit" — executor estate-settlement workspace ("TurboTax for probate")

*(Evaluated seriously per the coordinator's note that the UX lens independently proposed this and rated its organic surface best-in-class. The UX lens is right about the surface.)*

- **One-liner:** A guided workspace that takes a first-time executor from death certificate to final distribution: state-specific probate path selection (full probate vs. small-estate affidavit), deadline calendar, asset/debt inventory, notification-letter generation, expense tracking for reimbursement, and beneficiary status pages.
- **JTBD replaced:** 570 hours of average executor labor ([Elayne](https://www.elayne.com/resources/how-much-does-executor-of-estate-get-paid)) across a ~16-month average settlement ([Batavia Law](https://www.batavialaw.com/estate-administration/probate-by-the-numbers/)), currently done with a binder, a spreadsheet, Google searches, and panicked calls to an attorney charging 3–6% of the estate. ~2.6 million probate cases are filed annually in the US, handling $60B+ in assets ([Probate Court Bond](https://www.probatecourtbond.com/probate-statistics-united-states/)).
- **Buyer & budget authority:** The named executor — typically a 45–65-year-old adult child, spending *estate* funds (executor expenses are reimbursable), with a $21k+ executor-fee anchor on larger estates and a $3k+ attorney anchor on all of them. This is the closest thing B2C has to "spending someone else's budget."
- **Monetization / path to $10k/mo:** One-time $149–$249 (tiered by estate complexity), positioned against Atticus's $175–$499. ~55 sales/month at ~$180 = $10k/mo. Optional recurring: $19/mo "active estate" plan during administration — but model the business on the one-time price.
- **First-100-users wedge:** (a) The jurisdiction-tool library — executor fee calculator by state (executor.org validates the query — [executor.org](https://executor.org/resource/executor-fees-by-state/)), probate-threshold checker, small-estate-affidavit eligibility quiz, county filing-fee lookups; (b) r/EstatePlanning + r/personalfinance presence; (c) funeral home partnerships (they're asked "what do I do now?" daily and have no software answer); (d) estate attorneys who decline sub-$200k estates.
- **Competition & honest read:** This is NOT open water. Atticus ($175–$499, in-house professionals), EstateExec ($199, award-winning, AI features), Empathy (free via employers/insurers), SwiftProbate, Estateably, EverSettled ([SwiftProbate comparison](https://www.swiftprobate.com/blog/best-ai-tools-estate-executors), [WifiTalents top-10](https://wifitalents.com/best/estate-executor-software/)). Beatable because: the market is enormous relative to penetration (2.6M cases/yr; no incumbent is a household name), none owns the jurisdiction-tool SEO surface the way NerdWallet owns credit cards, and Empathy's B2B2C distribution doesn't reach the direct-search executor.
- **Why now:** The boomer mortality wave is a 15-year structural demand ramp; LLM document parsing (bank statements, titles, EOBs) finally makes automated asset inventory feasible at a $200 price point; AI Overviews are killing the content-only players (executor.org) while tool-shaped pages survive.
- **Top 3 risks:** (1) Atticus/EstateExec are established with real brands — you are third-to-market at best; (2) 50-state legal-accuracy maintenance is a permanent cost and a UPL-adjacent liability requiring careful "not legal advice" positioning; (3) one-time revenue means growth stalls the month traffic stalls — no retention cushion.

### #2. "AssessRight" — property-tax appeal evidence packet generator

- **One-liner:** Homeowner enters their address; the app pulls comparable sales and assessment ratios, flags over-assessment, and generates a county-specific evidence packet + filing guide + cover letter for a flat fee.
- **JTBD replaced:** 15–40 hours of DIY research, or surrendering 25%+ of savings to contingency firms (Ownwell, O'Connor). The anchor: contingency firms exist precisely because the job is worth hundreds to thousands per year.
- **Buyer & budget:** Homeowner facing an assessment notice — a deadline-driven, angry, high-intent buyer.
- **Monetization / $10k/mo:** $49–$79 one-time per appeal. ~170 sales/mo at $59 — higher volume needed, but the purchase decision is trivial at this anchor. Annual recurrence (hypothesis e): assessments repeat, so a $39 returning-customer price builds a genuine cohort.
- **First-100 wedge:** County-specific pages ("[County] property tax appeal deadline 2026," "[County] assessment appeal form") — thousands of pages of genuine variation; r/personalfinance and local subreddits every assessment season; real estate agents as referrers.
- **Competition:** Ownwell (contingency, only 8 states as of July 2026), O'Connor (40+ states, full-service), and AppealDesk already doing flat-$49 DIY packets across 3,100+ counties ([AppealDesk](https://www.appealdesk.com/compare/diy-appeal-alternative)). AppealDesk's existence validates the model and means you'd need a differentiator (better comps data, e-filing integration).
- **Why now:** Post-2021 home-price runup → assessment shock cycles; hospital-grade document AI makes comp analysis cheap; contingency players' state coverage gaps are documented.
- **Top 3 risks:** (1) Extreme seasonality (appeal windows cluster); (2) comps-data licensing cost/quality is the real product and may be expensive; (3) AppealDesk or Ownwell moves first on the DIY-flat-fee flank.

### #3. "AppealLetter" — health-insurance denial appeal generator

- **One-liner:** Upload your denial letter + records; get a medically- and legally-cited appeal letter for a flat fee.
- **JTBD replaced:** A 30–50 hour research-and-writing ordeal most patients never attempt: ~20% of in-network claims are denied, fewer than 1% are appealed, yet 80.7% of appealed Medicare Advantage denials are fully or partially overturned ([U.S. News](https://health.usnews.com/wellness/articles/use-ai-to-help-fight-a-health-insurance-denial), [PYMNTS](https://www.pymnts.com/artificial-intelligence-2/2026/insurance-denials-meet-their-match-in-ai-powered-appeals/)).
- **Buyer & budget:** Patient (or family) facing a denial worth thousands to hundreds of thousands — infinite anchor, desperate urgency.
- **Monetization / $10k/mo:** $49–$99 per appeal → ~150 sales/mo.
- **First-100 wedge:** Condition-specific and payer-specific pages ("[Insurer] denied [drug] appeal letter"); r/HealthInsurance; patient-advocate communities and disease-specific nonprofits.
- **Competition — the problem:** Claimable ($50/letter, 75–80% claimed success, Mark Cuban-adjacent press, drugmaker deals — [Bloomberg](https://www.bloomberg.com/news/features/2026-04-22/ai-and-mark-cuban-among-startup-s-tools-to-fight-denied-health-care-claims)), Counterforce Health (**free** generator, ~70% claimed success — [Counterforce](https://www.counterforcehealth.org/)), Fight Health Insurance (**free** — [FHI](https://www.fighthealthinsurance.com/)). Two credible free competitors is close to disqualifying for a paid entrant.
- **Why now:** Denial rates + AI letter generation + sustained press attention post-2024.
- **Top 3 risks:** (1) Free competitors with mission-driven backing; (2) Claimable's head start and B2B pivot (drugmakers pay, patients go free); (3) PHI handling drags you toward HIPAA-grade infrastructure — the exact compliance-before-dollar-one trap.

### #4. "BillCheck" — medical bill audit + dispute letter kit

- **One-liner:** Upload an itemized hospital bill + EOB; the app flags duplicate charges, upcoding, and price-transparency violations, and generates dispute/negotiation letters (error dispute, charity-care application, prompt-pay script).
- **JTBD replaced:** Paying an erroneous bill, or a patient advocate charging 15–35% of savings. Industry sources claim error rates on hospital bills as high as 80% (see Claim confidence — this number is weakly sourced).
- **Buyer & budget:** Patient with a $2k–$50k bill; anchor is the bill itself.
- **Monetization / $10k/mo:** $79 flat (AiMyClaims already validates this exact price — [AiMyClaims](https://www.aimyclaims.com/blog/how-to-dispute-a-medical-bill)) → ~130 sales/mo.
- **First-100 wedge:** Hospital-specific price-lookup pages built on mandated price-transparency data (a genuinely defensible programmatic surface — the data is public, messy, and painful to normalize); r/personalfinance medical-debt threads.
- **Competition:** AiMyClaims ($79), SolidAITech (free analyzer), BillAudit AI, CareRoute — young and fragmented; no Claimable-equivalent leader yet ([Energent guide](https://www.energent.ai/energent/compare/en/negotiate-medical-bills-with-ai)).
- **Why now:** The Hospital Price Transparency Rule (updated 2024) makes fair-price benchmarking possible for the first time; LLMs parse itemized bills reliably.
- **Top 3 risks:** (1) Free analyzers commoditize the audit step; (2) success depends on hospital behavior you don't control — refund outcomes are unprovable, inviting refund demands; (3) same PHI drag as #3.

### #5. "PlainDivorce" — uncontested divorce forms + filing navigator

- **One-liner:** State-specific guided interview → complete, court-ready uncontested divorce packet + filing walkthrough, at the budget end of a validated price ladder.
- **JTBD & anchor:** $2,000–$15,000 attorney divorce vs. $137–$400 document services. The price ladder is proven: DivorceWriter $137 → 3StepDivorce/CompleteCase $299 → Hello Divorce $400–$4,000 ([Top Consumer Reviews](https://www.topconsumerreviews.com/best-online-divorce-companies/index.php)).
- **Path to $10k/mo:** $199 one-time → ~50 sales/mo.
- **Wedge:** State-specific filing-requirement tools and calculators (child support estimators, residency checkers); r/divorce.
- **Competition & why ranked low:** A 20-year-old category with entrenched SEO incumbents and affiliate-review gatekeepers; differentiation would be UX-only, which is clonable. Beatable nowhere obvious.
- **Top 3 risks:** incumbent SEO moats; UPL exposure; emotionally fraught support burden.

### #6. "GreenPath" — DIY immigration application prep (marriage-based green card)

- **One-liner:** Plain-English guided interview → complete USCIS filing packet, at a price under the incumbents.
- **Anchor:** Attorneys at $2k–$5k; Boundless $750–$1,500; SimpleCitizen $529+; government fees alone are $3,005 for the concurrent packet ([Immigration Start Guide](https://immigrationstartguide.com/blog/alternatives-to-boundless-simplecitizen-marriage-green-card), [SimpleCitizen](https://simplecitizen.com/pricing/)).
- **Path to $10k/mo:** $299 one-time → ~34 sales/mo.
- **Why ranked last:** Funded incumbents (Boundless raised institutional capital and bundles attorney review — a trust feature a solo team can't match); USCIS policy volatility in the current enforcement climate makes the product a moving target with life-ruining failure modes; the error cost is a deportation risk, not a lost fee. High revenue per sale does not compensate for catastrophic-error liability.

**Explicitly rejected within B2C:** small-landlord tools (fintech-subsidized free incumbents), freelancer admin (saturated + free tiers), all consumer *subscriptions* for episodic problems (economics in §2), flight-delay compensation (contingency model, EU-centric, incumbents like AirHelp), pet/child admin (delight-not-budget), name-change kits (too small a wedge to carry a business; viable only as a SettleKit/PlainDivorce upsell).

---

## 5. Top B2C recommendation: #1 — SettleKit (executor estate-settlement workspace)

**The case.** It is the only candidate that scores well on all four success criteria *as adapted for transactional B2C*:

1. **Demand:** ~2.6M probate cases/yr, a structurally growing trigger (boomer mortality), a 570-hour job, and a buyer spending estate funds against a 3–6%-of-estate professional anchor. Multiple competitors charging $175–$499 prove the willingness to pay.
2. **Organic:** the best artifact-shaped, jurisdiction-specific search surface in either scan — thousands of state/county tool pages that AI Overviews structurally cannot satisfy, plus referral channels (funeral homes, declining attorneys) with no competing incentive.
3. **Conversion:** hard paywall on a desperate, deadline-driven buyer whose alternative costs 10–100x more — the exact configuration the RevenueCat data says converts (hard paywall 10.7% vs freemium 2.1%).
4. **Compounding:** not via retention (one-time purchase) but via the SEO tool library and referral network, both of which compound for years, and via the demographic ramp.

**Against the B2C runners-up:** AssessRight is seasonal and already has a direct flat-fee competitor (AppealDesk); AppealLetter faces two free competitors and a better-funded leader; BillCheck's outcomes are unprovable and PHI-laden; PlainDivorce and GreenPath face entrenched or funded incumbents with trust features a solo team can't replicate.

**Strongest argument against SettleKit:** it is the most competed idea on this list — Atticus and EstateExec are established, award-collecting, professionally-staffed incumbents at the exact price point, and Empathy gives the product away through employers and insurers. You would be entering third (at best) with no retention-based moat, in a category where every sale must be re-won from scratch. I still pick it within B2C because the market is huge relative to anyone's penetration, no incumbent owns the jurisdictional-tool acquisition surface, and the runner-ups' fatal flaws (free competitors, seasonality, catastrophic-error liability) are worse than "crowded but underpenetrated."

---

## 6. The meta-question, answered plainly

**No — I would not switch. FleetReady remains the pick, and it is not close.** SettleKit is the best B2C idea, but it is *different*, not *better*:

| Dimension | FleetReady (B2B) | SettleKit (B2C) |
|---|---|---|
| Revenue model | Recurring, compounding via retention + switching costs | One-time; every month starts at $0 |
| Moat | System-of-record + regulatory-maintenance treadmill | SEO library + brand; no data lock-in |
| Competition | Embryonic category, no owner | Two established incumbents + a free B2B2C player |
| Why-now | Hard 2026 regulatory forcing function | Soft demographic ramp (real, but no deadline) |
| Buyer | Legally compelled, repeat obligation | Emotionally compelled, once |
| $10k/mo durability | ~110 retained accounts | ~55 *new* sales every month, forever |

The one-time-purchase structure is the decisive fact. At $10k/mo, FleetReady's revenue base is ~110 accounts that renew by default; SettleKit's is a treadmill of 55 fresh strangers a month sourced from an SEO surface that Google can repossess in one algorithm update. SettleKit's organic surface is genuinely better than FleetReady's — the UX lens is right about that — but acquisition excellence feeding a zero-retention model is a weaker business than adequate acquisition feeding a lock-in model.

Versus **CertShield** the comparison is closer and worth stating honestly: SettleKit has a larger TAM and a better organic surface; CertShield has recurring revenue and a non-discretionary trigger but the most contested wedge on the B2B list (TrustLayer's "no minimums" positioning). I would rank them roughly equal in expected value — SettleKit's ceiling is higher, CertShield's floor is higher. If the B2B path were somehow closed, SettleKit is a credible business, and its jurisdiction-tool library is the kind of asset that compounds regardless of which product sits behind it.

**Recommendation standing after both scans:** FleetReady first. SettleKit is the best-researched fallback and a plausible *second* product, not a replacement.

---

## Claim confidence

Every claim below came from web-search snippets and secondary sources; none was verified against primary data. Ordered by how load-bearing they are for the SettleKit recommendation and the meta-verdict:

1. **~2.6 million probate cases filed annually in the US; $60B+ in assets.**
   *Source:* [probatecourtbond.com](https://www.probatecourtbond.com/probate-statistics-united-states/) — a surety-bond vendor's statistics page, single source, methodology unknown.
   *Confidence:* **Low-medium.** The order of magnitude is plausible (~3.4M US deaths/yr — a figure from my general knowledge, not verified in this scan — with a substantial fraction requiring some court process), but this exact number must be verified against court-statistics sources (NCSC) before it anchors any decision. Most load-bearing single number in the B2C case.

2. **Executor burden: ~570 hours average, ~16-month average settlement, 3–6% of estate in settlement costs.**
   *Source:* [Elayne](https://www.elayne.com/resources/how-much-does-executor-of-estate-get-paid) and [Batavia Law](https://www.batavialaw.com/estate-administration/probate-by-the-numbers/) — an estate-tech vendor and a law-firm blog, both motivated to dramatize the burden.
   *Confidence:* **Low-medium** on the exact figures; **high** that the burden is large. The 570-hour figure circulates widely (originally EstateExec's survey, I believe) without independent verification.

3. **Competitor pricing: Atticus $175–$499; EstateExec $199; Empathy free via employers/insurers.**
   *Source:* Vendors' own sites ([Atticus](https://www.weareatticus.com/), [EstateExec](https://www.estateexec.com/)) and a competitor's comparison ([SwiftProbate](https://www.swiftprobate.com/compare/atticus)).
   *Confidence:* **Medium-high** on prices (first-party); **unknown** on their actual traction/revenue — no revenue data found for any of them. If Atticus is doing large volume, the "underpenetrated" argument weakens; verify via app-store review counts, traffic estimates, and funding data.

4. **Consumer subscription economics (freemium 2.1% vs hard paywall 10.7%; CC-trial ~30%; ~5.3%/mo churn; 72% year-1 annual cancellation; AI apps +41% revenue/−30% retention).**
   *Source:* [RevenueCat State of Subscription Apps](https://www.revenuecat.com/state-of-subscription-apps), [Growth Unhinged conversion report](https://www.growthunhinged.com/p/free-to-paid-conversion-report), [Business of Apps](https://www.businessofapps.com/data/app-subscription-trial-benchmarks/).
   *Confidence:* **Medium-high** — RevenueCat aggregates real payment data across thousands of apps, though it skews mobile; web-product numbers may differ somewhat. These numbers drive the "one-time beats subscription" conclusion, which is robust even at ±50% error.

5. **Insurance-denial funnel: ~20% of in-network claims denied, <1% appealed, 80.7% of appealed MA denials overturned; Claimable 75–80% success at $50; Counterforce and Fight Health Insurance free.**
   *Source:* [U.S. News](https://health.usnews.com/wellness/articles/use-ai-to-help-fight-a-health-insurance-denial) and [PYMNTS](https://www.pymnts.com/artificial-intelligence-2/2026/insurance-denials-meet-their-match-in-ai-powered-appeals/) (denial/appeal rates trace to KFF analyses — **medium-high**); Claimable's success rates are **self-reported via press** — **low-medium**; free competitors' existence confirmed first-party ([Counterforce](https://www.counterforcehealth.org/), [FHI](https://www.fighthealthinsurance.com/)) — **high**.

6. **Property-tax landscape: AppealDesk at $49 flat across 3,100+ counties; Ownwell limited to 8 states as of July 2026.**
   *Source:* [AppealDesk's own comparison pages](https://www.appealdesk.com/compare/ownwell-alternative) — a competitor's marketing, for both claims.
   *Confidence:* **Low-medium.** AppealDesk's coverage claim and Ownwell's state count both need verification from Ownwell directly. AppealDesk's *existence* (which caps the idea's rank) is certain; its traction is unknown.

7. **Small-landlord free-tier dynamics (TurboTenant/Innago/Avail/Baselane/Stessa free, monetized via tenant fees and banking).**
   *Source:* Multiple vendor and comparison sites ([Rentlane](https://getrentlane.com/blog/best-free-property-management-software), [TenantCloud](https://www.tenantcloud.com/review/property-management-software-for-small-landlords), [Baselane](https://www.baselane.com/resources/best-landlord-accounting-software)).
   *Confidence:* **Medium-high** — consistent across many sources and first-party pricing pages. This underpins the prosumer rejection.

8. **"Up to 80% of hospital bills contain errors."**
   *Source:* [Energent](https://www.energent.ai/energent/compare/en/negotiate-medical-bills-with-ai) citing unnamed "industry studies."
   *Confidence:* **Low.** This is a marketing-circulated statistic with no traceable primary study. Do not use it in any customer-facing claim without finding the primary source. The BillCheck case survives at much lower error rates, but honesty requires flagging this as unverified.

9. **Divorce and immigration pricing ladders (DivorceWriter $137 → Hello Divorce $400–$4,000; SimpleCitizen $529+ → Boundless $750–$1,500; $3,005 government fees).**
   *Source:* Review aggregators and first-party pages ([Top Consumer Reviews](https://www.topconsumerreviews.com/best-online-divorce-companies/index.php), [SimpleCitizen](https://simplecitizen.com/pricing/), [Immigration Start Guide](https://immigrationstartguide.com/blog/boundless-immigration-review-alternatives)).
   *Confidence:* **Medium.** Prices change; USCIS fees especially are volatile in the current policy environment.

10. **Organic-channel claims (jurisdiction-tool pages survive AI Overviews; Reddit/TikTok reach for life events; funeral-home referral channel).**
    *Source:* The AI-Overview data is inherited from `market-lens.md` (medium confidence there); the *application* to consumer life-event queries is **my extrapolation, not measured** — as is the funeral-home referral hypothesis, which is unvalidated and should be tested with 5 phone calls before being believed.
    *Confidence:* **Low-medium.** This is the largest honest gap: the entire acquisition thesis for SettleKit rests on inference from B2B-oriented SEO data plus general organic-marketing commentary ([HubSpot](https://blog.hubspot.com/marketing/organic-marketing), [Moburst](https://www.moburst.com/blog/app-organic-marketing-strategies-compared/)), not on measured consumer search volumes. Verify with keyword-volume data for 20–30 representative jurisdiction queries before committing.

**Bottom line on verification:** the four checks before any money moves: (a) validate the 2.6M probate filings figure against NCSC/court statistics; (b) estimate Atticus/EstateExec traction (traffic, reviews, funding) to test "underpenetrated"; (c) pull real search-volume data for jurisdiction-specific executor/probate tool queries; (d) call five funeral homes and ask what they hand grieving executors today. And note the meta-verdict does not depend on any of these — even a fully verified SettleKit loses to FleetReady on revenue structure alone.
