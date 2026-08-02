# What a Tiny AI-Assisted Team Should Build: The Systems/Architecture View

**Lens:** what is actually buildable, operable, and defensible by a tiny team — and what will quietly destroy them.

**Premise held constant:** code is cheap for this team; operational attention is the scarce resource. Every recommendation below is filtered through "what does this cost to *run* in month 14, at 3 a.m., alone." Stack is fixed: Next.js 15 (App Router) + Supabase (Postgres, auth, storage, realtime, edge functions) + Tailwind/shadcn on Vercel. Date of analysis: 2026-07-31.

---

## 1. The architectural profile of a survivable small-team web app

### Shapes that fit (and fit this stack specifically)

| Property | Why it matters for Next.js + Supabase + Vercel |
|---|---|
| **CRUD system-of-record + a bounded AI enrichment step** | Postgres + RLS multi-tenancy is Supabase's sweet spot. The AI step is request/response or a short async job — no pipeline orchestration layer needed. |
| **Read-heavy, cacheable** | ISR/static rendering on Vercel makes read traffic nearly free and makes programmatic SEO pages a zero-marginal-cost acquisition channel. |
| **Batch/cron cadence, not realtime** | `pg_cron` + Supabase edge functions or Vercel crons handle daily/weekly work. Failure mode is "retry in an hour," which means you sleep. Bonus: batch LLM APIs are 50% cheaper. |
| **Text-and-PDF-sized payloads** | Supabase Storage handles documents fine. No transcode fleet, no egress shock. |
| **Eventual consistency tolerated** | If a stale read costs the user nothing, you can cache aggressively and skip queues/locks entirely. |
| **Async by email** | Email as an interface (inbound parse + outbound via Resend/Postmark) is the most underrated architecture for small teams: it's a queue, a notification channel, and a UI the user already has. |

### Shapes that quietly destroy small teams

Ranked by how certainly they kill you:

