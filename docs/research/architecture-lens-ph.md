# Building from the Philippines: The Systems/Economics View

**Lens:** same as the prior two reports — buildability, operability, margin, defensibility for a tiny AI-assisted team on Next.js 15 + Supabase + Vercel — now with the operator physically in the Philippines and the PH market on the table. Companion to `architecture-lens.md` (B2B) and `architecture-lens-b2c.md`. Date: 2026-07-31. Exchange rate used throughout: **~₱61/USD** (2026 has ranged ₱57.5–62, trending weaker — [exchange-rates.org 2026 history](https://www.exchange-rates.org/exchange-rate-history/usd-php-2026), [30rates July 2026](https://30rates.com/usd-to-php-forecast-today-dollar-to-philippines-peso)).

**Headline before the detail:** the currency mismatch is real but it is not where the damage is. Inference and platform costs stay affordable even against PHP revenue *if the AI is bounded*. What actually breaks is (a) the revenue ceiling — identical engineering earns ~9x less per customer — and (b) the payment rails, where card-on-file auto-renewal, the engine of Western SaaS, mostly does not exist. The blunt answer to §7 is: **build for USD markets, live on PHP costs**. The full argument follows.

---

## 1. The currency mismatch, quantified

### The floor

The platform floor from the B2B report — Supabase Pro ~$25 + Vercel Pro ~$20–70 ≈ **$50–100/mo** — converts to **₱3,050–6,100/mo**. Against a PHP 1,000/mo product netting ~₱950 after PSP fees, that's **4–7 local customers just to cover infrastructure**, versus a single customer of a $149/mo US product. Annoying but survivable — the floor is not the problem.

### The per-customer LLM budget — where the 10x compression bites

Same inference, different denominator:

| | US B2B ($149/mo) | PH SMB (₱1,000/mo ≈ $16.40) |
|---|---|---|
| 100 doc-extractions/mo on **Sonnet 5** ($0.02–0.03 ea) | $2–3 → **1.3–2% of revenue** | $2–3 → **12–18% of revenue** |
| 100 doc-extractions/mo on **Haiku 4.5** (~$0.013 ea) | ~$1.30 → ~1% | ~$1.30 → **~8%** |
| 500 extractions/mo on Sonnet | $12.50 → 8% | $12.50 → **76% — dead** |

(Model prices per the B2B report: Haiku 4.5 $1/$5, Sonnet 5 $2/$10 per M tokens — [BenchLM](https://benchlm.ai/anthropic/api-pricing).)

**Verdict on the document-extraction shape: still viable, but only in its cheapest configuration.** At PHP price points the shape must be:

- **Haiku-first routing** with Sonnet reserved for low-confidence escalation (a cascade, not a default) — this alone halves-to-thirds the COGS line;
- **Prompt caching mandatory** (cached input at ~10% of rate) — system prompts and grounding corpora are the bulk of input tokens;
- **Batch API for anything non-interactive** (50% off);
- **Hard usage caps in the plan**, expressed in documents, from day one — the 500-doc scenario above is a real customer, not a hypothetical.

One asymmetry that compounds quietly: **your costs are USD and the peso is depreciating** (₱57.5 → ~₱62 across 2026). PH price points are sticky in PHP; your COGS inflate ~5–8%/year in PHP terms without you touching anything. A USD-revenue business gets the same drift as a *tailwind* on its PH cost base.

### The ceiling — the number that actually decides this

100 customers at ₱1,000/mo = ₱100,000/mo ≈ **$1,640/mo**. The same 100 customers at $149/mo = **$14,900/mo**. Identical code, identical support load, identical operational attention — the scarce resource — earning **~9x less**. Hold that number for §7.

---

## 2. Payment rails — the hard constraint

### Stripe directly from the Philippines: functional but hobbled

Stripe has been usable by PH businesses since ~2021 but the Philippines is not a fully supported country: PH accounts can accept card payments, but **payouts are PHP-only to a PH bank, USD payments are force-converted to PHP (FX loss on every transaction), and adjacent products (e.g., Shopify Payments) are unavailable** ([HynoGo overview](https://hynogo.com/blog/is-stripe-available-in-philippines-2026), [StartGlobal](https://startglobal.co/us/international/philippines/stripe/)). Treat native Stripe-from-PH as a degraded option, not a plan.

### The local PSPs, compared on what actually matters

| Rail | Recurring/auto-billing | Fees | Settlement | Onboarding |
|---|---|---|---|---|
| **PayMongo** | **Yes — cards and Maya wallet**; GCash recurring only via support, effectively not self-serve ([Subscriptions API docs](https://developers.paymongo.com/docs/subscriptions-api)) | Cards 2.5–3.5% + ₱15; no setup/monthly fees ([PayMongo pricing](https://www.paymongo.com/pricing)) | 2–7 days standard | DTI/SEC registration + bank account; sole prop OK |
| **Xendit** | Yes — recurring billing product; cards, direct debit | Cards 2.9% + ₱15; e-wallets ~2.5%; direct debit 1.5% + ₱20 ([Xendit pricing](https://www.xendit.co/en/pricing/), [HitPay comparison](https://hitpayapp.com/blog/philippines-payment-gateway-comparison)) | E-wallets T+2 | Business registration; also operates in Indonesia (SEA expansion rail) |
| **Maya Business** | Maya wallet is the one e-wallet that auto-recurs (via PayMongo) | QR Ph 1.5%, cards 3.2–3.5%, no setup/monthly ([HitPay](https://hitpayapp.com/blog/qr-ph-gcash-maya-payment-methods-philippines)) | Days | Straightforward |
| **GCash (business)** | **Effectively no reliable auto-recurring** — subscription failures are endemic and documented even for Spotify-scale merchants ([GCash help center](https://help.gcash.com/hc/en-us/articles/31317899325721-Online-payment-or-subscription-error), [Spotify community threads](https://community.spotify.com/t5/Premium-Family/GCash-Payment-for-Family-Premium-always-failed/td-p/4919030)) | QR ~1.0% MDR — cheapest acceptance | Days | Straightforward |
| **Dragonpay** | No — OTC/cash-in is inherently per-transaction | ~₱15–20 fixed per OTC txn; ₱36,000 setup currently waived for PH merchants ([Dragonpay waived fees](https://www.dragonpay.ph/waived-fees/)) | Days | Merchant agreement |
| **PayPal PH** | Yes (subscriptions) | ~4.4% + fixed on international commercial receipts, plus a 3–4% FX spread converting USD→PHP on withdrawal ([Hurupay guide](https://hurupay.com/blog/how-to-receive-and-withdraw-money-on-paypal-in-the-philippines), [PayPal PH seller fees](https://www.paypal.com/ph/business/paypal-business-fees)) | Days to bank | Easy |

The structural takeaway: **the only self-serve auto-recurring rails in the PH are cards (low penetration) and Maya wallet. GCash — the wallet the mass market actually uses — cannot be relied on for subscriptions.** That single fact reshapes the whole revenue model (§4).

### The foreign-entity route: US LLC via Stripe Atlas

- **Formation: $500 one-time** (filing, EIN, registered agent year 1) ([Stripe Atlas guides](https://guptadeepak.com/startup-offers/guides/stripe-atlas)). Ongoing: Delaware LLC franchise tax ~$300/yr, registered agent ~$100/yr after year 1, and — the one that bites — **Form 5472 annually for a foreign-owned single-member LLC, with a $25,000 penalty for failure to file**; CPA support runs $1,500–3,000/yr ([BusinessAnywhere comparison](https://businessanywhere.io/stripe-atlas-vs-forming-your-own-llc/), [Tax Haven Directory](https://taxhavendirectory.com/blog/stripe-atlas-vs-us-llc-non-residents)).
- **All-in: ~$1,000–1,500 year one, ~$2,000–3,500/yr steady state with a CPA.** For that you get full Stripe (USD payouts to a Mercury-style US account, subscriptions, Radar, the works) and a US-facing storefront.
- **Tax reality check:** a non-resident-owned single-member LLC with no US-source effectively-connected income typically owes no US federal income tax — but **the Philippines taxes resident citizens on worldwide income**, so the LLC's profits are PH-taxable to the operator regardless. The entity buys payment rails and market access, not a tax holiday. (Confirm specifics with a PH tax professional — this is the one paragraph in this report that needs one.)
- **Verdict:** if the market is USD, this is simply the cost of doing business — ~1 month of one US B2B customer's revenue per year. If the market is PH, skip it; PayMongo/Xendit + local registration is correct.

---

## 3. Infrastructure, latency, and the Data Privacy Act

- **Regions:** Supabase `ap-southeast-1` (Singapore) and Vercel `sin1` are the nearest regions; there is no PH region for either. Manila↔Singapore is one of the best-served submarine routes in SEA — realistic RTT is ~40–70ms, and Singapore is the standard choice for serving PH users ([Supabase regions overview](https://dl.iir.edu.ua/iir-news/supabase-regions-explained-1764802739)). The one architectural rule: **colocate Vercel function execution in `sin1` with the Singapore Supabase instance** — a US-region function talking to a Singapore database adds 180ms+ per DB roundtrip and is the classic misconfiguration ([real-world example](https://dev.to/thexdev/slowed-by-region-24d2)). Static/ISR assets serve from Vercel's edge near the user regardless. For a CRUD SaaS, 50–70ms to origin is a non-issue.
- **PH-market frontend reality:** mobile-first, mid/low-end Android, variable bandwidth — payload discipline (small bundles, ISR, no heavy client JS) matters more here than in US markets. Resist the temptation of offline-first sync architecture unless the product truly demands it; it's a small-team killer per the B2B report's kill-list.
- **Data Privacy Act of 2012 (RA 10173): no data-localization requirement.** The DPA requires accountability, security safeguards, and lawful-transfer conditions — hosting in Singapore is fine. What a small operator actually owes the NPC:
  - **Designate a DPO** (can be the operator) — required for every personal-information controller regardless of size;
  - **Mandatory NPC registration only if**: ≥250 employees, **or processing sensitive personal information of ≥1,000 individuals**, or risky processing. Below that: a notarized **Sworn Declaration of Exemption** plus the **Annual Security Incident Report** ([NDV Law guide](https://ndvlaw.com/a-ceos-guide-to-registration-of-data-processing-system-with-the-national-privacy-commission-part-1-legal-foundations-and-mandatory-requirements/), [Respicio compliance guide](https://www.respicio.ph/commentaries/compliance-guide-for-npc-registration-and-data-privacy-act-requirements-for-businesses), [DLA Piper PH](https://www.dlapiperdataprotection.com/?t=registration&c=PH)).
  - **The architectural trap inside that threshold:** "sensitive personal information" under the DPA includes health data and **government-issued IDs** (TIN, PhilHealth, SSS numbers). A PH SaaS that stores customers' government IDs crosses the 1,000-individual line fast and inherits full registration + DPS declarations. Design rule: **don't store government IDs unless the product's value depends on them** — and if it does (clinics, payroll), budget the NPC registration work up front. This is days of paperwork, not months of engineering — but it's before-first-dollar work for health products (see idea 5).

---

## 4. Collection and churn mechanics: subscription SaaS without reliable auto-renewal

Card penetration is low and wallet-dominant payment culture plus unreliable GCash auto-debit means **involuntary churn replaces voluntary churn as the dominant failure mode** for monthly card-on-file billing. What PH software vendors actually do:

- **Annual or quarterly prepaid invoicing**, paid by bank transfer (InstaPay/PesoNet), GCash, or OTC — one collection event per customer per year instead of twelve;
- **Prepaid credits/top-ups** — culturally native (the entire telecom market runs on prepaid load): customer buys ₱X of credits via a payment link, consumes them, tops up. No renewal event exists to fail;
- **Per-cycle payment links** (PayMongo/Xendit generate these) with webhook-driven auto-reconciliation — the customer clicks and pays each cycle rather than being auto-debited.

**Is manual reconciliation a hidden full-time job? At monthly billing with bank transfers, yes.** Bank transfers arrive with no usable reference; customers send GCash screenshots as proof of payment; someone must match, chase, and re-invoice. At 100+ customers on monthly manual billing that's realistically 1–2 days/week of the operator's time — the exact resource this team cannot spend. The architecture answer, in priority order:

1. **Price annually-prepaid by default** — 12x fewer collection events, and the discount you give for annual is cheaper than the labor it saves;
2. **Model billing as a prepaid credit ledger in Postgres** (the same token-ledger pattern from the B2C report, promoted to the billing system itself) — top-ups via PSP payment links whose webhooks credit the ledger automatically;
3. **Accept auto-recurring only on the rails where it actually works** (cards + Maya via PayMongo/Xendit) as a convenience tier, never as the assumed default;
4. **Never accept unreferenced bank transfers** — every invoice gets a unique payment link; manual reconciliation is reserved for the exceptions, not the flow.

Done this way, PH collections are an engineering problem you solve once, not an ops job you do forever. Done the default Western way (monthly card-on-file), the model quietly fails — not as visible churn, but as an ever-growing pile of "payment failed, will fix later" accounts.

---

## 5. Candidate ideas that survive PH economics

Selection pressure applied: bounded Haiku-class AI, annual-prepaid or credit-ledger billing, and — the PH-specific screen — **customers who either earn USD or are forced to spend by compliance**. Discretionary PHP-denominated spend is the thinnest budget in the market.

### 1. BIR tax-compliance copilot for freelancers and solo professionals — ₱2,500–4,000/yr, prepaid annual

The Philippines has one of the world's largest online-freelancer populations, largely earning USD from foreign clients, all facing quarterly BIR obligations (1701Q, 2551Q, registration, books of accounts, official receipts) through notoriously painful tooling. Compliance is forced, deadlines are hard, and this customer segment has the highest willingness-to-pay in the PH market because their income is dollar-denominated. Taxumo's existence validates paid demand.

- **System:** income/receipt upload → Haiku extraction into a transactions ledger → 8%-vs-graduated regime comparison, quarterly tax computation, pre-filled form guides (user files; you are not an accredited e-filer) → `pg_cron` deadline reminder engine → static SEO pages per form/deadline/scenario (BIR-deadline content is evergreen, high-intent search).
- **Hardest technical problem:** the BIR rules engine — forms, thresholds, and deadlines change by revenue regulation, and correctness failures are trust-fatal. This is a maintenance treadmill requiring PH tax knowledge, not code. (It is also the moat — see below.)
- **Marginal cost:** ~30 receipt extractions/mo on Haiku ≈ $0.40/mo ≈ ₱24 ≈ **~10% of an annualized ₱3,000 plan** — acceptable; caching and batch push it lower.
- **Risk:** platform ~zero (user documents, public rules). Compliance: financial data but not government-ID-heavy if TIN storage is avoided/encrypted; DPA hygiene tier. Product risk: BIR's own modernization (e-invoicing, ORUS) slowly absorbing the pain; incumbent Taxumo.
- **Moat:** rules-engine grind + accumulated multi-year financial history per user (system-of-record gravity — switching means losing your books).
- **Build to paid MVP:** 6–8 weeks, plus ongoing tax-rule upkeep.

### 2. PhilGEPS procurement monitoring and bid-prep for SMB suppliers — ₱1,500–3,000/mo (or annual)

Government procurement postings are public; SMB suppliers manually trawl them. This is the trademark-watch shape from the B2B report transplanted: **batch-shared monitoring, near-zero marginal cost**.

- **System:** scheduled ingest of public tender postings → normalize into Postgres → embedding match against each subscriber's supplier profile → batched Haiku summarization of matched tenders (50% batch discount, shared across users) → email digests + requirement checklists (mayor's permit, PhilGEPS registration class, etc.) → static SEO pages per category/agency.
- **Hardest technical problem:** ingestion robustness against a government portal with no guaranteed API — verify access terms and build the scraper defensively; this is the gray zone of the idea.
- **Marginal cost per subscriber:** **pennies** — the only PH subscription shape where ₱1,500/mo is nearly all margin.
- **Risk:** ingestion fragility (portal changes); moat is the normalized tender corpus + checklists; money-at-stake buyer (a single won contract pays for years of subscription).
- **Build:** 4–6 weeks.

### 3. HOA/condo dues billing and reconciliation — priced per door, ₱10–20/door/mo, billed to the association

The PH collections problem (§4) *as the product*: HOAs and small property managers collecting monthly dues from hundreds of homeowners via bank transfer and GCash screenshots live in exactly the reconciliation hell described above. Sell the cure.

- **System:** unit/homeowner ledger in Postgres → auto-generated per-cycle PayMongo/Xendit payment links per homeowner → webhook auto-reconciliation → arrears dashboards, statements, notice generation (Haiku for letter drafting — trivial COGS) → officer/auditor read-only views.
- **Hardest technical problem:** the reconciliation edge cases (partial payments, advance payments, unreferenced transfers) — a bounded but fiddly accounting-correctness problem.
- **Marginal cost:** ~zero AI; PSP fees are passed through in the dues. A 200-door association = ₱2,000–4,000/mo revenue, and associations are sticky for the same reason banks are.
- **Risk:** PSP dependency (Tier 3); collections-adjacent support load (homeowner disputes land on the association, but some leak to you). Strong system-of-record moat — years of dues history.
- **Build:** 6–8 weeks.

### 4. Back-office for PH agencies serving foreign clients (VA firms, bookkeeping/design shops) — **priced in USD**, $49–149/mo

The hybrid play: the customer sits in Manila but earns in dollars — PH-domain product, USD-revenue economics. Client portal, engagement/timesheet tracking, USD invoicing (via the customer's own Stripe/Wise/PayPal), margin dashboards per client, contractor document management (avoid storing government IDs; link, don't hold). Deliberately **not** payroll — payroll is a regulatory pit.

- **Hardest technical problem:** staying out of scope creep toward payroll/EOR; the product line must be drawn at "records and invoices," never "moves money."
- **Marginal cost:** bounded document AI, <1% of a USD price. **Risk:** low platform, low compliance if ID-storage is avoided. Moat: moderate (workflow + client history). **Build:** 5–7 weeks.

### 5. Small-clinic EMR — evaluated honestly, because it's the obvious local idea

Small PH clinics run on paper; PhilHealth documentation is a real burden. But this idea carries every weight the others avoid: **health data is DPA sensitive personal information, so ≥1,000 patient records triggers mandatory NPC registration and DPS declarations before meaningful scale**; clinic software budgets are thin and PHP-denominated; sales are in-person and slow; and the buyer's tolerance for downtime during clinic hours creates a soft SLA. It is a viable *business* for someone committed to the vertical with feet on the ground — it is a poor fit for the *operational-attention-scarce* profile this series optimizes for. If pursued anyway: NPC registration budgeted up front, aggressive minimization of stored IDs, annual-prepaid pricing, and no realtime features.

---

## 6. Top pick, the argument against, and the PH-specific trap

### Pick: **the BIR tax-compliance copilot** (idea 1), with idea 2 as the low-risk second bet

It is the only idea that clears every PH-specific filter simultaneously: compliance-forced demand with hard quarterly deadlines (no "nice-to-have" budget battle), the one PH customer segment with USD income and proven willingness to pay, annual-prepaid billing that sidesteps the recurring-rails problem entirely, bounded Haiku-class COGS that survive PHP price points, an evergreen SEO surface, and a moat made of exactly the thing that deters cloners — grindy, always-current BIR rules knowledge plus multi-year user financial history.

**Strongest argument against it:** the moat and the millstone are the same object. The BIR rules engine demands permanent, expert, non-delegable maintenance — a regulation misread once, at scale, during filing week, is a trust-extinction event; and the BIR's own digitization could compress the pain the product monetizes. I pick it anyway because the treadmill is precisely what keeps this from being a weekend clone, the failure mode is bounded by positioning (preparation and reminders — the user files; you are never the filer of record), and incumbent traction proves the demand survives alongside government tooling.

### The PH-specific trap: **the sari-sari store / micro-retail digitization app**

The most tempting idea in the country — ~1.3 million sari-sari stores, a genuine inventory-and-credit (utang ledger) pain, endlessly pitched. It fails every filter at once: near-zero PHP willingness-to-pay against USD costs; a hard **offline-first requirement** on low-end Android (the architecture kill-list's realtime-sync problem, worn as a disguise); distribution that requires physical field operations, not SEO; and the only proven monetization — selling shelf data to CPG brands — requires scale and a field force before the first peso, which is a venture-funded play, not a solo one. Refuse it in all its costumes (karinderya POS, tricycle-fleet apps, palengke marketplaces).

Runner-up traps, refused for the record: **anything that moves money** (lending, remittance, wallet aggregation — BSP licensing and collections operations, both fatal solo), and **mass-market ₱99/mo consumer apps** (the B2C report's compression math, roughly squared).

---

## 7. The blunt answer: is building for the PH market economically rational?

**No — not as a primary strategy. Build for USD markets and enjoy the cost-base arbitrage. The geography argument runs one way:**

- Identical engineering and identical operational load earn **~9x more per customer in USD markets** (§1). Operational attention is this team's scarce resource; the PH market pays it a fraction of the going rate.
- The cost asymmetry is total: infrastructure, LLM tokens, and the entity/rails to sell to the US (~$2–3.5k/yr for the LLC + compliance, §2) are all USD — while the operator's *life* is PHP-denominated. US-market revenue on a PH cost base is the whole arbitrage, and peso depreciation makes it better every year. PH-market revenue on USD costs is the same arbitrage running in reverse.
- The **COI-tracking recommendation from the B2B report survives this report unchanged.** Nothing about operating from Manila degrades it: deploy in US regions (operator latency to their own admin panel is the only cost), form the US LLC for Stripe, sell to US property managers. Timezone is a mild headwind for support and a mild tailwind for maintenance windows.

**The three legitimate exceptions**, in descending order of strength:

1. **PH customers who earn USD** (freelancers, agencies — ideas 1 and 4): PH-domain knowledge as the moat, dollar-adjacent willingness-to-pay as the economics. This is the only PH-facing play I'd fund with this team's time.
2. **PH domain expertise sold *to* USD buyers** — the inverted arbitrage worth naming: tools for US companies managing Philippine teams and contractors (the outsourcing corridor), priced in USD, differentiated by local knowledge no US competitor has.
3. **PH as a SEA beachhead — mostly a weak frame.** SEA is not one market: rails, languages, and regulations reset at every border. The one honest version of the beachhead: Xendit spans the Philippines and Indonesia, so a PH product built on Xendit's rails (ideas 2 and 3 shapes) has a *real* second market — but this is an option to hold, not a reason to start.

**Final position:** primary bet = USD B2B (COI tracking, unchanged); if and only if the operator wants a PH-facing product, the BIR copilot at annual-prepaid pricing is the one that survives the math — and the sari-sari store app is the one to keep refusing.

---

## Sources

- [USD/PHP 2026 history (exchange-rates.org)](https://www.exchange-rates.org/exchange-rate-history/usd-php-2026) · [30rates July 2026](https://30rates.com/usd-to-php-forecast-today-dollar-to-philippines-peso)
- [Is Stripe available in the Philippines 2026 (HynoGo)](https://hynogo.com/blog/is-stripe-available-in-philippines-2026) · [Stripe via US LLC (StartGlobal)](https://startglobal.co/us/international/philippines/stripe/)
- [PayMongo pricing](https://www.paymongo.com/pricing) · [PayMongo Subscriptions API](https://developers.paymongo.com/docs/subscriptions-api) · [PayMongo payouts](https://developers.paymongo.com/docs/understanding-payouts-with-paymongo)
- [Xendit pricing](https://www.xendit.co/en/pricing/) · [PH gateway comparison (HitPay)](https://hitpayapp.com/blog/philippines-payment-gateway-comparison) · [QR Ph / GCash / Maya MDRs (HitPay)](https://hitpayapp.com/blog/qr-ph-gcash-maya-payment-methods-philippines)
- [Dragonpay waived fees](https://www.dragonpay.ph/waived-fees/) · [Dragonpay guide (Wise)](https://wise.com/ph/blog/what-is-dragonpay)
- [PayPal PH receiving/withdrawal (Hurupay)](https://hurupay.com/blog/how-to-receive-and-withdraw-money-on-paypal-in-the-philippines) · [PayPal PH business fees](https://www.paypal.com/ph/business/paypal-business-fees)
- [GCash subscription errors (GCash Help)](https://help.gcash.com/hc/en-us/articles/31317899325721-Online-payment-or-subscription-error) · [Spotify/GCash failure threads](https://community.spotify.com/t5/Premium-Family/GCash-Payment-for-Family-Premium-always-failed/td-p/4919030)
- [Stripe Atlas cost and perks](https://guptadeepak.com/startup-offers/guides/stripe-atlas) · [Atlas vs own LLC (BusinessAnywhere)](https://businessanywhere.io/stripe-atlas-vs-forming-your-own-llc/) · [Non-resident US LLC taxes (Tax Haven Directory)](https://taxhavendirectory.com/blog/stripe-atlas-vs-us-llc-non-residents)
- [NPC registration legal foundations (NDV Law)](https://ndvlaw.com/a-ceos-guide-to-registration-of-data-processing-system-with-the-national-privacy-commission-part-1-legal-foundations-and-mandatory-requirements/) · [NPC compliance guide (Respicio)](https://www.respicio.ph/commentaries/compliance-guide-for-npc-registration-and-data-privacy-act-requirements-for-businesses) · [DLA Piper: PH registration](https://www.dlapiperdataprotection.com/?t=registration&c=PH)
- [Supabase regions for SEA](https://dl.iir.edu.ua/iir-news/supabase-regions-explained-1764802739) · [Region mismatch case study](https://dev.to/thexdev/slowed-by-region-24d2) · [Supabase regional invocations](https://supabase.com/docs/guides/functions/regional-invocation)
- [Claude API pricing (BenchLM)](https://benchlm.ai/anthropic/api-pricing)
