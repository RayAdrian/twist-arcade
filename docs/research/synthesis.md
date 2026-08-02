# Synthesis: What To Build

*Orchestrator synthesis of three independent Fable-model research passes — market
(`market-lens.md`), experience (`ux-lens.md`), and systems (`architecture-lens.md`) —
run in parallel with no knowledge of each other. 2026-07-31.*

---

## 1. The finding that matters most

The three lenses picked **three different products**. But every product on all three
shortlists — across nine distinct ideas — reduces to **one machine**:

> Solicit documents by email → extract structured fields with a bounded LLM call →
> diff against a requirements template → chase expirations on a cron → export an
> audit packet.

| Lens | Top pick | Underlying machine |
|---|---|---|
| Market | FleetReady — DOT/FMCSA compliance for micro-carriers | DQ files + expirations + audit packet |
| Systems | CertShield — COI / vendor-insurance tracking | ACORD certs + expirations + compliance dashboard |
| Experience | Speak-your-paperwork trades back office | voice/photo → structured job records |

Three lenses reasoning independently from markets, from systems, and from human
experience converged on the same mechanism by three different routes. The market lens
got there via "non-discretionary recurring paperwork"; the systems lens via "the only
shape with 95%+ margins and zero platform risk"; the experience lens via "the
monetizable UX failure is data-entry burden, not ugliness."

**Consequence: the vertical is a parameter, not the product.** The engine is
vertical-agnostic. That is what makes this decision reversible — and reversibility is
worth a great deal here, because the confidence on any single vertical is low.

---

## 2. Cross-lens scoring

Each pick, scored against the lenses that did *not* choose it:

### Voice-first trades back office (UX #1) — **eliminated as the lead product**

- **UX's own objection:** tradespeople don't search for software, they search for
  "invoice template." Weak organic surface, and organic acquisition is criterion #2.
- **Architecture objection it never saw:** audio is metered COGS. The systems lens ranks
  media processing #4 among shapes that kill small teams and explicitly refuses the
  audio-COGS-against-flat-pricing product.
- Two independent lenses hit the same idea on two unrelated axes. That is a kill signal.
  **Voice input survives as a feature; it does not survive as the thesis.**

### FleetReady (Market #1)

- **Fits the architecture profile perfectly** — Postgres system-of-record, bounded
  extraction, `pg_cron` email loops, Tier-4 dependencies only (user documents +
  government data). The systems lens would have scored it near-identically to its own pick.
- **But its entire "why now" is unverified.** The market lens rated its own load-bearing
  claims honestly: Motus launch **medium-high**, e-DVIR rule **medium**, category-is-
  uncontested **low-medium** ("my interpretation, not a measured fact"), carrier count
  **medium** and likely overstated post-recession. Every source is a vendor blog or an
  aggregator; none is primary.
- The two things that make FleetReady beat COI — the forcing function and the empty
  category — are precisely the two lowest-confidence claims in the report.

### CertShield / COI tracking (Systems #1, Market #3)

- **Strongest structural case, and it doesn't depend on news.** ~1–3% inference COGS.
  ACORD 25 is semi-standardized, so the extraction problem is bounded and the eval-corpus
  moat is reachable fastest. Zero revocable dependencies. Willingness to pay pre-validated
  by enterprise incumbents charging per certificate. Buyer has a legal obligation from
  their own insurer, not a preference.
- **The flag:** apply the UX lens's own screening rule — *before committing to a hated
  incumbent, check whether the incumbent's challenger already exists* — and it fires.
  myCOI is the hated incumbent with a 200-certificate minimum; **TrustLayer already
  markets "no minimums."** That is structurally the Mindbody/Vagaro pattern the UX lens
  warned about. The market lens independently called COI "the most contested of the
  shortlisted wedges."

---

## 3. Recommendation

**Build the compliance-document-vault engine. Launch it first as COI tracking.
FleetReady is the designated pivot, not a rejected idea.**

Rationale:

1. **Lead with the vertical whose case survives without unverified claims.** COI's
   "why now" is structural — document AI collapsed the parsing cost that forced
   incumbents into certificate minimums. That is reasoning, not news. FleetReady's
   "why now" is a set of 2026 regulatory events sourced entirely from vendor blogs.
2. **The engine makes the vertical choice reversible.** If COI proves contested, the
   same solicit → extract → diff → chase → export loop repoints at DQ files (FleetReady),
   commercial leases (architecture lens idea E, higher price point, its named sibling),
   or probate documents. Weeks of rework, not a restart.
3. **Reversibility is worth more than TAM here** because confidence in any single
   vertical is the binding constraint, not market size. ~70 customers at ~$145 blended
   is $10k MRR; both verticals clear that by orders of magnitude.