1. **24/7 low-latency expectations.** Uptime monitors, trading tools, live customer-facing chat infra. If your product being down for 20 minutes costs *your customer* money, you have hired yourself as unpaid on-call forever.
2. **Realtime collaboration / CRDTs.** Presence, conflict resolution, sync servers. Yjs is mature, but the *operational* surface (reconnect storms, divergence bugs users can see) is a full-time job. Supabase Realtime is fine for "poke the client to refetch"; it is not a collab engine.
3. **High-volume webhooks from flaky third parties.** Shopify/Gmail/Stripe at low volume is fine; at high volume you own ordering, dedupe, replay, and their outages become your incidents. Serverless functions on Vercel make burst absorption worse, not better (no durable consumer; you'd be bolting on pgmq immediately).
4. **Media processing.** Audio/video ingestion means metered COGS, long-running jobs that don't fit serverless limits (Vercel fluid compute tops out around ~14 min on Pro), and storage/egress bills that scale with usage while your price doesn't.
5. **Scraping fleets / browser automation as the core.** Proxies, captchas, DOM breakage — permanent maintenance treadmill plus legal fog. Grindy scraping *of stable official sources* can be a moat (see §5); scraping *adversarial* sources is a tax.
6. **Per-tenant infrastructure.** Dedicated DBs, per-customer connectors, on-prem anything. One Postgres, RLS, shared everything, or don't do it.

### The fixed-cost floor

Supabase Pro is ~$25/mo for the first project (with a $10 compute credit that covers a Micro instance) and Vercel Pro is $20/seat with a typical real-world bill around $40–70/mo, so the entire platform floor is **~$50–100/mo** ([Supabase pricing breakdown](https://makerkit.dev/blog/saas/supabase-pricing), [Vercel pricing](https://schematichq.com/blog/vercel-pricing)). At this floor, roughly 5 paying customers cover infrastructure. Everything that matters is in *marginal* cost.

---

## 2. Cost structure and unit economics (current pricing, July 2026)

Current per-million-token API prices:

- **Claude Haiku 4.5: $1 in / $5 out. Sonnet 5: $2 / $10 (intro pricing through Aug 31, 2026). Opus 5: $5 / $25.** Cache hits ~10% of input price; Batch API is 50% off ([BenchLM](https://benchlm.ai/anthropic/api-pricing), [CloudZero](https://www.cloudzero.com/blog/claude-pricing/)).
- **OpenAI: GPT-5.6 Terra $2.50 / $15; Luna $1 / $6; GPT-5.5 flagship $5 / $30** — note OpenAI *doubled* flagship pricing with GPT-5.5 in April 2026, a reminder that inference deflation is not guaranteed monotonic ([Morph pricing table](https://www.morphllm.com/openai-api-pricing), [apidog](https://apidog.com/blog/gpt-5-5-pricing/)).
- **Embeddings are effectively free: $0.02/M tokens (text-embedding-3-small), $0.01/M batched** ([EmbeddingCost](https://embeddingcost.com/openai)). RAG retrieval infrastructure costs rounding-error money; only the generation step costs anything.

Industry context: AI-first SaaS companies are averaging ~52% gross margins vs. the classic 75–80% SaaS benchmark, with inference commonly eating 20–40%+ of revenue ([Avante Ventures benchmark](https://avanteventures.com/en/library/ai-startup-gross-margin-benchmark-2026), [SaaSMag](https://www.saasmag.com/ai-cogs-saas-gross-margin-compression/)). That margin compression is almost entirely a *product-shape* choice, not a fate. The dividing line:

**Healthy shape — metered, bounded, document-triggered AI.**
A document-extraction step (say 10k input + 1k output tokens) costs **~$0.03 on Sonnet 5, ~$0.015 on Haiku 4.5**. A customer who processes 100 documents/month costs you **$1.50–3.00** against a $49–199/mo price. That's 95%+ gross margin — real SaaS economics. The AI cost is *tied to a countable unit of work*, so a credit system or per-document pricing is trivial to bolt on if a whale appears.

**Trap shape — unmetered conversational/agentic AI.**
An "AI assistant" with long rolling context: 30 turns/day × 15k context tokens on a mid-tier model is ~$1/day/user → **$30/mo COGS against a $20–29/mo price.** Negative gross margin on your best (most active) users, which is the worst possible correlation. Agentic multi-step loops are worse — token spend per user action is unbounded and user-controlled. If you build anything chat-shaped, you need caps, cheap-model routing, and prompt caching *from day one*, and you're still fighting physics.

**Architecture rule:** price and meter in the same unit the model bills you in (documents, runs, pages) — never "unlimited" anything.

---

## 3. Integration and platform risk, ranked

**Tier 1 — Do not build on (existential risk):**
- Unofficial/reverse-engineered APIs: LinkedIn automation (no public API for this; account bans are the enforcement mechanism), Instagram/TikTok tooling, WhatsApp unofficial clients.
- Adversarial scraping: Google SERPs, Amazon listings, social content. Your COGS include a proxy arms race and your legal position is fog.
- X/Twitter API: repriced ruinously once already; permanent repricing risk.

**Tier 2 — Single-platform dependence (revocation or Sherlocking risk):**
- Shopify apps, Notion/Slack-only integrations, Chrome-extension-only products, GPT-store products. Viable as *channels*, fatal as *foundations*. The platform sees your traction data and can ship your feature natively.
- "Thin wrapper on one model vendor" products: the incumbent chat products absorb generic capabilities (summarize, chat-with-PDF, rewrite) every quarter. If your product's value statement fits in one prompt, it's already dead.

**Tier 3 — Manageable (official, paid, multi-vendor-substitutable):**
- Stripe, QuickBooks/Xero, Google Calendar, accounting/CRM APIs: official, versioned, businesses depend on them, and there are 2–3 substitutes per category. Risk exists but is survivable.
- LLM APIs themselves: genuinely commoditized now — Anthropic/OpenAI/Gemini are drop-in substitutable for extraction workloads if you keep an eval suite. Keep prompts behind an internal interface and this is your *least* risky dependency.

**Tier 4 — Near-zero platform risk:**
- User-uploaded documents (the user owns the data; nobody can revoke it).
- Official government bulk data: USPTO, SEC EDGAR, FCC, state registries. Free, public, stable formats, explicitly published for reuse.
- Open protocols: email (SMTP/IMAP), iCal, PDF/DOCX.

**Design implication:** build the core loop on Tier 4 (user documents + email + public data), use Tier 3 as accelerants, treat Tier 2 as marketing channels only, and never touch Tier 1.

---

## 4. Compliance and data-sensitivity drag

- **Avoid before first dollar:** HIPAA (patient data — BAA requirements ripple through every vendor; Supabase gates HIPAA behind Team/Enterprise add-ons, and the audit burden is engineering-months), PCI beyond "Stripe holds the cards" (never store payment credentials), and consumer credit/FCRA territory — anything that influences hiring, lending, or housing decisions about individuals triggers regulated-decision law. This quietly catches "AI resume screeners" and tenant-screening ideas.
- **Deferrable with hygiene:** GDPR for B2B business-contact data (export/delete endpoints, DPA template, EU-acceptable subprocessors — days of work, not months). SOC 2 only becomes real when you sell to mid-market/enterprise; with Vanta/Drata it's roughly $10–30k and a few weeks, and the correct strategy is to *sell to SMBs who never ask* for the first 12 months and let a customer's check fund the audit.
- **Cheapest compliance posture overall:** B2B products processing *business* documents (insurance certs, leases, invoices, RFPs, filings). Commercial documents about companies carry almost no data-protection drag, and audit-trail expectations are a feature you'd build anyway (an append-only events table).

---

## 5. Where a real technical moat is possible for a tiny team

Not moats: prompts, model choice, UI polish, "our AI is better." All replicable in a weekend — by definition, since *you* built it in a weekend with AI assistance.

Actual small-team moats, in order of achievability:

1. **System-of-record data gravity.** Once a customer's 300 vendors / 80 leases / 500 past RFP answers live in your schema with history, churn means re-migration and losing the audit trail. This is the strongest moat available and it's purely architectural: design for longitudinal data (histories, events, expirations) rather than point-in-time answers, from the first migration.
2. **Ingestion/normalization pipelines for messy real-world formats.** Hundreds of insurer PDF layouts, lease phrasings, bank-statement formats. The pipeline itself is clonable, but the **eval corpus** — thousands of labeled real documents accumulated from production — is not. Note the inversion: in the AI era, *the test set is the moat, not the model*.
3. **Compounding proprietary datasets with SEO surface area.** Structured data accumulated over time (price histories, filing archives, vendor records) rendered as programmatic ISR pages. The dataset ages like wine; a cloner starts at zero history and zero domain authority. Caveat, honestly stated: AI-overview-era search sends less click traffic than 2023 SEO playbooks assume — treat this as one channel, not the plan.
4. **Integration breadth accumulated over time.** Each grindy connector (QuickBooks + Xero + FreshBooks + …) is small; twelve of them is a wall. Weak alone, strong combined with #1.

---

## 6. Candidate ideas (buildability × operability × margin × defensibility)

All five share one architecture — **Postgres system-of-record + bounded LLM extraction + cron-driven email loops** — which is deliberate. It's the shape this stack is best at and the shape one person can operate.

### A. Certificate of Insurance (COI) tracking & vendor compliance

For property managers, GCs, and franchisors who must verify that every vendor/subcontractor carries valid insurance. Incumbents (myCOI, Certificial, Jones) are enterprise-priced; the SMB tier is spreadsheets and panic.

- **System:** vendors emailed a magic-link upload page → PDF to Supabase Storage → LLM extraction of ACORD 25 fields (carrier, limits, effective/expiry, additional-insured language) → compare against per-customer requirement templates → compliance dashboard + `pg_cron` expiry-chasing emails → human-review queue for low-confidence extractions.
- **Hardest problem:** extraction reliability on ACORD 25 variants and endorsement-language checks ("is X named as additional insured?"). Bounded because ACORD 25 is semi-standardized; solvable with a labeled eval set + confidence-gated human review.
- **Marginal cost:** ~$0.02–0.03/certificate (Sonnet 5); a 300-vendor customer ≈ **$1–3/mo COGS** vs. $99–299/mo price.
- **Risk:** platform ~none (email + user PDFs, Tier 4). Compliance ~none (commercial data). Real risk is *trust*: a missed lapse that precedes an incident. Mitigate with review-queue UX and clear "verification assistant, not guarantee" positioning.
- **Build to paid MVP:** 6–8 weeks.

### B. RFP / security-questionnaire answer library for SMB vendors

Companies answering the same 200 questions in every RFP and vendor-security questionnaire. Loopio/Responsive are enterprise-only.

- **System:** answer library in Postgres + pgvector → upload questionnaire (xlsx/docx/portal paste) → per-question retrieval + drafting with source citation → human approve/edit → export. Every approved edit feeds the library.
- **Hardest problem:** parsing the wild variety of questionnaire formats; and making retrieval trustworthy enough that users approve rather than rewrite.
- **Marginal cost:** ~$1.50–2.50 per 200-question document on Sonnet 5 (≈400k in / 60k out); embeddings negligible. Priced per-seat + per-document credits: 90%+ margin.
- **Risk:** platform low. Moat = answer-library data gravity (strong — the single best data-gravity shape on this list). Threat: Notion/Google Workspace AI "answers from your docs" generically — defense is the approval workflow and export formats, not the retrieval.
- **Build to paid MVP:** 4–6 weeks.

### C. Trademark / brand-watch alerting on official registry bulk data

Weekly monitoring of new USPTO (and later EUIPO) applications for similarity to a customer's marks; alert before opposition windows close. Enterprise incumbents (Corsearch, Markify) are priced for law firms; SMB brands get nothing.

- **System:** weekly bulk-data ingest (official USPTO files, Tier 4) → normalize into Postgres → embedding + phonetic similarity screen, LLM batch-ranking of top candidates (50% batch discount) → alert digests → programmatic SEO pages per filing/class from the accumulated corpus.
- **Hardest problem:** similarity scoring that balances recall vs. alert fatigue; ingest-format churn (rare, versioned, announced).
- **Marginal cost:** near zero per user — screening is embeddings (pennies) + small batched LLM spend shared across all users. Best gross margin on the list.
- **Risk:** platform ~zero. Compliance ~zero (public data). UPL (unauthorized practice of law) avoided by alerting-not-advising. Moat: accumulated normalized corpus + SEO surface; weakest *workflow* lock-in of the five — it's alerts, not a system of record.
- **Build to paid MVP:** 3–5 weeks.

### D. Accounts-receivable chasing autopilot for SMBs

Reads open invoices from Stripe/QuickBooks/Xero, runs polite escalating email sequences, detects replies/promises-to-pay, reconciles automatically. Sells on "gets you paid faster" — the easiest ROI story in B2B.

- **System:** OAuth to accounting platform → invoice sync (polling, not webhook-dependent) → per-customer cadence rules → LLM-drafted, tone-controlled chase emails via Resend → inbound-reply parsing to update promise-to-pay state → cash-collected dashboard.
- **Hardest problem:** email deliverability and reply-thread state (send on the customer's domain, handle bounces/OOO/disputes). Not hard-hard, but the part that needs care.
- **Marginal cost:** ~$0.005/email; **<$1/mo per customer** vs. $29–99/mo.
- **Risk:** Tier 3 platform risk (Intuit/Xero could tighten API terms; both have partner programs and incumbent chasing tools exist, e.g., Chaser — evidence the API posture is stable). Moat: moderate — integration breadth + payment-behavior history per debtor.
- **Build to paid MVP:** 5–7 weeks (OAuth + deliverability are the time sinks).

### E. Lease abstraction + critical-date management for small CRE landlords/tenants

Upload commercial leases → extracted abstract (rent schedule, escalations, renewal/termination option windows, CAM terms) → critical-date calendar with escalating reminders. Missing a renewal-option window costs five to six figures; incumbents target institutional portfolios.

- **System:** identical skeleton to (A) with longer documents: Storage → chunked extraction (60k-token lease ≈ **$0.17 on Sonnet 5, ~$0.55 even on Opus 5**) → structured abstract with page-cited fields → confirm-and-correct UX → cron reminders/iCal feed.
- **Hardest problem:** amendment chains (the 3rd amendment overrides §4.2 of the original) — genuinely hard reasoning; mitigated by page-level citations and per-field human confirmation.
- **Marginal cost:** <$1 per lease; leases change rarely, so steady-state COGS ≈ zero. Price per-lease-under-management.
- **Risk:** platform ~zero; trust risk same profile as (A); citations + confirmation flow are the defense. Strong data gravity once a portfolio is loaded.
- **Build to paid MVP:** 6–8 weeks.

---

## 7. Top recommendation — and the trap

### Pick: **A. COI tracking & vendor compliance** (with E as the sibling/expansion)

Why, from this lens specifically:

- **It is the platonic form of the survivable shape.** Zero Tier 1–2 dependencies: the inputs are user-solicited PDFs and email, the clock is `pg_cron`, the output is a dashboard and reminders. Nothing in the architecture can be revoked, repriced, or Sherlocked. Nothing needs to be up at 3 a.m. — the worst outage outcome is "reminder email sent 4 hours late."
- **Margins are boring-SaaS, not AI-SaaS:** ~1–3% inference COGS at list price, tied to a countable unit (certificates), so pricing can never be inverted by a heavy user.
- **The moat compounds along two axes simultaneously:** system-of-record gravity (vendor rosters + compliance history + audit trail) and a growing labeled corpus of real-world certificate variants that makes extraction measurably better than any fresh clone's.
- **Not a one-prompt product.** The value is the *loop* — solicitation, extraction, requirement-diffing, chasing, audit trail — not the extraction call. ChatGPT adding "read this ACORD form" does not touch the business.
- **Willingness to pay is pre-validated** by enterprise incumbents charging per-certificate fees, and the buyer (property manager/GC office) has a compliance obligation, not a nice-to-have.

**Strongest technical argument against it:** this is a *trust-critical extraction* product. The LLM will occasionally misread a limit or miss an exclusion, and the whole category exists because errors are expensive — a customer who discovers one bad extraction stops trusting every green checkmark. You cannot eval your way to 100%.

**Why I still pick it:** the error surface is *bounded and instrumentable* — ACORD 25 is semi-standardized, fields are enumerable, and confidence-gated human review converts "AI accuracy problem" into "workflow with a review queue," which is exactly what the enterprise incumbents are (they use humans too — you're just automating a larger fraction). The failure mode is manageable through architecture (confidence thresholds, page-cited fields, immutable event log); the same cannot be said for the trap below. Contrast with idea B, whose worst counterfactual — generic "answers from your docs" — is being commoditized by suite vendors; and C, which lacks workflow lock-in.

### The trap I would refuse: **the AI meeting notetaker / meeting-intelligence tool**

It is maximally tempting — universal pain, obvious AI fit, demo builds in a weekend on this exact stack, everyone's first idea. It fails every filter in this document at once:

1. **COGS scale with audio-hours while price is flat** — metered transcription plus a per-meeting bot dependency (e.g., Recall.ai-style per-hour infrastructure) puts your heaviest users underwater, the inverse of idea A's economics.
2. **Realtime, calendar-deadline operations:** a bot that fails to join a 9:00 meeting at 9:00 is a refund-grade incident; there is no "retry in an hour." That's a 24/7 SLA product run by one person.
3. **Terminal platform risk:** Zoom, Teams, and Google Meet all ship native AI summaries bundled at platform-subscription-zero marginal price. You are competing with free, from the platform that controls your bot's access.
4. **No data moat:** transcripts are commodity output; nobody re-reads them, so there's no gravity — churn is painless.

The same reasoning disqualifies the adjacent temptations: LinkedIn ghostwriting tools (Tier 1 API risk — enforcement is your customers' accounts getting banned) and generic chat-with-your-docs (one-prompt product, already absorbed by incumbents).

---

**One-line summary:** build the boring compliance loop with pennies-per-document AI inside it — the kind of system where the AI is a cost line you control, not a bill your users run up, and where every month of operation makes the dataset and the switching cost bigger.

---

## Sources

- [Claude API pricing, all models per 1M tokens (BenchLM)](https://benchlm.ai/anthropic/api-pricing)
- [Claude pricing guide 2026 (CloudZero)](https://www.cloudzero.com/blog/claude-pricing/)
- [OpenAI API per-token table 2026 (Morph)](https://www.morphllm.com/openai-api-pricing)
- [GPT-5.5 pricing breakdown (apidog)](https://apidog.com/blog/gpt-5-5-pricing/)
- [OpenAI embedding pricing (EmbeddingCost)](https://embeddingcost.com/openai)
- [Supabase pricing: what you'll actually pay (Makerkit)](https://makerkit.dev/blog/saas/supabase-pricing)
- [Vercel pricing plans and hidden costs (Schematic)](https://schematichq.com/blog/vercel-pricing)
- [AI startup gross-margin benchmark 2026 (Avante Ventures)](https://avanteventures.com/en/library/ai-startup-gross-margin-benchmark-2026)
- [The AI COGS problem: SaaS gross-margin compression (SaaSMag)](https://www.saasmag.com/ai-cogs-saas-gross-margin-compression/)
