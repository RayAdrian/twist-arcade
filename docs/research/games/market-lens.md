# Market Lens: "Twisted Classics" Browser Game Library

**Research pass — market, audience, distribution, business model.**
Product concept: a free website hosting dozens of short, browser-based games that are dynamic twists on familiar classics (seed example: tic-tac-toe where older moves decay and disappear).
Date: 2026-08-02. Claims are cited where possible; unverified numbers are labeled **estimate**.

---

## 1. Competitive landscape

### 1a. Daily puzzle / word games (NYT Games, Wordle clones, Connections)
- **What they do well:** the daily ritual. NYT reported its puzzles and games were played **8+ billion times in a year** ([Game Developer](https://www.gamedeveloper.com/design/the-rise-of-newspaper-games)). Since Wordle's 2022 acquisition, NYT digital subscription revenue jumped ~43% ([WordsRated](https://wordsrated.com/impact-of-wordle-on-nyt/)); the NYT Games app alone did ~$11.2M in IAP in a single quarter of 2024 ([Statista via search](https://statista.com/statistics/1493616/nyt-games-app-revenue-worldwide)).
- **Monetization:** subscription-first (Games sub / All Access), light ads for free users.
- **Gap left:** NYT's games are *word/logic* puzzles, single-player, one-per-day. They do not touch **two-player classics** (tic-tac-toe, checkers, dots-and-boxes, connect-four) or *rule-subversion* as the core pleasure. The Wordle-clone long tail (Heardle, Worldle, Quordle…) proved appetite for format riffs but is mostly abandoned one-offs — nobody curates them into a maintained library.

### 1b. Aggregator portals (Poki, CrazyGames, Coolmath, itch.io, Kongregate, Miniclip)
- **Poki:** 625M players in 2025, ~100M monthly actives, 1B gameplays in a peak month, 65-person team, no outside funding ([Yahoo Finance](https://finance.yahoo.com/sectors/technology/articles/poki-announces-milestone-625-million-050000965.html)). ~44% of desktop visits arrive via organic search ([Similarweb](https://www.similarweb.com/website/poki.com/)). Monetizes via ads (heavily rewarded video); 50/50 rev share with devs for Poki-sourced traffic ([Poki docs](https://sdk.poki.com/deals)).
- **CrazyGames:** dev rev share 60/40 on ads, 70/30 on IAP, €100 payout threshold, SDK required ([CrazyGames docs](https://docs.crazygames.com/faq/), [developer portal](https://developer.crazygames.com/)).
- **Coolmath Games:** ~14–25M monthly visits, ~80% US traffic (high-value ad inventory), avg session ~10 minutes; display ads + $5.99/mo ad-free sub + licensing ([Similarweb](https://www.similarweb.com/website/coolmathgames.com/), [CelebrityNetWorth profile](https://www.celebritynetworth.com/articles/entertainment-articles/random-website-youve-never-heard-makes-60k-per-day/)). Coolmath is the proof that a *curated, school-safe brand* on top of commodity games is worth tens of millions of visits.
- **itch.io:** the de facto home of experimental browser games post-Kongregate, but discovery is jam-driven and shallow; no habit loop, no daily mechanic.
- **Kongregate:** stopped accepting new games in 2020, shut forums/chat ([Slashdot](https://games.slashdot.org/story/20/07/01/2049206/kongregate-no-longer-accepting-new-games-shutting-down-forums-and-chat)) — its community-portal model died, leaving a vacuum for *identity-carrying* web game destinations.
- **Miniclip:** pivoted almost entirely to mobile apps; the web portal is legacy.
- **Gap left:** portals are **libraries without a voice**. They aggregate thousands of third-party games; none has a coherent creative identity ("every game here is a classic, twisted"), and none runs a daily-ritual layer across the library. Poki/CrazyGames are also *distribution channels you can use*, not just competitors.

### 1c. Abstract-strategy specialists (BGA, Chess.com/Lichess variants, Hex/Arimaa)
- **Board Game Arena:** 10M+ registered accounts post-Asmodee acquisition ([BoardGameWire](https://boardgamewire.com/index.php/2024/08/14/asmodees-boardgamearena-buyout-reaps-rewards-as-service-passes-10-million-accounts/)); freemium, $42/yr premium as of July 2025 ([PriceTimeline](https://pricetimeline.com/news/41)). Strength: licensed real board games, async play. Weakness for our space: heavyweight UX, licensed catalog — it will never do "tic-tac-toe but decaying."
- **Lichess variants:** Crazyhouse ~21M lifetime games, Antichess ~25M, Atomic ~19.6M; but the top variants each attract only **~2% of the player base vs. blitz** ([Lichess forums](https://lichess.org/forum/general-chess-discussion/most-popular-variants-on-lichess?page=1)). Lesson: variants of a *hard* game are a niche of a niche.
- **Chess.com variants:** popularity is **creator-driven spikes** — Fog of War peaked when GothamChess/Hikaru videos hit 4.6M views; Duck Chess spiked in 2023 off IM Rosen's videos, then subsided; Fog of War had ~22.7k active players as of an Aug 2025 community post ([Chess.com blog](https://www.chess.com/blog/ChessMasterGS/the-forgotten-feature-variants-on-chess-com)). Lesson: variant demand is real but **content-creator-ignited**, not organic.
- **Hex/Arimaa communities:** tiny (thousands, not millions — **estimate**; playhex/BGA tables and old forums). Not a market; a credibility source.
- **Gap left:** all of these twist games that are *already hard*. Twisting **kindergarten-simple** games (tic-tac-toe, connect-four, snake, minesweeper) has a radically wider funnel — zero rules-teaching cost, twist is instantly legible.

### 1d. "Weird variant" projects — the closest creative comps
- **Zach Gage** (Really Bad Chess, Good Sudoku, Knotwords, Flipflop Solitaire): the canonical "subverted classics" designer — randomized chess pieces to "level the playing field" and make classics approachable ([Slate](https://slate.com/technology/2016/10/really-bad-chess-proves-that-games-dont-need-to-be-fair.html), [Game Developer](https://www.gamedeveloper.com/design/how-zach-gage-breaks-all-of-the-rules-in-i-really-bad-chess-i-)). But he ships **premium mobile apps**, one game at a time — nobody has done "Zach Gage as a free web library."
- **The decaying tic-tac-toe seed already exists and already went viral**: "Infinite Tic-Tac-Toe" (only 3 pieces on board; placing a 4th removes your oldest) circulated widely on TikTok, spawned multiple app-store clones and a physical toy (GiiKER Tic-Tac-Toe Bolt) ([App Store listing](https://apps.apple.com/us/app/vanish-tic-tac-toe/id6759029498), [infinitytictactoe.com](https://www.infinitytictactoe.com/), [TikTok](https://www.tiktok.com/discover/infinite-tic-tac-toe-toy)). **Read this both ways:** it validates the seed mechanic's mass appeal, and it means the seed game alone is not defensible — the *library + ritual* must be the product.
- **neal.fun:** solo dev, ~2–4M monthly visitors; Infinite Craft was the **3rd most-searched game globally in 2024** ([gameplaydev substack](https://gameplaydev.substack.com/p/this-solo-web-game-dev-went-viral), [postunreel guide](https://postunreel.com/blog/neal-fun-complete-guide)). Closest structural comp: a *personality-branded library* of small novel web experiences. Gap: neal.fun is experiences/toys, not competitive classics, and has no retention layer — it lives on repeated viral spikes.
- **Puzzmo:** launched 2023 (Pile-Up Poker = poker × sudoku), acquired by Hearst within months ([Game Developer](https://www.gamedeveloper.com/design/the-rise-of-newspaper-games)) — evidence that "curated twisted-classic library with daily ritual" is an acquirable asset. Puzzmo owns the *newspaper-puzzle* aesthetic; the *playground-game* aesthetic (tic-tac-toe, snake, pong, checkers) is unclaimed.
- **LinkedIn Games:** 8 daily games since May 2024, now "one of the largest drivers of conversations in the app" ([Social Media Today](https://www.socialmediatoday.com/news/linkedin-adds-seventh-in-app-puzzle-game/815147/), [Fortune](https://fortune.com/2024/07/22/linkedin-microsoft-puzzles-games-ai-network-attract-users/)) — daily micro-games as engagement infrastructure is now a proven corporate strategy (also a future B2B licensing buyer signal).

### 1e. Viral one-off hits (2048, Wordle, Cookie Clicker, Threes, Slither.io)
- **2048** (2014): weekend clone-of-a-clone of Threes, free + open source, exploded precisely because it was free and in-browser while Threes was $2.99. **Threes' polish lost to 2048's frictionlessness** — a foundational lesson for this product.
- **Wordle:** free, no app, one/day, share grid → sold to NYT for a reported low-seven-figures. See §4 for the share-grid anatomy.
- **Cookie Clicker, Slither.io:** ad-supported browser hits; Slither.io's developer reportedly earned ~$100k/day at peak in 2016 (widely reported at the time; treat as unverified peak anecdote).
- **Pattern across all of them:** viral one-offs monetize badly *as one-offs* (traffic decays 90%+ within months — **estimate**) unless they either sell (Wordle) or sit inside a portal/library that catches the falling traffic. **That catch-basin is exactly what a library is for.**

**Landscape summary:** the specific quadrant — *free, browser, curated library, of twisted playground classics, with a daily ritual layer* — is empty. Puzzmo is nearest on model (but newspaper-puzzle genre), neal.fun nearest on brand (but no ritual/competition), Poki nearest on scale (but no identity), Gage nearest on design (but paid mobile).

---

## 2. Where the actual demand is

- **Daily-puzzle habit is enormous and still growing:** NYT 8B+ annual plays; LinkedIn shipped 8 games in ~18 months and keeps adding; Hearst bought Puzzmo. This is the strongest demand signal in casual gaming this decade.
- **Web gaming overall is huge and under-discussed:** Poki alone: 625M players/yr, ~100M MAU ([Yahoo](https://finance.yahoo.com/sectors/technology/articles/poki-announces-milestone-625-million-050000965.html)); Game Developer calls it "the huge, hidden web game market" ([article](https://www.gamedeveloper.com/business/the-huge-hidden-web-game-market-no-one-talks-about-and-how-to-get-in-)).
- **Variant appetite is real but ignition-dependent:** Lichess variants = ~2% of players each; Chess.com variant spikes track creator videos (4.6M views on Fog of War content) — demand exists but is unlocked by *watching someone play*, not by searching. Twisted classics are inherently **more watchable** than standard classics (the twist is the content).
- **The seed mechanic has already demonstrated demand:** Infinite/Vanishing Tic-Tac-Toe went viral on TikTok organically, with clone apps and a physical toy riding it. Nobody consolidated that demand into a destination.
- **School/downtime ("unblocked") traffic is real, large, and messy:** the ecosystem is a hydra of mirror sites on github.io/gitlab.io/Google Sites precisely because filters keep killing them; individual mirrors show tens of thousands of visits each on Similarweb ([e.g. 66games.io ~26k/mo](https://www.similarweb.com/website/66ez.github.io/competitors/)), but the aggregate across hundreds of mirrors plus Coolmath's 14–25M visits/mo shows the school-Chromebook segment is one of the largest sources of web-game sessions in the US ([Similarweb Coolmath](https://www.similarweb.com/website/coolmathgames.com/)). Honest assessment: chasing "unblocked" keywords directly is a reputational and Google-policy tar pit; being *lightweight, no-login, school-safe, and fast on Chromebooks* captures the demand without the branding.
- **Mobile vs desktop:** Poki self-reports ~40% mobile (Similarweb estimates 32%); top-10 browser-game sites range from <4% to 52% mobile ([Naavik](https://naavik.co/digest/web-gaming-strikes-back/), [Game Developer](https://www.gamedeveloper.com/business/the-huge-hidden-web-game-market-no-one-talks-about-and-how-to-get-in-)). Design conclusion: **desktop/Chromebook-first for the school/office segment, but every game must be thumb-playable** because TikTok-sourced traffic arrives on phones.
- **Community demand pools:** r/BoardGames (~4M members — **estimate from public sub counts**) tolerates digital-adaptation talk; r/AbstractGames (tens of thousands — **estimate**) is small but exactly on-topic; r/WebGames and r/InternetIsBeautiful have historically launched browser hits; Hacker News reliably front-pages clever minimal games.

---

## 3. Audience segments (ranked by zero-budget reachability)

1. **Bored-at-school students (US, 11–18, Chromebooks).** Try anything that loads in <3s with no login; return if friends play the same game (local 2-player and "beat my score" matter). Reached via: word of mouth in class (the strongest WoM engine on earth), SEO for game names, the fact that a lightweight new domain isn't blocked yet. Highest volume, lowest revenue/user, zero direct marketing possible — you win them by being fast, free, and 2-player-on-one-keyboard.
2. **Daily-ritual puzzle players (25–45, do Wordle/Connections/LinkedIn games in coffee-break slots).** Try via a shared result grid or a listicle ("games like Wordle"); return for streaks and a *new twist every day*. Reached via: share mechanics, r/wordle-adjacent subs, newsletters, "daily game" roundup sites. Best revenue (US, tolerates a sub), best habit fit.
3. **HN/Reddit novelty seekers (dev-adjacent 20–40).** Try anything with a clever mechanic + clean execution; they don't retain, but they *ignite* — one good Show HN or r/InternetIsBeautiful post seeds every other segment and earns backlinks (SEO). Reached via: launch posts, open-sourcing one game, a good write-up of the design math (e.g., "is decaying tic-tac-toe solved?").
4. **Board-game/abstract-strategy hobbyists.** Try if the twist is *strategically interesting*, not just cute; return for ranked play/Elo and depth discussion. Reached via: r/AbstractGames, r/boardgames, BGG forums, Discord servers. Small but they generate strategy content, wiki pages, and legitimacy.
5. **Office icebreaker / social players (Slack/Teams crowds).** Try when a colleague drops a challenge link; return weekly, not daily. Reached via: challenge-link mechanics ("I set up a board, beat me"), later B2B. Deferred — needs multiplayer infrastructure.

---

## 4. Distribution at $0 (ranked by expected yield)

1. **Shareable result artifacts (the Wordle mechanic) — build this into every game from day one.** Why the Wordle grid worked, precisely: (a) *spoiler-free* — showed struggle, not answer; (b) *identical daily instance* — everyone compares on the same puzzle, so the artifact invites conversation, not just broadcast; (c) *renders natively as emoji text* — survives every platform (Twitter, WhatsApp, Slack) with zero images or links needed, yet implies the link; (d) *skill signal* — bragging with plausible deniability ([Emoji Timeline](https://emojitimeline.com/wordle-players-use-emojis-to-share-their-results/), [Puzzle Cottage history](https://puzzlecottage.com/wordle-history)). **Generalization for a versus/board library:** the artifact should encode the *drama of the twist* — e.g., for decaying tic-tac-toe, an emoji strip of the final 5 moves showing pieces winking out, plus "Daily Board #37 — won in 9 moves." Every game needs its own one-line emoji grammar.
2. **Reddit + HN launches.** Show HN and r/InternetIsBeautiful / r/WebGames are proven launchpads for exactly this product shape (2048, many neal.fun pieces). Norms: post the thing itself, no marketing tone, engage in comments, one sub at a time, respect self-promotion ratios. Expect 1–3 spikes of 10k–100k visits (**estimate** based on typical HN front-page traffic reports); the job is converting spikes into daily-ritual retention.
3. **SEO — realistic and compounding, but slow.** Winnable queries: long-tail variant names ("tic tac toe but pieces disappear", "infinite tic tac toe online", "connect 4 variants", "games like wordle but strategy"), each game's own coined name, and "X online free no download." Poki gets ~44% of desktop traffic from organic search — search is *the* web-games channel ([Similarweb](https://www.similarweb.com/website/poki.com/)). **"Unblocked" verdict:** the traffic is real but do not brand for it — sites courting "unblocked" keywords get filter-blacklisted, advertiser-shunned, and live on disposable mirror domains. Instead: be technically indistinguishable from an educational tool (fast, no chat, no gore, clean domain) and let the segment find you.
4. **TikTok/Shorts/Reels gameplay clips.** The variant category is *made* for this — Chess.com variant surges were literally caused by creator videos, and Infinite Tic-Tac-Toe's virality was TikTok-native. $0 play: post 15–30s clips of twist reveals ("watch the oldest X vanish"), and — higher leverage — DM small/mid chess-tok and puzzle creators offering a novel format for *their* content. You are giving creators material, not asking for favors.
5. **Aggregator syndication (Poki/CrazyGames) — real money and reach, with a catch.** CrazyGames: open portal, 60/40 ads / 70/30 IAP, SDK integration, review in days ([docs](https://docs.crazygames.com/faq/)). Poki: curated, 50/50 on Poki-sourced traffic, wants web exclusivity for the open web ([deal docs](https://sdk.poki.com/deals)) — **exclusivity conflicts with owning your destination site**, so: syndicate 1–2 *older* library games to CrazyGames as funded marketing (game carries your brand + "more twists at…" within portal rules), never your dailies, and decline exclusivity deals.
6. **Discord communities + a home Discord.** Post in abstract-games/chess-variant/puzzle servers where norms allow; a home server matters once dailies exist (streak-sharing culture). Modest reach, high retention value.
7. **Teacher/school channels.** Coolmath proved the brand power of "teacher-tolerated." Realistic $0 version: a "for classrooms" page, logic-teaching framing for 2–3 games, posts in r/Teachers-adjacent spaces *only* with genuine pedagogic framing. Slow burn; do not lead with it.
8. **What does not work (be honest):** paid-lookalike growth hacks with no budget; cold-emailing journalists pre-traction; Product Hunt for games (wrong audience); Facebook; app-store ports at this stage; and expecting itch.io to drive traffic (it's a host, not a channel).

---

## 5. Retention mechanics for a *library* (habit vs. cargo cult)

**Genuine habit-formers:**
- **Daily seeded challenge per game, one featured "Daily Twist" for the site.** The single most proven mechanic in the space (NYT, LinkedIn, Puzzmo). The library angle: the *site* has one canonical daily (rotating across games), so the ritual attaches to the brand, not one game. Same seed for everyone = comparable results = shareable artifacts (§4.1).
- **Streaks — for the site daily, not per game.** Per-game streaks across dozens of games create guilt-debt and churn; one site-level streak ("played today's Twist") is Duolingo-grade glue without the burden.
- **Weekly variant drops ("New Twist Tuesday").** A library's unique retention weapon that no single game has: a *reason to come back that is content, not obligation*. Also generates a recurring social/newsletter beat.
- **Async challenge links** ("here's my board/seed — beat me"). Cheap to build (no realtime infra), turns every player into distribution, fits office/school segments.

**Useful later, not at launch:**
- **Daily leaderboards (per-seed, reset daily).** Good once traffic exists; global all-time boards get botted and demoralize newcomers.
- **Elo/ranked realtime play.** Only after a game demonstrably sustains a versus community; premature Elo on thin liquidity = empty lobbies = death. Lichess variant data (~2% per variant) warns how thin variant matchmaking pools get.

**Cargo-culted for this product (skip):** XP/levels/badges divorced from play, login-gated streaks (login must stay optional; localStorage first), daily-reward coins, energy systems, and per-game battle passes. Casual-web benchmarks to calibrate against: puzzle-genre D1 ~32%, D7 ~12%, D30 ~5% on mobile ([appagent](https://appagent.com/blog/mobile-game-retention-benchmarks/), [Solsten](https://solsten.io/blog/d1-d7-d30-retention-in-gaming)); anonymous web traffic will look worse than app numbers — treat these as ceilings, not targets (see §7).

---

## 6. Monetization (free-to-play)

**Realistic web-game ad economics.** Display/AdSense on game pages runs low single-digit RPM; gaming CPMs commonly quoted ~$4–15 gross with publisher net far lower ([MonetizeMore](https://www.monetizemore.com/blog/youtube-ad-revenue-gaming-companies/), [TastyCherry AdSense-for-games writeup](https://tastycherrygames.com/2024/07/31/making-money-through-html5-ads-in-games-with-adsense/)). Google's **H5 Games Ads** (AdSense) provides interstitial + rewarded formats for web games ([Google](https://adsense.google.com/start/h5-games-ads/)); rewarded video is what Poki leans on as its primary format ([Yahoo](https://finance.yahoo.com/sectors/technology/articles/poki-announces-milestone-625-million-050000965.html)). Verified per-1k-session net figures for indie sites are not published; the model below uses stated assumptions.

**Revenue per 1,000 sessions — honest model (all assumptions labeled):**
- Assume 60% US-heavy traffic (school/office skew), avg 1.6 ad impressions/session net of blockers and short sessions (interstitial between games + one anchor unit; ad-block rate ~30% on this demo — **estimate**), blended net eCPM $2.50 (display + occasional interstitial; US-heavy — **estimate**, could be $1–$5).
- → **~$4 per 1,000 sessions** base case (range **$1.5–$8**). Rewarded video (opt-in "reveal the daily solution" / cosmetics) can add $1–3 per 1k sessions at 5–10% opt-in and $10–20 rewarded eCPM (**estimates**).
- At 3k sessions/day (month-6 "working" case, §7): ~$360–$700/mo. At 30k sessions/day (breakout): ~$3.6k–$7k/mo.

**Break-even sketch:** static-first Next.js/CDN hosting for client-side games ≈ **$0–25/mo** up to ~1M pageviews (Vercel/Cloudflare Pages free tiers; a small Supabase instance for dailies/leaderboards free–$25/mo), domain ~$12/yr. **Break-even at roughly 100–300 sessions/day** — trivially low. This is the category's structural advantage: costs are ~zero, so the site can survive indefinitely while compounding SEO.

**Stack, in order of realism:**
1. **Ads (H5 Games Ads / AdSense → better networks at scale)** — day-one baseline. Keep density Coolmath-like, not unblocked-site-like; the daily-ritual page itself should stay clean.
2. **Ad-free supporter tier, $2–3/mo or $15–25/yr** — priced *well under* NYT Games and BGA ($42/yr, [PriceTimeline](https://pricetimeline.com/news/41)). Bundle: no ads, streak insurance, archive access to past dailies (the proven NYT/Puzzmo archive-paywall play), extra stats. Expect 0.5–2% conversion of WAU (**estimate**).
3. **Donations (Ko-fi/GitHub Sponsors)** — near-zero cost to add; meaningful only pre-scale; Cookie Clicker/indie precedent.
4. **Portal licensing/syndication** — CrazyGames 60/40 as paid distribution for 1–2 non-daily games (§4.5); top web-portal performers reach up to €1M/yr on Poki ([Yahoo](https://finance.yahoo.com/sectors/technology/articles/poki-announces-milestone-625-million-050000965.html)) — that's the far-tail, not the plan.
5. **Cosmetics** — piece skins/board themes; only worth building after accounts exist; never pay-to-win (destroys the fairness that makes twists legible).
6. **Sponsorship ("Daily Twist presented by…") and B2B (school site licenses, corporate icebreaker packs, LinkedIn-style licensing of the format)** — genuine options at 100k+ MAU with a clean brand; not before. LinkedIn's games push shows corporates buy daily-game engagement ([Fortune](https://fortune.com/2024/07/22/linkedin-microsoft-puzzles-games-ai-network-attract-users/)).

**Honest revenue conclusion:** this is a **low-cost, slow-compounding media asset**, not a fast business. Year-one revenue is beer money in most scenarios; the asymmetric upside is (a) a viral hit lifting the whole library, (b) acquisition interest of the Puzzmo/Wordle kind, (c) a durable SEO annuity like Coolmath.

---

## 7. Metrics and 12-month trajectory

**Leading indicators (in priority order):**
1. **Share-rate:** % of completed dailies that copy the result artifact. This is the growth engine; target ≥8–10% (Wordle-era share rates aren't published; **estimate** anchored to its visible virality).
2. **Return rate D1/D7 for daily players:** web+anonymous will undercut app benchmarks (puzzle apps: D1 ~32%, D7 ~12% — [appagent](https://appagent.com/blog/mobile-game-retention-benchmarks/)). Healthy here: **D1 20–25%, D7 8–12%** for users who finished a daily (**estimates**).
3. **Games-tried-per-visit:** the library's raison d'être; target ≥2.0 by month 3. If people play one game and leave, you built a game, not a library.
4. **Sessions/user/week among WAU** (target 3+), and **% of traffic from search** (compounding channel health).
5. K-factor proxy: new visitors landing on a shared-result URL / sharers.

**Trajectory — "working" vs "not working":**
- **Month 1** (launch: 5–8 games + one daily + share artifact): working = one Reddit/HN spike ≥10k visits, share-rate ≥5%, any organic day-7 returners. Not working = spikes with <2% share-rate and D7 ≈ 0 → the artifact or the daily is wrong; fix before adding games.
- **Month 3** (12–15 games, weekly drop cadence): working = 300–1,000 organic sessions/day baseline between spikes, games-tried ≥2, first search-console impressions on variant queries. Not working = traffic only exists during launch posts → retention layer failing.
- **Month 6** (~20 games, leaderboards on dailies): working = 2,000–5,000 sessions/day, D7 ≥8% of daily-finishers, one game showing outsized pull (your franchise), first $100s/mo of ad revenue. Not working = <500 sessions/day and flat search growth → concept isn't compounding; consider pivoting to the one game that over-performs.
- **Month 12:** working = 10k–30k sessions/day, supporter tier live with 100+ subs, a creator-made video about at least one game, search queries *for your coined game names* appearing. Breakout (not the plan, but the shape of it) = one game does an Infinite-Craft/2048 and the library catches the falloff.
(All trajectory numbers are **estimates/planning targets**, not benchmarks.)

---

## 8. Naming & positioning

**One-sentence claim:** *"Classic games you already know how to play — with one rule changed that changes everything. Free, in your browser, a new twist every week."*

Positioning pillars: (1) zero rules-teaching — you already know these games; (2) the twist is the hero — name every variant memorably; (3) instant — no install, no login, loads on a school Chromebook; (4) daily ritual + shareable bragging.

**Name directions** (no trademark clearance done; obvious collisions flagged):
1. **Twisted-rule frame:** "One Rule Off", "House Rules" (collision: common phrase, several tabletop shops/podcasts use it), "Rulebreakers" (collision: a FIFA Ultimate Team promo is called Rulebreakers).
2. **Decay/entropy frame (leans on flagship):** "Fadeplay", "Vanishing Point Games" (collision: famous 1971 film; likely fine for games but crowded), "Halflife Games" — **avoid**, obvious Valve collision.
3. **Playground-classics frame:** "Recess Remixed", "Playground Rules", "Chalklines".
4. **Short coined:** "Twistle" (rides Wordle-suffix recognition; many -le clones exist, check collisions), "Skewed", "Warp Classics".
5. **Library/ritual frame:** "The Daily Twist" (collision check needed: newsletters use "Daily Twist"), "Twist Arcade".
Strongest candidates on balance: **"One Rule Off"** (says the whole thesis), **"Twist Arcade"** (says library + genre), **"Recess Remixed"** (owns the school segment tone).

---

## Recommended go-to-market

**Launch wedge: the decaying tic-tac-toe (give it a proper coined name, e.g. "Fadeout") + a same-seed daily puzzle mode + an emoji share artifact.** Rationale: the mechanic has *already proven* TikTok-scale appeal (Infinite Tic-Tac-Toe, GiiKER toy) but no one owns a polished browser destination for it; it's legible in one Short; vs-AI daily mode sidesteps multiplayer liquidity at launch.

**Sequencing:**
1. **Weeks 0–4:** ship 5–8 games (Fadeout, plus twists on connect-four, snake, minesweeper, dots-and-boxes…), one site-wide Daily Twist, share artifact, hotseat 2-player on every board game, localStorage streaks. No accounts, no ads yet.
2. **Launch week:** Show HN + r/InternetIsBeautiful/r/WebGames (staggered), simultaneously seed 3–5 TikTok clips of the vanish moment; measure share-rate above all.
3. **Months 2–3:** New Twist Tuesday cadence; SEO pages per variant name and per "classic + variant" query; H5 Games Ads on; submit one older game to CrazyGames (non-exclusive) with in-portal branding.
4. **Months 4–6:** daily per-seed leaderboards; challenge links (async, sharable); creator outreach with the best-performing game; supporter tier.
5. **Months 7–12:** double down on whichever single game over-performs (it becomes the brand's Wordle); only then consider realtime versus/Elo, cosmetics, and teacher packaging.

**Kill list:** realtime multiplayer and Elo at launch (liquidity death); accounts as a requirement (friction death); "unblocked" branding (policy/reputation death); Poki web-exclusivity deals (kills the destination); mobile app ports (wrong fight); global all-time leaderboards (bots); building 40 games before proving the ritual (breadth before habit is the classic portal mistake); chess/go variants as the wedge (Lichess's ~2%-per-variant data says hard-game variants are the niche, not the funnel).

---

## Sources

- Poki 625M players / 100M MAU / rewarded-video model: https://finance.yahoo.com/sectors/technology/articles/poki-announces-milestone-625-million-050000965.html
- Poki deal terms & requirements: https://sdk.poki.com/deals ; https://sdk.poki.com/new-requirements
- Poki traffic mix: https://www.similarweb.com/website/poki.com/
- Web game market overview + mobile split: https://www.gamedeveloper.com/business/the-huge-hidden-web-game-market-no-one-talks-about-and-how-to-get-in- ; https://naavik.co/digest/web-gaming-strikes-back/
- CrazyGames rev share & submission: https://docs.crazygames.com/faq/ ; https://developer.crazygames.com/ ; https://docs.crazygames.com/requirements/intro/
- NYT Games / Wordle business impact: https://wordsrated.com/impact-of-wordle-on-nyt/ ; https://sherwood.news/business/the-new-york-times-is-a-games-company-with-a-newspaper-side-hustle/ ; https://statista.com/statistics/1493616/nyt-games-app-revenue-worldwide
- Wordle share-grid history: https://puzzlecottage.com/wordle-history ; https://emojitimeline.com/wordle-players-use-emojis-to-share-their-results/ ; https://dinogame.gg/blog/history-of-wordle/
- Newspaper-games boom / Puzzmo / Hearst: https://www.gamedeveloper.com/design/the-rise-of-newspaper-games
- LinkedIn games: https://www.socialmediatoday.com/news/linkedin-adds-seventh-in-app-puzzle-game/815147/ ; https://fortune.com/2024/07/22/linkedin-microsoft-puzzles-games-ai-network-attract-users/
- Lichess variant popularity: https://lichess.org/forum/general-chess-discussion/most-popular-variants-on-lichess?page=1 ; https://lichess.org/forum/lichess-feedback/variants-popularity-stats
- Chess.com variants (Fog of War, Duck Chess, 4-player): https://www.chess.com/blog/ChessMasterGS/the-forgotten-feature-variants-on-chess-com ; https://www.chess.com/variants/fog-of-war
- Zach Gage / Really Bad Chess: https://slate.com/technology/2016/10/really-bad-chess-proves-that-games-dont-need-to-be-fair.html ; https://www.gamedeveloper.com/design/how-zach-gage-breaks-all-of-the-rules-in-i-really-bad-chess-i- ; https://www.skidmore.edu/news/2024/0820-zach-gage.php
- Infinite/vanishing tic-tac-toe evidence: https://www.infinitytictactoe.com/ ; https://apps.apple.com/us/app/vanish-tic-tac-toe/id6759029498 ; https://www.tiktok.com/discover/infinite-tic-tac-toe-toy
- neal.fun scale: https://gameplaydev.substack.com/p/this-solo-web-game-dev-went-viral ; https://postunreel.com/blog/neal-fun-complete-guide
- Board Game Arena: https://boardgamewire.com/index.php/2024/08/14/asmodees-boardgamearena-buyout-reaps-rewards-as-service-passes-10-million-accounts/ ; https://pricetimeline.com/news/41 ; https://en.boardgamearena.com/faq
- Coolmath Games traffic/model: https://www.similarweb.com/website/coolmathgames.com/ ; https://www.celebritynetworth.com/articles/entertainment-articles/random-website-youve-never-heard-makes-60k-per-day/
- Kongregate shutdown: https://games.slashdot.org/story/20/07/01/2049206/kongregate-no-longer-accepting-new-games-shutting-down-forums-and-chat ; https://news.ycombinator.com/item?id=23705174
- Unblocked-games ecosystem: https://www.hoodamath.com/blog/top-unblocked-games-you-can-play-on-school-chromebooks-in-2026/ ; https://gametyrant.com/news/ultimate-guide-to-unblocked-games-for-school-2026-edition ; https://www.similarweb.com/website/66ez.github.io/competitors/
- Retention benchmarks: https://appagent.com/blog/mobile-game-retention-benchmarks/ ; https://solsten.io/blog/d1-d7-d30-retention-in-gaming ; https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies
- H5 Games Ads: https://adsense.google.com/start/h5-games-ads/ ; https://blog.clickio.com/h5-game-ads-google-ad-manager-adsense/
- HTML5 game ad economics: https://tastycherrygames.com/2024/07/31/making-money-through-html5-ads-in-games-with-adsense/ ; https://www.monetizemore.com/blog/youtube-ad-revenue-gaming-companies/