**Economics (systems lens):** $79 / $149 / $299 tiers by tracked-certificate volume.
COGS ~$0.02–0.03 per certificate — a 300-vendor customer costs $1–3/mo against $99–299.
Build to paid MVP: 6–8 weeks.

**The known hard problem:** this is a trust-critical extraction product. A missed lapse
before an incident is the failure that ends it. The architecture answer is
confidence-gated human review, page-cited fields, an immutable event log, and
"verification assistant, not guarantee" positioning — converting an AI-accuracy problem
into a workflow with a review queue, which is what the enterprise incumbents already are.

---

## 4. Verification gate — before any code

Both checks are days, not weeks. Neither requires building anything.

**Gate A — is the COI tail actually open? (decisive, ~1 day)**
Get TrustLayer's real self-serve price and minimum. "No minimums" in marketing copy is
not the same as a self-serve $99/mo plan. If a customer tracking 40 certificates can
sign up today without a demo call, the wedge is contested and we lead with FleetReady
instead. If it routes to sales at $500+/mo, the tail is open.

**Gate B — does FleetReady's forcing function exist? (~1 week, run in parallel)**
Read the actual FMCSA / Federal Register text on Motus and e-DVIRs. Pull FMCSA's current
carrier census for the ≤10-truck count rather than trusting the derived ~530k. Check
Crunchbase for a funded competitor in flat-rate small-carrier compliance.

**Gate C — willingness to pay (both verticals, ~1 week)**
Ten conversations. What do they pay today, to whom, and what happens when a certificate
lapses or an audit lands. The market lens found list prices but **no retention or revenue
data for any vendor in either niche** — the pricing math is extrapolated from published
prices, not observed behavior.

Gate A alone decides which vertical leads. Nothing should be built before it clears.

---

## 5. Explicitly rejected

Carried forward so they are not re-proposed later:

- **AI meeting notetaker** — the systems lens's named trap. Metered audio COGS against
  flat pricing, a realtime bot SLA no solo operator can hold, Zoom/Teams/Meet shipping it
  natively at zero marginal price, and transcripts have no data gravity so churn is painless.
- **Anything on Tier 1 dependencies** — LinkedIn/Instagram automation, adversarial
  scraping, X API. Enforcement lands on your customers' accounts.
- **Chat-with-your-docs / generic AI wrappers** — if the value statement fits in one
  prompt, incumbents absorb it. Defensibility comes from the workflow and the owned
  records, never the model call.
- **Mindbody-alternative studio software** — hated incumbent, but Vagaro already holds
  the better-UX slot at 4.6/5.
- **Compliance-before-dollar-one categories** — clinical/HIPAA, fintech money movement,
  insurance brokerage, and FCRA-adjacent screening (resume, tenant).
- **Bookkeeping close portal** — most validated, most crowded; you would be the fifth
  logo in a comparison table competing on price.

---

## 6. B2C counter-scan — result: no switch, but one real role

All three lenses were re-run on B2C explicitly, and asked to attack their own elimination
of it. Reports: `market-lens-b2c.md`, `ux-lens-b2c.md`, `architecture-lens-b2c.md`.

**Two of the three refused to switch, in their own words.** Market: *"No — I would not
switch. FleetReady remains the pick, and it is not close."* Systems: *"No. Not on any axis
I care about, and it isn't close."* Experience did move estate settlement to #1 *within*
B2C, but was never asked to rank it against the B2B options.

### Why B2C loses for this team specifically

The margin objection turned out to be wrong, and the real objection is worse:

- **AI margin survives the 10x price compression.** A bounded document job costs $0.01–0.15
  whether the buyer pays $29 or $299. At $29 one-time that's still ~95% unit margin.
- **What breaks is everything around the margin.** Consumer subscription churn runs 4–9%/mo
  (~17% of monthly subscribers survive 12 months), so LTV lands at ~$110–150 against
  $5,000–7,000 for a $149/mo B2B tool at 2–3% churn. That LTV supports *no* paid
  acquisition, ever — organic becomes the only channel, permanently.
- **One-time pricing fixes churn by deleting the relationship.** Revenue = traffic ×
  conversion × price, resetting to zero monthly. $10k/mo means ~55 fresh strangers every
  month, forever, from an SEO surface Google can repossess in one update.
- **The decisive line, from the systems lens:** *B2C converts revenue into operational load
  at roughly 100x the rate B2B does.* Same $10k/mo is ~70 business accounts or ~10,000
  consumers — support, refunds, chargebacks ($15 dispute fee + $15 counter fee on a $29
  product), free-tier LLM-credit farming, and anonymous-upload moderation.
- **Free-alternative pressure is asymmetric.** ChatGPT reading one lease replaces most of a
  consumer lease reviewer. ChatGPT reading one ACORD certificate does not touch the
  compliance *loop* — solicitation, diffing, chasing, audit trail.

