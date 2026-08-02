# B2C Consumer Web Apps: The Systems/Economics View

**Lens:** same as the B2B report — buildability, operability, margin, defensibility for a tiny AI-assisted team on Next.js 15 + Supabase + Vercel — but re-run at consumer price points ($5–20/mo or one-time) and consumer scale (thousands–tens of thousands of users, anonymous signups). Companion to `architecture-lens.md`. Date: 2026-07-31.

**The headline before the detail:** the 10x price compression does not kill AI margins by itself — bounded document jobs still cost pennies. What it kills is *everything around* the margin: revenue durability (churn), acquisition economics (CAC must be ~$0), and the abuse surface. The full argument is in §7, and the answer to "does any B2C idea beat COI tracking" is **no**.

---

## 1. Margin math at consumer price points

### The budget at $9.99/mo

Work backward from an 80% gross margin target. On $9.99: Stripe takes ~2.9% + $0.30 ≈ **$0.59 (5.9% — payment fees are 6x heavier at consumer prices than at $99+)**, leaving roughly **$1.50–2.00/mo of inference budget per active subscriber**.

At current prices (Claude Haiku 4.5 $1/$5, Sonnet 5 $2/$10 per M tokens in/out — [BenchLM](https://benchlm.ai/anthropic/api-pricing)), a typical bounded call of 5k input + 1k output costs **$0.01 on Haiku, $0.02 on Sonnet**. So the $9.99 subscription affords:

- **~75–100 Sonnet-class bounded calls/month (≈3/day)**, or ~150–200 on Haiku (≈5–6/day) — with prompt caching stretching this further.
- **Chat does not survive.** 30 turns/day with a rolling ~15k context on Sonnet 5 ≈ 30 × ($0.030 + $0.005) ≈ **$1.05/day ≈ $31/mo — 3x the subscription price.** Even on Haiku it's ~$16/mo, 160% of price. The B2B trap shape becomes a guaranteed loss at consumer prices, not merely a risk.
- **The blended average is a lie.** Consumer usage is power-law distributed; the top ~5–10% of users can consume half your tokens. At $99/mo B2B you have headroom for whales; at $9.99 you do not. Hard per-account caps (a token-budget ledger in Postgres, decremented per call) are mandatory from day one — and caps that feel stingy at $9.99 drive churn, which is the second squeeze.

### The churn squeeze (the real B2C margin problem)

Consumer subscription churn runs **~9%/month for mobile-style app subscriptions and ~4–7% for B2C digital subscriptions**, with only ~17% of monthly subscribers surviving 12 months ([Adapty churn benchmarks](https://adapty.io/blog/why-churn-rate-looks-different-what-youre-measuring/), [PM Toolkit benchmarks](https://pmtoolkit.ai/benchmarks/churn-rate-benchmarks), [Eightx churn index](https://eightx.co/blog/average-subscription-churn-rate-by-category)). At $9.99 and 7% monthly churn, gross LTV ≈ $9.99/0.07 ≈ **$143**, call it ~$110 net of fees and COGS. Compare a $149/mo B2B compliance tool at 2–3% churn: LTV $5,000–7,000. The consequence is structural: **at consumer LTVs, any paid acquisition is dead — organic (SEO, virality, word of mouth) is the only channel that closes**, which makes the product's *content surface* part of its architecture.

### Where one-time/transactional pricing is structurally correct

For **episodic, high-stakes moments** — signing a lease, receiving a job offer, buying a house, disputing a bill — subscription is the wrong shape: the user has one document, one moment, and maximal willingness to pay *right now*. One-time pricing fits:

- **$29 per document, ~$0.10–0.20 COGS, ~$1.14 Stripe** → ~$27.50 contribution, **~95% margin per unit**. AI cost is a rounding error even at consumer prices, because it's metered to the unit sold. This is the B2B "healthy shape" surviving compression intact.
- **What it does to the revenue model:** revenue = traffic × conversion × price, and it **resets to zero every month**. 50k monthly visits × 1% conversion × $29 = $14.5k/mo — achievable, but it's a traffic treadmill, not compounding ARR. There is no churn because there is nothing to churn from; there is also no base to build on.
- **The correct hybrid:** one-time purchase as the core transaction, with a small monitoring/reminder subscription attached post-purchase (order bump). The subscription must be the *batch-shared monitoring shape* (see idea 4) so its marginal cost is ~zero.

**Which shapes survive the 10x compression:**

| Shape | B2B verdict | B2C at $9.99–29 verdict |
|---|---|---|
| Bounded per-document AI, transactional pricing | Healthy | **Healthy — survives intact (~95% unit margin)** |
| Batch-shared monitoring/alerting (compute amortized across all users) | Healthy | **Healthy — the only subscription shape that survives** |
| Metered AI inside a subscription with caps | Healthy | Marginal — caps feel stingy, churn pressure |
| Unmetered chat/assistant | Trap (risk) | **Inverted — guaranteed negative margin on best users** |
| Generative media (images/audio) | Trap | **Inverted + abuse magnet** |

---

## 2. Consumer scale on Supabase/Vercel: what breaks and what it costs

B2B at 70 customers never touches a platform limit. A working consumer app at 10–50k MAU meets them in this order:

1. **Postgres connections — first and silently.** Serverless functions opening direct connections exhaust a Micro instance's connection budget under modest concurrency. Non-negotiable from day one: Supavisor transaction-mode pooling for every serverless data path. This is a config decision, not a scaling project — but only if made early.
2. **Compute tier.** Supabase Pro's $10 credit covers a Micro instance; sustained concurrent writes at tens of thousands of MAU means upgrading compute — tens of dollars/month, not a redesign ([Makerkit Supabase pricing](https://makerkit.dev/blog/saas/supabase-pricing)).
3. **Auth is fine.** Pro includes **100K MAU** — a consumer app doesn't outgrow this until it's a business that can afford the overage.
4. **Storage and egress.** File storage overage is cheap ($0.021/GB); the real line is **egress: 250GB included on Pro, then $0.09/GB uncached / $0.03/GB cached** ([Supabase egress docs](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Schematic breakdown](https://schematichq.com/blog/supabase-pricing)). Serve user files via short-lived signed URLs behind CDN caching, cap upload sizes (a lease PDF is 2MB; reject 200MB scans), and never proxy file bytes through your own functions.
5. **Vercel bandwidth.** Pro includes 1TB fast data transfer + 10M edge requests ([Schematic Vercel pricing](https://schematichq.com/blog/vercel-pricing)). Static/ISR pages make a traffic spike cheap; dynamic SSR on every hit makes it expensive. Programmatic SEO pages must be static.

### The viral-spike bill, concretely

A front-page-of-Reddit event — say 500k visits in 48 hours — costs almost nothing *if* the architecture is right: static pages ≈ a few hundred GB transfer ≈ **tens of dollars of overage**. The catastrophic version is a spike where each anonymous visitor can trigger inference: 100k free LLM calls × $0.02 = **$2,000 in a day**, growing linearly with virality — a bill that outruns revenue by construction, since visitors aren't payers yet.

Rules that make spikes cost latency instead of money:

- **The model never runs for an anonymous user.** Free tier = deterministic work only (client-side parsing, a redacted preview, cached sample output). Inference sits behind verified auth at minimum, behind payment ideally. This is the consumer version of the B2B metering rule.
- **Per-account daily token ledger in Postgres**, checked before every call — the cap is a product feature, not an afterthought.
- **Vercel Spend Management with hard caps and auto-pause of production deployments** as the backstop — it now pauses projects by default when the set spend is hit, with a few minutes of lag ([Vercel changelog](https://vercel.com/changelog/improved-hard-caps-for-spend-management), [Spend Management docs](https://vercel.com/docs/spend-management)). Better paused than bankrupt; set it before launch, not after the first spike.
- **Queue heavy jobs (pgmq) rather than running them synchronously** — a spike then degrades to a longer queue, not a bigger bill.

---

## 3. Abuse and fraud surface

B2C means anonymous signups, and the abuse economy is professionalized:

- **LLM credit farming.** Any endpoint that returns free generative output gets botted — free-tier tokens are harvested and resold through proxy services. Defenses (phone verification, card-gated trials, fingerprinting, captchas) all tax conversion. The architectural answer is to not have farmable output: **products whose output is only valuable when bound to the user's own document (a review of *your* lease, *your* offer) have nothing worth farming.** Generic generation (images, essays, chat) is maximally farmable.
- **Upload liability.** Any feature that accepts and *shares* user images carries CSAM/illegal-content exposure — hash-matching (PhotoDNA-class), NCMEC reporting obligations, and a human moderation queue. That is operationally disqualifying for a solo team. **Private, unshared, PDF-document-only uploads with short retention** are a categorically smaller surface: no public distribution, no gallery, no user-to-user sharing, ever.
- **Chargebacks.** Stripe charges a **$15 non-refundable dispute fee, plus a further $15 counter fee (since June 2025) if you contest and lose** ([Chargeflow on Stripe fees](https://www.chargeflow.io/blog/stripe-dispute-fees), [Chargebacks911](https://chargebacks911.com/chargeback-types/stripe-chargebacks/stripe-chargeback-fees/)). On a $29 one-time product, a lost dispute costs ~$45–60 all-in — a 2% dispute rate erases ~3–4% of revenue and threatens your processing account near the 0.75% monitoring threshold. Mitigations are cheap and boring: a recognizable statement descriptor, instant deliverable, and a liberal one-click refund policy (a $29 refund beats a $45 dispute every time).

**Ranked exposure:** chat/companion and generative-media apps = unbounded (farming + moderation + processor risk). Document tools = low (nothing farmable, private uploads, tangible deliverable). Monitoring/alert subscriptions = near zero (no on-demand compute at all).

---

## 4. Consumer data sensitivity

Commercial documents carried almost no privacy drag. Consumer documents are about *people*:

- **Health data — the bright line.** GDPR Article 9 special-category data, plus — the commonly missed part — while HIPAA generally does *not* bind a consumer app a user uploads their own records to (you are not a covered entity or BA), the **FTC Health Breach Notification Rule and state laws like Washington's My Health My Data Act do reach consumer health apps directly**. Real obligations before dollar one: consent flows, retention limits, breach procedures. Only idea 5 below crosses this line, and it pays a tax for it.
- **Financial/legal/family documents** (leases, offers, bills): personal but *user-initiated and transactional*. GDPR/CCPA hygiene is deferrable-with-basics: delete-my-data endpoint, short retention, encryption at rest, an explicit "never used for model training" clause (also demand Anthropic/OpenAI's zero-retention API posture). Days of work, not months.
- **Client-side processing as a marketing asset, not a cost.** The stack makes a genuinely differentiating pattern cheap: **extract text from the PDF in the browser (pdf.js/WASM), optionally redact names/SSNs client-side, and send only the extracted text to the server — the file itself never leaves the device.** Store the generated report, not the document; auto-delete inputs within 24h. Full zero-knowledge is infeasible while the LLM runs server-side, but "your lease never leaves your browser; we delete everything but your report" is a truthful, checkable claim that converts privacy from compliance drag into the conversion pitch. It also shrinks the breach blast radius to near nothing — the best kind of security work: not storing the data at all.

---

## 5. Candidate B2C ideas

All follow one doctrine, adapted from the B2B report: **episodic document job at a high-stakes moment, one-time priced, client-side-first ingestion, static SEO surface as the acquisition engine** — plus one monitoring-shaped subscription. Anonymous users get deterministic previews; the model runs only after payment.

### 1. Renter lease reviewer ("know what you're signing") — one-time $19–29

~44M US renter households, most re-signing annually, near-universal anxiety, zero tooling.

- **System:** client-side pdf.js text extraction (file never uploaded — the privacy pitch) → server action calls Sonnet 5 with a cached state-specific tenant-law grounding corpus → structured report: red-flag clauses with quotes, state-law citations, questions-to-ask list, deposit-protection checklist → free preview (issue count + one teaser) with paywall before the full report → programmatic static SEO pages per state/city/clause topic generated from the same law corpus.
- **Hardest technical problem:** building and maintaining the 50-state tenant-law grounding corpus so citations are *correct*, and holding the UPL (unauthorized practice of law) line — information and flags, never "advice," with the corpus giving citable grounding that raw ChatGPT lacks.
- **Marginal cost:** ~15k-token lease + cached grounding + ~3k output on Sonnet 5 ≈ **$0.07–0.15 per review** vs. $24 net. ~99% unit margin.
- **Risk:** platform zero (user PDFs, Tier 4). Privacy low (client-side extraction, 24h deletion). UPL manageable with positioning. Real risk: free-alternative pressure from ChatGPT (see §6).
- **Build to paid MVP:** 4–6 weeks (the corpus is half of it).

### 2. Job-offer & employment-contract decoder — one-time $19–39

Offer letters, equity grants, non-competes, severance terms — decoded at the single moment of maximum stakes and willingness to pay. Includes an equity-comp explainer (409A basics, vesting math) and a negotiation prep sheet.

- **System:** same skeleton as idea 1; grounding corpus = state non-compete enforceability + equity-comp reference. High-intent SEO ("is a non-compete enforceable in Texas", "what is a 4-year cliff").
- **Hardest problem:** equity explanations that are numerically correct across grant types without sliding into financial advice.
- **Marginal cost:** ~$0.05–0.10 per document. **Risk:** platform zero; UPL/financial-advice positioning care. **Build:** 3–5 weeks.

### 3. Home-inspection report decoder for buyers — one-time $19–29

A 60-page inspection PDF lands during a 7–10 day option period; the buyer must decide what matters and what to demand. Urgency is built into the transaction — the best possible conversion condition.

- **System:** upload (or client-side extract) → chunked extraction of findings → severity-ranked issue list, rough repair-cost *ranges* with a regional index, and a draft repair-credit request letter → paywall after a top-3-issues preview.
- **Hardest problem:** repair-cost credibility — ranges plus explicit uncertainty, never fabricated point estimates; one confident wrong number destroys trust in the whole report.
- **Marginal cost:** ~60k input on Sonnet 5 ≈ **$0.15–0.25 per report**. **Risk:** platform zero; no regulated-advice line to cross. **Build:** 4–6 weeks.

### 4. Brand-watch for solopreneurs and creators — subscription $9–15/mo

The consumer/prosumer version of the B2B trademark-watch idea: Etsy sellers, indie hackers, creators monitoring their brand name against new USPTO filings. This is the one subscription on the list because it is the **batch-shared monitoring shape**: one weekly ingest and screening run is amortized across every subscriber.

- **System:** weekly USPTO bulk-data ingest (official, free, Tier 4) → embedding + phonetic similarity screen ($0.02/M tokens — [EmbeddingCost](https://embeddingcost.com/openai)) → batched LLM ranking at 50% off → email digests → static SEO pages per filing/class.
- **Hardest problem:** similarity thresholds vs. alert fatigue at consumer attention spans.
- **Marginal cost per subscriber:** **pennies/month** — the only shape where $9.99 buys 95%+ margin *as a subscription*. Nothing farmable, nothing uploaded, near-zero abuse surface.
- **Risk:** ~zero platform/compliance; weakest lock-in (alerts, not a system of record) — churn is the business risk. **Build:** 3–5 weeks (shares its pipeline with the B2B version — one build, two markets).

### 5. Medical-bill & EOB error checker — per-bill $14–29

Billing errors are common, amounts are large, and the emotional salience is extreme. Included deliberately as the idea that shows where the sensitivity line sits.

- **System:** client-side extraction with aggressive identifier redaction *before* anything leaves the browser → CPT/billing-code sanity checks + duplicate/unbundling detection → plain-English dispute letter draft → ephemeral processing, store only the letter.
- **Hardest problem:** not the model — the **pre-revenue privacy engineering**: FTC Health Breach Notification Rule + state consumer-health laws (e.g., WA MHMDA) apply to consumer health apps even where HIPAA does not. Consent, retention, breach procedures before dollar one.
- **Marginal cost:** ~$0.05/bill. **Risk:** the only idea on this list with real compliance drag; ranked last for that reason despite strong demand. **Build:** 5–7 weeks (privacy work is the delta).

---

## 6. Top pick, the argument against it, and the B2C trap

### Pick: **the renter lease reviewer** (idea 1), run as a franchise with ideas 2 and 3 on the same skeleton

Why, from this lens: it is the episodic-document doctrine at its cleanest — enormous recurring population (renters re-sign yearly, so "one-time" pricing still gets natural repeat purchase), zero platform dependencies, ~99% unit margin, nothing farmable, client-side processing as a marketing weapon, and a grounding corpus + programmatic SEO surface that compound where the code does not. Ideas 1/2/3 share ~80% of their architecture — one team builds a *portfolio* of high-stakes-moment document tools on one skeleton, which is the correct small-team answer to one-time pricing's traffic-treadmill problem.

**Strongest technical argument against it:** the free alternative is one paste away. ChatGPT/Claude will review a lease for $0, at 80% of the quality, and AI search overviews answer "is this clause legal" before the click — so the product's survival rests entirely on (a) the state-law grounding corpus making its citations *verifiably* better than a chatbot's, (b) the artifact (annotated, citable, shareable report) beating a chat transcript at a money-stakes moment, and (c) winning organic traffic in the most contested acquisition environment in a decade. That is a real, possibly fatal objection — I pick it anyway because it's the *best available* B2C shape, not because the objection is answered. Which is exactly the point of §7.

### The B2C trap I would refuse: **the AI companion / character-chat app**

The B2C equivalent of the meeting notetaker — maximally tempting (highest engagement metrics in consumer AI, viral loops, weekend demo on this exact stack) and it fails every filter simultaneously:

1. **Engagement — the one thing consumer products exist to maximize — is the direct COGS driver.** Unmetered chat at $9.99 loses ~$20/mo on every *successful* user (§1 math). Retention means growing context length means growing cost per message. The better the product works, the faster it loses money.
2. **Unbounded abuse and safety surface:** jailbreaking, minors, self-harm scenarios, NSFW drift — a 24/7 moderation obligation with real liability, run by one person.
3. **Payment-processor and platform risk:** companion apps live one policy review away from losing Stripe/app-store distribution.
4. **Zero moat:** the model is rented, personas are prompts, and the incumbents (plus every model vendor's own consumer app) own the default surface.

Secondary temptations refused for the record: **AI headshot/avatar generators** (one-time pricing *looks* structurally correct, but GPU COGS, a quality arms race against funded incumbents, NCII/deepfake abuse surface requiring image moderation, and a gold rush that already peaked) and **resume/ATS optimizers** (hyper-crowded, ChatGPT does it free, zero data gravity — a weekend clone by definition).

---

## 7. The blunt answer: does any B2C idea beat COI tracking?

**No.** Not on any axis I care about, and it isn't close.

| Axis | COI tracking (B2B) | Best B2C (lease reviewer) |
|---|---|---|
| Unit margin | ~97–99% | ~95–99% — a tie, the only tie |
| Revenue durability | 2–3% monthly churn, compounding ARR, system-of-record lock-in | One-time purchases; revenue resets to zero monthly; consumer subs churn 4–9%/mo |
| Acquisition | ~70 customers = real business; direct outreach works; LTV $5–7k supports paid CAC | Needs tens of thousands of organic visitors/mo forever; LTV ~$25–150 supports no paid CAC |
| Moat | Vendor rosters + compliance history + audit trail + labeled eval corpus | Grounding corpus + SEO — real but thin; no workflow lock-in |
| Abuse surface | ~None (known business counterparties) | Managed but nonzero (anonymous users, chargebacks, farming pressure) |
| Free-alternative pressure | ChatGPT reading one ACORD form does not replace the compliance *loop* | ChatGPT reading one lease replaces most of the product |
| Operational load per revenue dollar | 70 customers × $150 = quiet | ~10,000 customers for the same revenue = support, refunds, disputes, moderation |

The last row is the decisive one for *this* team. The constraint was never code — it's operational attention, and **B2C converts revenue into operational load at roughly 100x the rate B2B does** at these price points. B2C is structurally worse for a solo/small AI-assisted team: the compressed price point doesn't break the AI margin, but it breaks the LTV that funds acquisition, removes the lock-in that makes revenue compound, and multiplies the number of humans who can create work for you at 3 a.m.

**Standing recommendation unchanged: build COI tracking.** The one legitimate B2C role: an episodic document tool (lease reviewer) as a near-zero-marginal-cost SEO asset and top-of-funnel wedge — renters' landlords and property managers are literally the COI and lease-abstraction buyers — built only *after* the B2B core is earning, never instead of it.

---

## Sources

- [Claude API pricing per 1M tokens (BenchLM)](https://benchlm.ai/anthropic/api-pricing)
- [OpenAI embedding pricing (EmbeddingCost)](https://embeddingcost.com/openai)
- [Churn benchmarks: what you're measuring (Adapty)](https://adapty.io/blog/why-churn-rate-looks-different-what-youre-measuring/)
- [Churn rate benchmarks by industry, B2B vs B2C (PM Toolkit)](https://pmtoolkit.ai/benchmarks/churn-rate-benchmarks)
- [Average subscription churn rate by category (Eightx)](https://eightx.co/blog/average-subscription-churn-rate-by-category)
- [Stripe dispute fees: $15 counter fee (Chargeflow)](https://www.chargeflow.io/blog/stripe-dispute-fees)
- [Stripe chargeback fees 2026 (Chargebacks911)](https://chargebacks911.com/chargeback-types/stripe-chargebacks/stripe-chargeback-fees/)
- [Supabase egress usage docs (Supabase)](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase pricing explained (Schematic)](https://schematichq.com/blog/supabase-pricing)
- [Supabase pricing: what you'll actually pay (Makerkit)](https://makerkit.dev/blog/saas/supabase-pricing)
- [Vercel pricing plans and hidden costs (Schematic)](https://schematichq.com/blog/vercel-pricing)
- [Improved hard caps for Spend Management (Vercel)](https://vercel.com/changelog/improved-hard-caps-for-spend-management)
- [Spend Management docs (Vercel)](https://vercel.com/docs/spend-management)
