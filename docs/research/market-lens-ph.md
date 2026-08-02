# Philippines Market Opportunity Scan (July 2026)

Prepared 2026-07-31 as the third lens after `market-lens.md` (US B2B — pick: FleetReady) and `market-lens-b2c.md` (US B2C — pick: SettleKit, verdict: don't switch). Operator context: Metro Manila-based, UP Diliman background, Filipino/Taglish fluency, local professional/alumni network, capable of in-person sales and support. Same fixed stack and success criteria.

---

## 1. The strategic question first: build FOR the Philippines, or FROM the Philippines for dollar markets?

Quantify it rather than hand-wave it.

**The ARPU gap, in real numbers.** The observable PH SMB price ceiling, anchored by local vendors: Taxumo runs ₱700/mo (annual Professional) to ₱1,888/mo (Micro Business monthly), with SMB corporate filing at ₱2,749/quarter ([Taxumo pricing](https://www.taxumo.com/taxumo-subscription-plans/), [SMB plan](https://www.taxumo.com/smb-plan/)); QNE, a BIR-accredited accounting system, is ₱2,500/mo (~$44) ([QNE](https://qne.cloud/ph/top-5-accounting-software-philippines-for-2026/)); Sprout — the best-funded local HR/payroll player (~$20M raised — [Failory](https://www.failory.com/startups/philippines)) — is reported free for businesses with ≤50 employees ([Wise](https://wise.com/ph/blog/small-business-payroll-software)). So the realistic PH small-business ceiling is **₱1,000–3,000/mo ($17–52)** vs. the US B2B band of $50–300/mo established in the prior scans: a **4–8x ARPU gap**.

**What that does to the $10k MRR math.** US CertShield: ~70 customers. A PH product at ₱2,500/mo needs **~230 customers**; at ₱1,500/mo, **~385**. And the payer pool is smaller than the headline suggests: the Philippines has ~1.2M registered MSMEs (99.6% of all establishments, ~6.3M jobs — [Manila Bulletin/ADB](https://mb.com.ph/2025/11/13/philippine-msmes-keep-growing-despite-challenges-says-adb), [Statista](https://www.statista.com/statistics/1250984/philippines-number-of-msme/)), but the overwhelming majority are micro (<10 workers, ≤₱3M assets — [DTI MSME definitions](https://dtiwebfiles.s3.ap-southeast-1.amazonaws.com/MSME+Resources/2023+Philippine+MSME+Statistics+in+Brief_as+of+22+November+2024.pdf)) and can pay approximately nothing. The segment that can pay — small (10–99 employees) and medium enterprises — is on the order of ~100k businesses nationally (see Claim confidence #4). For scale: the US has 530k *trucking micro-carriers alone*. On top of the ARPU gap sits a **payment-rail tax**: recurring card billing barely functions for PH SMBs (card penetration in the low single digits per my prior Mento research — internal finding, re-verify); B2B collection is invoice + bank transfer/GCash, which means manual dunning overhead per customer, forever.

**What the operator gets in exchange:** in-person distribution nobody in the US market will grant them, zero competition from US indie hackers, Taglish-native support, an alumni/professional network for the first 10 design partners, and domain intuition (already built Clinica Cayanga, QueueMate, and Mento for PH users). These are real — but they are *acquisition* advantages in a market whose *monetization* is structurally capped.

**The third option — PH as SEA/ASEAN beachhead — is mostly a mirage for our product shape.** Compliance-document workflows (the established shape from both prior scans) are jurisdiction-locked: BIR forms, LGU permits, SEC eFAST, and SSS/PhilHealth/Pag-IBIG logic transfer 0% to Indonesia or Vietnam — each expansion is a full regulatory rebuild plus a new distribution network in a language the operator doesn't speak. The beachhead argument only works for horizontal products, and horizontal products fail the defensibility filter everywhere. Treat "regional expansion" claims in any PH plan as decoration, not strategy.

**Provisional answer (finalized in §7):** the PH advantage is real but it is a *discovery and first-logos* advantage, not a *revenue-compounding* advantage. Sections 2–6 test whether any PH product is good enough to overturn that.

---

## 2. PH regulatory forcing functions, graded

Grading each on: (a) genuinely feared, (b) recurring, (c) document-heavy, (d) currently done in spreadsheets/by a liaison, and (e) **real enforcement** — the filter that matters most.

| Obligation | Feared? | Recurring | Doc-heavy | Spreadsheet/liaison today | Enforcement | Verdict |
|---|---|---|---|---|---|---|
| **BIR e-invoicing (EIS)** — mandate now Dec 31, 2026 via RR 26-2025; initial scope = e-commerce taxpayers (excl. micro), Large Taxpayers Service, EOPT-defined large taxpayers; structured JSON to a central system ([Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/philippines-e-invoicing-mandate-extended-new-2026-compliance-deadline/), [Grant Thornton](https://www.grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/ready-or-not-philippines-shift-to-e-invoicing-and-electronic-sales-reporting/)) | Yes | Continuous | Yes | Vendors/ERP | Real but **deadline has slipped repeatedly** (RR 8-2022 → 2026) | Opportunity for the e-commerce cohort; slippage risk |
| **LGU business permit renewal** — Jan 1–20 window; barangay clearance → mayor's permit → BIR Form 0605 by Jan 31; 22% of renewals crammed into the final week; penalties ~25% surcharge + interest, some LGUs daily surcharges ([Triple i](https://www.tripleiconsulting.com/business-permit-renewal-preparing-for-january-2026-rush-philippines/), [BusinessRegistrationPhilippines](https://businessregistrationphilippines.com/business-permit-renewal-understanding-january-2026-surge-philippines/)) | **Genuinely feared** | Annual | Yes | Owner queues in person, or liaison/fixer; micro all-in ₱5k–15k ([Respicio](https://www.respicio.ph/commentaries/business-permit-costs-in-the-philippines-fees-requirements-and-processing-time)) | **Real** — can't legally operate without it | Painful, but the job is partly *physical* (standing in line); software can prep, not file, in most LGUs |
| **SEC GIS/AFS** — mandatory eFAST e-filing; AFS by May 29, 2026 for Dec-FY corps; base fines ₱5k–45k ([Grant Thornton](https://www.grantthornton.com.ph/insights/articles-and-updates1/tax-notes/sec-mc-no-9-2026-guidelines-on-the-filing-of-afs-and-gis/)) | Moderate | Annual | Yes | Accountant/corp-sec | **Weakened**: SEC *suspended monthly penalty accumulation until Dec 31, 2026* to ease doing business ([Manila Bulletin](https://mb.com.ph/2026/05/13/sec-suspends-fines-for-non-filing-of-afs-gis-until-yearend), [CloudCFO](https://cloudcfo.ph/blog/sec-monthly-penalty-suspension-afs-gis-2026/)) | The regulator is actively *reducing* the fear. Poor forcing function right now |
| **SSS / PhilHealth / Pag-IBIG / BIR 1601-C** — after every payroll, four agencies, four portals, four schedules; PhilHealth's window keyed to the last digit of the employer number, Pag-IBIG's to the first letter of the registered name ([Sweldo](https://sweldoph.com/guides/payroll-remittance-deadlines-2026), [TalinoHR](https://talinohr.com/blog/government-remittance-deadlines-2026-calendar)); non-remittance of SSS carries personal/criminal liability ([Respicio](https://www.respicio.ph/commentaries/employer-failure-to-remit-sss-pag-ibig-and-philhealth-contributions)) | Yes | **Monthly** | Yes | Spreadsheets widely ([AYP](https://ayp-group.com/payroll/philippines)) | **Real** (criminal exposure) | Best recurring pain — but sits inside payroll, where Sprout gives the product away free at ≤50 employees |
| **BIR periodic filings** (1601-C, 2550M/Q, 2551Q, 1701/1702 etc., shifting under EOPT taxpayer reclassification) | Yes | Monthly/quarterly | Yes | Bookkeeper or spreadsheet | Real (surcharges, compromise penalties) | The bread-and-butter fear; already the wedge of Taxumo/JuanTax for *filing* — but not for *multi-client practice management* |
| **BOI/PEZA incentives reporting** | Yes | Recurring | Yes | Consultants | Real | Enterprise-sized cohort (thousands of locators), consultant-owned; not reachable by a small team |
| **DTI registration** | No | 5-yearly | Light | Self-serve online | Weak | Not a product |

**One structural finding matters more than any single obligation:** PH MSMEs overwhelmingly *outsource* compliance to bookkeepers, accounting firms, and liaison officers rather than buying software themselves ([NeoWork](https://www.neowork.com/insights/outsourcing-accounting-services-for-small-business-companies-in-the-philippines)). The MSME is often not the software buyer — **the firm that serves 30–100 MSMEs is.** That aggregation is the only clean way around the ARPU cap.

**And one regulatory drag specific to building here:** any system that functions as the accounting/invoicing system of record for a business with >₱3M annual revenue triggers BIR **CAS/PTU registration** — historically involving BIR demos and evaluation by its Computerized System Evaluation Team ([HashMicro](https://www.hashmicro.com/ph/blog/bir-computerized-accounting-system/), [AccountaholicsPH](https://accountaholicsph.com/accounting-software-bir-compliant-books-philippines/)). This is the local "compliance before dollar one" trap: products should be designed to sit *beside* the books (calendars, documents, preparation, tracking), not *be* the books.

---

## 3. Willingness and ability to pay, honestly

- **Micro (~90% of the 1.2M):** ₱0–500/mo, and realistically ₱0. This segment killed Mento's pricing assumptions in my prior PH work (consumer anchors collapsed to ₱70/yr–₱499/mo) and it behaves the same for business tools. Not a market.
- **Small enterprises (10–99 employees):** ₱1,000–3,000/mo ($17–52) for something that visibly prevents penalties or replaces a person's time. Anchors: Taxumo ₱1,888/mo, QNE ₱2,500/mo.
- **Medium & BPOs:** ₱10,000–50,000+/mo is payable but the sales motion becomes procurement/relationship-driven — months per deal, demos, AR chasing. A solo team can close a handful, not hundreds.
- **Accounting/bookkeeping firms:** ₱2,000–6,000/mo is defensible when spread across dozens of clients — the aggregation play.
- **Payment reality:** subscriptions collected by card auto-billing — the US default — mostly don't work; expect invoice + InstaPay/GCash + manual follow-up, i.e., a permanent collections cost per account that US SaaS doesn't carry. (Internal prior from Mento payments research; re-verify current rail penetration.)

---

## 4. Distribution in the Philippines

- **Facebook is the operating system of PH business.** Professional accounting communities such as PATAP (Philippine Accounting, Tax and Audit Professionals) live on Facebook, free to join; PICPA operates through regional chapters, webinars, and conventions ([QuickBooks PH resources](https://quickbooks.intuit.com/ph/resources/accountants/accounting-websites-every-pro-should-be-reading/), [PICPA FB](https://www.facebook.com/PICPAPhilippines/)). Viber/Messenger groups are where operational coordination actually happens.
- **Associations function as distribution:** PICPA chapters (CPD seminar slots are a legitimate wedge — sponsor or speak), PCCI and local chambers, industry associations, and franchise networks. A single association endorsement moves more PH SMB buyers than any amount of SEO.
- **Word-of-mouth is stronger than in the US** — suki (loyalty/repeat-relationship) dynamics and tight professional circles mean reference customers compound; conversely, one public failure travels just as fast.
- **Google SEO matters less but is not zero:** the January permit-renewal query cluster is demonstrably farmed by service providers (Triple i, FilePino, et al. all rank with content — evidence the queries convert to paid engagements).
- **The operator's specific edge:** UP Diliman alumni network across accountancy, law, and business; in-person demos in Metro Manila; Taglish support. This is worth perhaps the first 10–30 customers — material for validation, not for scale.

---

## 5. Ranked PH shortlist — six concrete products

### #1. "PraktisHub" — compliance practice hub for PH bookkeeping & accounting firms

- **One-liner:** A multi-client deadline and document engine for small PH accounting/bookkeeping firms: per-client compliance calendars auto-computed from each client's profile (BIR forms by taxpayer class under EOPT, SEC GIS/AFS dates by anniversary and fiscal year, LGU permit dates, SSS/PhilHealth/Pag-IBIG windows computed from the employer number and registered name), a document vault per client, client chasing via email/Messenger-friendly links, and a firm-wide "what's due this week" dashboard.
- **JTBD replaced:** The firm's master Excel deadline sheet + a partner's memory + frantic client SMS every 10th of the month. This is ClosedBook's shape (validated at ~$9.1M/yr by Keeper/Double in the US) localized to a jurisdiction where no incumbent owns it — JuanTax and Taxumo are *filing rails* aimed at the taxpayer, not practice-management for the firm; US practice tools (TaxDome, Financial Cents) have zero PH deadline logic.
- **Buyer & budget:** Firm principal (CPA), spending firm money; ₱2,500–5,000/mo covering unlimited/tiered clients. The buyer monetizes the tool across 30–100 clients, which is what makes PH ARPU math survivable.
- **Pricing / path to $10k MRR:** ₱2,995/mo (~$52) blended → **~195 firms**. Honest read: PICPA's membership and the outsourced-accounting boom mean thousands of candidate firms exist, but 195 paying firms with manual collections is a 24–36 month grind, not a 12-month one. $10k MRR is *plausible but slow*; ₱30–60k MRR (firm count 20–40) is the realistic year-one outcome.
- **First-100 wedge:** (a) Free artifact tools: "2027 BIR tax calendar generator by taxpayer type," "SSS/PhilHealth/Pag-IBIG deadline computer (enter employer number → get your exact windows)," "SEC GIS due-date checker" — the staggered-window rules are genuinely confusing and artifact-shaped; (b) PATAP and adjacent Facebook groups; (c) PICPA chapter CPD talks ("EOPT reclassification: what changed for your clients' filing calendar"); (d) the operator's UP accountancy alumni network for the first 10 design-partner firms.
- **Competition:** Master spreadsheets (the real incumbent); JuanTax/Juan ([juan.ac](https://www.juan.ac/) — free accounting tier, could move upstream); Taxumo (taxpayer-direct); QNE/Oojeema (books of account, not practice workflow); TaxDome (US, unlocalized). No one owns the firm-side deadline layer.
- **Why now:** EOPT (RA 11976) reclassified taxpayers and reshuffled filing obligations — every firm's calendar logic changed; SEC eFAST is now mandatory; the e-invoicing wave will hit firms' e-commerce clients Dec 2026, and firms will need per-client readiness tracking.
- **Top 3 risks:** (1) Firms are cheap and spreadsheet-attached — conversion from free calendar tools may be brutal; (2) JuanTax/Taxumo adding a practice layer would foreclose the space (they have the accountant relationships); (3) collections friction at ₱3k/mo makes 195 accounts operationally heavy for one person.

### #2. "FranchiseGuard" — location-compliance tracker for PH franchisors

- **One-liner:** HQ dashboard tracking every franchisee location's permits and registrations — mayor's permit, barangay clearance, BIR registration, fire/sanitary certificates, expirations and renewal status — with automated chasing of franchisees. CertShield's shape, transplanted.
- **JTBD replaced:** A franchise-operations officer's spreadsheet + January panic across 50–500 locations; a lapsed permit at one branch is brand damage and closure risk for the franchisor.
- **Buyer & budget:** Franchisor head office — the one PH buyer type with genuine budget concentration (a single sale covers hundreds of locations). ₱8,000–20,000/mo depending on location count.
- **Path to $10k MRR:** ~45–70 franchisors at ₱10–12k/mo. The Philippine Franchise Association ecosystem plausibly contains enough brands (PH is one of Asia's most franchise-dense markets — see Claim confidence #10), but this is a relationship-sales motion: expos, PFA events, referrals.
- **First-100 wedge:** PFA membership/expo presence; franchise consultants as referrers; the operator's in-person Metro Manila capability is genuinely decisive here.
- **Competition:** None identified locally doing location-compliance specifically (franchise management tools exist globally but not PH-permit-aware). Verify before believing.
- **Why now:** Post-pandemic franchise expansion + January 2026's documented permit crunch make HQ-level visibility saleable.
- **Top 3 risks:** (1) Sales-cycle heaviness caps growth at solo capacity; (2) franchisors may push the cost down to franchisees who won't pay; (3) small honest TAM — this is a ₱5–15M/yr business, likely not more.

### #3. "eResibo" — e-invoicing readiness and issuance for e-commerce sellers

- **One-liner:** EIS-compliant invoice generation and transmission (BIR JSON schema) for the December 31, 2026 mandate cohort — online sellers above the micro threshold who currently invoice from Excel/Shopee dashboards.
- **Why it ranks only #3 despite the hardest forcing function:** (1) the deadline has already slipped from 2022 to 2026 and could slip again ([Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/philippines-e-invoicing-mandate-extended-new-2026-compliance-deadline/)) — a business built on a deadline the regulator keeps moving is a business built on sand; (2) the mandate cohort skews large (LTS taxpayers served by Comarch/RTC/ClearTax-class vendors); (3) sitting in the invoice path invites the CAS/PTU accreditation trap; (4) micro sellers — the mass market — are explicitly *excluded* from the mandate, removing the long tail.
- **Pricing / $10k MRR:** ₱800–1,500/mo → 400+ customers. Implausible locally before the mandate actually bites.
- **Wedge:** Seller Facebook groups (massive), Shopee/Lazada seller communities, "am I covered by the e-invoicing mandate?" checker tool.
- **Top 3 risks:** deadline slippage; platform players (Shopee/Lazada/PayMongo) bundling invoicing natively ([PayMongo already publishes invoicing content](https://www.paymongo.com/blog/best-philippine-invoicing-software)); BIR technical-spec churn.

### #4. "PermitPilot" — LGU business-permit renewal prep kit

- **One-liner:** Per-LGU requirements checklist, document assembly, gross-sales declaration worksheet, and deadline reminders for the January 1–20 window; sold seasonally to SMEs or year-round to bookkeepers/liaison services.
- **Honest problems:** 1,600+ LGUs with divergent processes and paper-based steps; the binding constraint is *standing in line*, which software cannot do; revenue is savagely seasonal (one January per year); the natural buyers (liaison services like FilePino/Triple i) are also the natural competitors. ₱500–1,500 one-time per renewal → thousands of transactions needed for $10k/mo. The B2C one-time logic from `market-lens-b2c.md` applies, but at PH price points the volume requirement becomes implausible.
- **Verdict:** best as a *feature* of #1 (firms do renewals for clients) than a standalone product.

### #5. "RemitReady" — statutory contributions engine for 10–100-employee SMEs

- **One-liner:** Computes SSS/PhilHealth/Pag-IBIG/1601-C amounts and generates each agency's remittance schedule and reports — without being a full HRIS.
- **Why ranked low:** the pain is real and monthly (four portals, staggered windows, criminal exposure) but the space is the most crowded in PH SaaS — Sprout (free ≤50 employees), GreatDay, KAMI, TalinoHR, Salarium lineage, and every payroll outsourcer ([GreatDay](https://greatdayhr.ph/blog/sss-philhealth-pagibig-2026-contribution-changes/), [KAMI](https://kamiworkforce.com/ph/blog/sss-philhealth-pagibig-contribution-tables-2026/)). Competing against funded free is the small-landlord trap from the B2C scan, localized.

### #6. "GISFile" — SEC GIS/AFS preparation and eFAST filing assistant

- **One-liner:** Guided GIS/AFS package prep + eFAST submission tracking for small corporations and the corp-sec/law offices that file for them.
- **Why ranked last:** the SEC just *suspended* monthly penalty accumulation until end-2026 to promote ease of doing business ([Manila Bulletin](https://mb.com.ph/2026/05/13/sec-suspends-fines-for-non-filing-of-afs-gis-until-yearend)) — the regulator is dialing the fear *down*, which is the opposite of a forcing function. Annual frequency, accountant-mediated, low fear = weak product. Fold into #1 as a module.

---

## 6. Top PH recommendation: #1 — PraktisHub (compliance practice hub for accounting firms)

**The case.** It is the only PH candidate that survives the three structural problems of this market simultaneously: (1) it routes around the ARPU cap by selling to the *aggregator* (one firm = 30–100 MSMEs' compliance calendars); (2) it matches the strongest genuine enforcement surfaces (BIR filings, statutory remittances) without sitting in the CAS-accreditation blast radius (it manages deadlines and documents; it is not the books); (3) it is distributable through exactly the channels the operator can actually reach — PATAP/Facebook, PICPA chapters, and a UP accountancy alumni network — with artifact-shaped free tools (deadline computers, calendar generators) that match how PH professionals actually search and share. The why-now is real: EOPT reclassification scrambled every firm's per-client filing calendar, and the Dec 2026 e-invoicing wave gives firms a client-readiness tracking problem they don't currently have tooling for.

**Against the runners-up:** FranchiseGuard has better per-deal economics but caps at solo sales capacity and an honestly small TAM; eResibo is hostage to a deadline that has already slipped four years; PermitPilot fights physics (queues) and seasonality; RemitReady fights funded-free; GISFile's fear factor was just suspended by the regulator.

**The strongest argument against PraktisHub:** the path to $10k MRR requires ~195 paying firms at ₱3k/mo with manual invoice-and-follow-up collections, in a market where the best-capitalized local SaaS company concluded it had to give its product away free to win the ≤50-employee segment. If Sprout couldn't charge them, the prior that small PH firms will pay ₱36k/yr for a calendar-and-documents layer is genuinely uncertain — and JuanTax, which already owns accountant relationships and a free accounting tier, could ship a practice layer in a quarter. I still rank it first *within the Philippines* because it is the only candidate whose unit economics can work at all, and its free-tool wedge produces validation data cheaply. But ranking first in a weak field is not an endorsement — see §7.

---

## 7. The meta-question, answered without diplomacy or patriotism

**Does the best PH idea beat CertShield? No. It is not close, and the honest recommendation for a Manila-based operator is: build for dollar markets from Manila.**

| Dimension | CertShield (US COI tracking) | PraktisHub (PH firms) |
|---|---|---|
| Customers to $10k MRR | ~70 @ ~$145 | ~195 @ ~$52 |
| Collections | Stripe auto-billing | Invoice + bank transfer/GCash + chasing |
| Buyer's alternative cost | One uncovered claim (catastrophic) | Penalties the buyer already knows how to dodge cheaply |
| Competitive foreclosure risk | TrustLayer drifting down | JuanTax/Taxumo one release away |
| Free-money distortion | None | Sprout precedent: winning segment = giving product away |
| Revenue ceiling if you win | $50–100k+ MRR path exists | Realistically ~₱1.5–3M/mo (~$25–50k) ceiling, slower |
| Operator's local edge | Irrelevant | Worth the first ~10–30 customers |

The PH advantages — in-person sales, Taglish, alumni network, no indie-hacker competition — are all *front-of-funnel* advantages. Every *back-of-funnel* variable (ARPU, collections, churn tolerance, expansion revenue, exit multiple) is 3–8x worse. Needing 2.8x the customers at 3x the servicing cost per customer is not a different flavor of the same business; it is a strictly harder business with a lower ceiling. And the geographic arbitrage runs the other way with brutal clarity: a Manila cost base spending dollar revenue is the single biggest structural advantage this operator has — PH software salaries and living costs against US SaaS pricing means FleetReady/CertShield revenue is worth 3–5x more *in purchasing power* to this operator than to a US-based competitor. The Philippines' own SaaS ecosystem points the same direction: local founders collectively generate ~$492M in revenue ([Latka](https://getlatka.com/companies/countries/philippines)) with the standouts (Sprout et al.) being those who survived the local ARPU problem via scale funding — a path unavailable to a bootstrapper.

**The nuanced version, which is still blunt:** use the Philippines for what it is uniquely good at giving this operator — cheap, fast, in-person *validation* and, if desired, a small PraktisHub-style side product run through the accountant network as a low-burn learning vehicle. But the flagship bet should remain FleetReady (unchanged through three scans), with CertShield and SettleKit as fallbacks, all dollar-denominated, all built from Manila. US async SaaS support hours are compatible with PH time zones; the compliance-document product shape the operator has now validated three times does not require US physical presence.

**Final standing after three lenses: FleetReady (US, B2B) > CertShield (US, B2B) ≈ SettleKit (US, B2C) > PraktisHub (PH) — build from Manila, sell in dollars.**

---

## Claim confidence

PH market data is markedly thinner and lower-quality than US data — more of this report rests on vendor blogs, consultancy content-marketing, and my own priors than the US scans did. Sourced vs. assumed, ordered by load-bearing weight:

1. **PH SMB software price ceiling ₱1,000–3,000/mo (Taxumo ₱700–1,888/mo; QNE ₱2,500/mo; Sprout free ≤50 employees).**
   *Sources:* [Taxumo's own pricing pages](https://www.taxumo.com/taxumo-subscription-plans/) (first-party — **high** on those numbers); QNE via [its own blog](https://qne.cloud/ph/top-5-accounting-software-philippines-for-2026/) (**medium**); Sprout-free-≤50 via a single [Wise article](https://wise.com/ph/blog/small-business-payroll-software) (**low-medium — verify directly**; if wrong, the "funded-free distortion" argument weakens but the ARPU gap conclusion survives on Taxumo/QNE alone).
2. **E-invoicing mandate: Dec 31, 2026 deadline via RR 26-2025; scope = e-commerce (excl. micro) + LTS + EOPT large taxpayers.**
   *Sources:* [Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/philippines-e-invoicing-mandate-extended-new-2026-compliance-deadline/), [Grant Thornton PH](https://www.grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/ready-or-not-philippines-shift-to-e-invoicing-and-electronic-sales-reporting/) — compliance vendors and a Big-Practice tax desk, consistent with each other. **Medium-high** on current state; **low** on the deadline holding, given the documented 2022→2026 slippage. Verify RR 26-2025 text directly at bir.gov.ph before building anything on it.
3. **SEC monthly-penalty suspension until Dec 31, 2026 (base fines ₱5k–45k remain).**
   *Sources:* [Manila Bulletin](https://mb.com.ph/2026/05/13/sec-suspends-fines-for-non-filing-of-afs-gis-until-yearend), [CloudCFO](https://cloudcfo.ph/blog/sec-monthly-penalty-suspension-afs-gis-2026/), [Grant Thornton](https://www.grantthornton.com.ph/insights/articles-and-updates1/tax-notes/sec-mc-no-9-2026-guidelines-on-the-filing-of-afs-and-gis/). **Medium-high** — national press + two professional-services sources. This is what demotes GISFile.
4. **MSME structure: ~1.2M MSMEs, 99.6% of establishments, ~6.3M jobs; payer pool ~100k small+medium businesses.**
   *Sources:* [Manila Bulletin/ADB](https://mb.com.ph/2025/11/13/philippine-msmes-keep-growing-despite-challenges-says-adb), [Statista](https://www.statista.com/statistics/1250984/philippines-number-of-msme/), [DTI definitions](https://dtiwebfiles.s3.ap-southeast-1.amazonaws.com/MSME+Resources/2023+Philippine+MSME+Statistics+in+Brief_as+of+22+November+2024.pdf). Headline counts **medium-high**. The **~100k small+medium figure is my extrapolation** from the standard DTI split (~90% micro / ~9% small / ~0.5% medium) — the exact split was *not* returned in this scan's results. **Low-medium; verify against the current DTI Statistics in Brief before quoting.**
5. **January permit-rush mechanics: Jan 1–20 window, 22% processed in final week (attributed to DILG), ~25% penalty + surcharges, micro all-in cost ₱5k–15k.**
   *Sources:* consultancy content-marketing ([Triple i](https://www.tripleiconsulting.com/business-permit-renewal-preparing-for-january-2026-rush-philippines/), [BusinessRegistrationPhilippines](https://businessregistrationphilippines.com/business-permit-renewal-understanding-january-2026-surge-philippines/), [Respicio law commentary](https://www.respicio.ph/commentaries/business-permit-costs-in-the-philippines-fees-requirements-and-processing-time)) — all parties selling renewal services, motivated to dramatize. **Low-medium** on specific figures; **high** on the general phenomenon (it is common knowledge for any PH operator, including this one).
6. **Statutory remittance complexity: four agencies/portals/schedules; PhilHealth window by employer-number last digit, Pag-IBIG by registered-name first letter; criminal exposure for SSS non-remittance.**
   *Sources:* multiple independent payroll vendors ([Sweldo](https://sweldoph.com/guides/payroll-remittance-deadlines-2026), [TalinoHR](https://talinohr.com/blog/government-remittance-deadlines-2026-calendar), [Respicio](https://www.respicio.ph/commentaries/employer-failure-to-remit-sss-pag-ibig-and-philhealth-contributions)). **Medium-high** — consistent across vendors with no reason to fabricate mechanics.
7. **CAS/PTU registration required above ₱3M revenue; vendor demo/evaluation burden.**
   *Sources:* [HashMicro](https://www.hashmicro.com/ph/blog/bir-computerized-accounting-system/), [AccountaholicsPH](https://accountaholicsph.com/accounting-software-bir-compliant-books-philippines/) — vendor/practitioner blogs. **Medium** on the requirement existing; **low-medium** on current procedural details (BIR moved toward registration-in-lieu-of-accreditation in recent years and the process keeps changing). Verify current RMC before designing product boundaries around it — though the "stay out of the books" design principle is robust either way.
8. **Distribution claims: PATAP/Facebook groups, PICPA chapters as channels; Facebook/Viber as the de facto PH business OS; suki word-of-mouth strength.**
   *Sources:* thin — [QuickBooks PH](https://quickbooks.intuit.com/ph/resources/accountants/accounting-websites-every-pro-should-be-reading/) for PATAP/PICPA existence; the rest is **my unsourced local-market prior plus the operator's presumed lived experience**. **Low-medium as sourced fact, but high face-validity for this specific reader.** The CPD-talk wedge is a hypothesis, not a documented channel.
9. **PH payment-rail friction (card penetration in low single digits; recurring billing weakness; invoice+GCash norm).**
   *Source:* **internal prior from my earlier Mento payments research in prior sessions — not re-sourced in this scan.** **Low-medium; re-verify with current BSP digital-payments data** before it drives any pricing/collections design.
10. **FranchiseGuard TAM ("one of Asia's most franchise-dense markets," PFA brand counts).**
    *Source:* **general knowledge, not sourced in this scan.** **Low.** Verify PFA membership and active-brand counts before ranking FranchiseGuard above #3.
11. **PH SaaS ecosystem revenue (~$492M collective; Sprout ~$20M raised; ~722 startups).**
    *Sources:* [Latka](https://getlatka.com/companies/countries/philippines) (scraped estimates), [Failory](https://www.failory.com/startups/philippines), [Abovea](https://abovea.tech/philippines-startup-statistics/). **Low-medium** — directional color only; nothing decision-critical rests on these.
12. **The meta-verdict's arithmetic** (customer counts, ARPU multiples, purchasing-power arbitrage) is **my own derivation** from items 1 and 4 plus the prior scans' US price points. The *conclusion* (build for dollars from Manila) is robust to substantial error in any single input: PraktisHub would need PH firms to pay ~3x the observed local anchor price before the comparison flips, and no evidence found in this scan supports that.

**Bottom line on verification:** the four checks before any PH commitment: (a) confirm the DTI small+medium enterprise count (the real payer pool); (b) confirm Sprout's current free-tier policy (the funded-free distortion); (c) interview 10 small accounting firms on what they'd pay for a per-client deadline engine — the entire PraktisHub case lives or dies here and costs two weeks to test through the operator's own network; (d) read RR 26-2025 at source. None of these checks, however, can overturn §7 — they can only decide whether PraktisHub is worth running as a side vehicle.