### The one B2C idea that earns a place

The systems lens found the connection worth acting on: **a renter lease reviewer's users
have landlords and property managers — who are literally the COI and lease-abstraction
buyers.** So the consumer tool is not a different business; it's top-of-funnel for the B2B
one, sharing the same engine and the same document types.

Sequence: **B2B core first, consumer document tool second, as an SEO asset — never
instead.** Built after the core earns, on ~80% shared architecture.

Guardrails if/when it is built, from the same report:
- The model never runs for an anonymous user. Free tier = deterministic work only.
  Otherwise a front-page spike is 100k × $0.02 = $2,000/day of inference for non-payers.
- Per-account token ledger in Postgres, checked before every call. Vercel Spend Management
  hard caps set *before* launch.
- Client-side PDF text extraction (pdf.js/WASM) so the file never leaves the browser —
  truthful, checkable privacy copy that converts, and a near-zero breach blast radius.
- Private, unshared, PDF-only uploads. Any user-to-user image sharing imports a CSAM
  moderation obligation that is operationally disqualifying for a solo team.

### Rejected in the B2C pass

- **AI companion / character chat** — the named B2C trap. Engagement is the direct COGS
  driver: unmetered chat at $9.99 loses ~$20/mo on every *successful* user. The better it
  works, the faster it loses money. Plus 24/7 moderation liability and zero moat.
- **Small-landlord tools** — TurboTenant, Innago, Avail, Baselane, Stessa all ship complete
  *free* tiers subsidized by tenant-paid screening fees and embedded banking. You cannot
  sell subscriptions against fintech-subsidized free without becoming a fintech.
- **Consumer health/insurance appeals** — strong demand, but two credible *free*
  competitors (Counterforce, Fight Health Insurance), and the FTC Health Breach
  Notification Rule plus state laws (e.g. WA My Health My Data) reach consumer health apps
  even where HIPAA does not. Compliance before dollar one.
- **"Honest Rocket Money"** — the complaint data begs for it, but it needs bank credentials
  at first touch, and a no-name site asking for a bank login converts near zero.
- **AI headshots, resume/ATS optimizers** — GPU COGS against a funded arms race; or a
  weekend clone with zero data gravity.

### The one unresolved disagreement, stated plainly

The market lens ranks FleetReady above CertShield; §3 of this document picks CertShield.
That disagreement is real and is *not* resolved by the B2C pass.

It stands as written, for one reason: the market lens's two grounds for preferring
FleetReady — the 2026 regulatory forcing function and the empty category — are the two
claims it *itself* rated lowest-confidence, both sourced from vendor blogs, with the
category claim labeled "my interpretation, not a measured fact." The systems lens's
grounds for CertShield are structural and depend on no unverified news. Prefer the case
that doesn't rest on claims we haven't checked.

Note also the market lens rates SettleKit and CertShield "roughly equal in expected
value — SettleKit's ceiling is higher, CertShield's floor is higher," while ranking
FleetReady clearly above both. If Gate A fails and CertShield is abandoned, FleetReady —
not SettleKit — is the pivot, and that lens's preference becomes operative anyway.

---

## 7. Philippines scan — unanimous: build for USD markets from Manila

All three lenses re-run on the PH market, and told not to be diplomatic or patriotic.
Reports: `market-lens-ph.md`, `ux-lens-ph.md`, `architecture-lens-ph.md`.

**All three reached the same verdict independently.** Market: *"build for dollar markets
from Manila."* Systems: *"No — not as a primary strategy. Build for USD markets and enjoy
the cost-base arbitrage."* Experience: *"The pain is bigger; the money is smaller; the moat
is realer."*

### The number that decides it

Identical code, identical support load, identical operational attention — **~9x less
revenue per customer.** 100 customers at ₱1,000/mo ≈ $1,640/mo. The same 100 customers at
$149/mo = $14,900/mo.

Supporting facts:
- PH SMB software ceiling is ₱1,000–3,000/mo ($17–52) against a US B2B band of $50–300 — a
  **4–8x ARPU gap**, anchored on real local pricing (Taxumo ₱700–1,888/mo, QNE ₱2,500/mo).
- The payer pool is thin: ~1.2M MSMEs but ~90% are micro and can pay approximately nothing.
  The real candidate pool is on the order of ~100k small+medium businesses nationally. The
  US has 530k trucking micro-carriers *alone*.
- $10k MRR = ~70 US customers vs ~195–385 PH customers, at 3x the servicing cost each.

### The rails problem, which is worse than the pricing problem

- **Stripe from the Philippines is functional but hobbled:** PH accounts accept cards, but
  payouts are PHP-only to a PH bank and USD payments are force-converted, taking FX loss on
  every transaction.
- **GCash — the wallet the mass market actually uses — cannot be relied on for
  subscriptions.** Recurring failures are documented even for Spotify-scale merchants.
  PayMongo auto-recurs on cards and Maya only; GCash recurring requires emailing support.
- So **the dominant rail is the one that auto-renews worst.** Involuntary churn replaces
  voluntary churn as the main failure mode, and at 100+ customers on monthly manual billing,
  reconciliation is realistically 1–2 days/week of the operator's time — the exact scarce
  resource.
- The workaround is real but it reshapes the whole model: **bill like prepaid load, not like
  Netflix.** Annual-prepaid by default, a credit ledger in Postgres, per-cycle payment links
  with webhook auto-reconciliation, and auto-recurring offered only where it works.

### The cost-base arbitrage runs the other way

USD revenue on a PHP cost base is this operator's single largest structural advantage —
worth an estimated 3–5x in purchasing power versus a US-based competitor. PHP revenue on
USD costs is the same arbitrage in reverse, and it gets worse: the peso has drifted
₱57.5 → ~₱62 across 2026, so USD-denominated COGS inflate in PHP terms every year while PH
price points stay sticky.

**Nothing about operating from Manila degrades CertShield.** Deploy to US regions, form a
US LLC for full Stripe (~$500 formation, ~$2–3.5k/yr steady state with a CPA — note Form
5472 carries a $25,000 failure-to-file penalty). Timezone is a mild headwind for support
and a mild tailwind for maintenance windows. Caveat worth stating: the LLC buys payment
rails and market access, **not a tax holiday** — the Philippines taxes residents on
worldwide income, so confirm the structure with a PH tax professional.

### The three legitimate PH exceptions, in order

1. **PH customers who earn USD** — freelancers and agencies billing foreign clients. PH
   domain knowledge as the moat, dollar-adjacent willingness to pay as the economics. The
   systems lens's pick here is a BIR tax copilot for freelancers at annual-prepaid pricing.
2. **PH domain expertise sold *to* USD buyers** — the inverted arbitrage: tools for US
   companies managing Philippine teams and contractors, priced in USD, differentiated by
   local knowledge no US competitor has. Worth remembering.
3. **PH as SEA beachhead — mostly a mirage.** Compliance-document workflows are
   jurisdiction-locked; BIR forms and LGU permits transfer 0% to Indonesia or Vietnam. The
   one honest version: Xendit spans PH and Indonesia, so a product on Xendit's rails has a
   real second market. An option to hold, not a reason to start.

### Findings worth keeping regardless of geography

- **The fixer economy is a price signal.** Where an American rage-posts, a Filipino pays a
  liaison ₱2,000–5,000 to absorb the bad UX. That fee is what bad UX already costs, in cash,
  today — no willingness-to-pay guesswork needed.
- **The aggregator route around an ARPU cap.** PH MSMEs outsource compliance, so the MSME
  isn't the buyer — the firm serving 30–100 of them is. Generalizes to any low-ARPU market.
- **Watch the regulator's direction, not just the rule.** SEC *suspended* monthly penalty
  accumulation until end-2026 — fear going down is an anti-forcing-function. A compliance
  product only sells where non-compliance actually costs something.
- **Stay beside the books, never be the books.** BIR CAS/PTU registration triggers if you
  become the accounting system of record above ₱3M revenue.
- **DPA has no data-localization requirement** (Singapore hosting is fine), but government
  IDs — TIN, PhilHealth, SSS — count as *sensitive* personal information, and storing them
  for ≥1,000 individuals triggers mandatory NPC registration. Don't store government IDs
  unless the product's value depends on them.

### The PH trap, named

**Sari-sari store / micro-retail digitization.** The most-pitched idea in the country and it
fails every filter at once: near-zero PHP willingness to pay against USD costs, a hard
offline-first requirement on low-end Android, distribution requiring physical field
operations rather than SEO, and the only proven monetization (selling shelf data to CPG
brands) needs scale and a field force before the first peso — a venture play, not a solo
one. Refuse it in all its costumes: karinderya POS, tricycle-fleet apps, palengke
marketplaces. Also refused: anything that moves money (BSP licensing), and mass-market
₱99/mo consumer apps.

---

## 8. What was actually learned

Three rules worth keeping regardless of which product wins:

1. **"In the AI era, the test set is the moat, not the model."** The extraction pipeline
   is a weekend clone. The corpus of thousands of labeled real-world documents
   accumulated from production is not.
2. **Price and meter in the same unit the model bills you in** — documents, runs, pages.
   Never "unlimited." The inverse correlation (heaviest users are least profitable) is
   what compresses AI-SaaS margins to ~52% against the classic 75–80%.
3. **Before attacking a hated incumbent, find its challenger.** Bad reviews are not an
   opening if someone already banked the better-UX position.
