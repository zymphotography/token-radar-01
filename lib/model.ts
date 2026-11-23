// Scoring for the token radar: a sealed DefiLlama snapshot goes in, a ranked
// board of pre-token protocols comes out, plus the compact payload the page
// renders. Nothing here names a protocol by hand: one formula scores every
// row, and the same derivation builds every farm plan.
//
// What a row's implied value is made of (all of it from the snapshot):
//   base      tvl_usd times the base multiple
//   growth    change_7d clamped to [-60, +120] percent
//   growthMul 1 + growth/100 times the growth weight
//   maturity  0.6 + min(age, 1095)/1095 times 0.4; unknown age counts as 365 days
//   breadth   1 + 0.03 times min(chains - 1, 5): more chains, more places a
//             token could land, worth up to 15% more
//   implied   max(1, round(base x growthMul x maturity x breadth))
//
// The watchlist is the floor, not the ceiling: every watchlist slug is on the
// board, and the radar adds every other pre-token protocol that is not a
// wrapped, staked or bridged product of a token that already trades. The
// live-token protocols are kept apart and shown with their market caps.

/** One protocol record: the ten fields the sealed snapshot carries. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The tunable numbers behind the value formula. */
export interface Tuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
}

export const TUNE: Tuning = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_weight: 0.03,
  breadth_cap: 5,
};

/** The model's label, shown on the dashboard and quoted by the rules. */
export const MODEL_TAG = 'radar-2';

/** How many live-token protocols the Live view carries, biggest market cap first. */
export const LIVE_COUNT = 24;

/** One farm-plan step: what to do, what it costs, how long it takes. */
export interface PlanStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the page sees it: the board row minus the plan, which the page derives. */
export interface BoardView {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
}

/** A protocol whose token already trades: shown with its market value, never scored. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs to render: board, live set, model, counts. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardView[];
  live: LiveEntry[];
}

/** Thrown when the snapshot is not the shape this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const MS_PER_DAY = 86_400_000;

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` up to `asOf`, never below zero; null when a date is missing or unparsable. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** Round to four decimals, for the multipliers the board and the page both show. */
function fourDp(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Score one protocol: the four multipliers and the implied value they give. */
export function scoreProto(p: Proto, asOf: string, tune: Tuning): {
  implied: number;
  growthPct: number;
  growthMul: number;
  maturityMul: number;
  breadthMul: number;
  age: number | null;
} {
  const age = daysListed(asOf, p.listed_at);
  const growthPct = Math.min(tune.growth_cap, Math.max(tune.growth_floor, numOr(p.change_7d, 0)));
  const growthMul = 1 + (growthPct / 100) * tune.growth_weight;
  const ageUsed = age ?? tune.unknown_age_days;
  const maturityMul =
    tune.maturity_floor +
    (Math.min(Math.max(ageUsed, 0), tune.maturity_days) / tune.maturity_days) * tune.maturity_range;
  const breadthMul = 1 + tune.breadth_weight * Math.min(Math.max(p.chains.length - 1, 0), tune.breadth_cap);
  const implied = Math.max(1, Math.round(p.tvl_usd * tune.base_multiple * growthMul * maturityMul * breadthMul));
  return { implied, growthPct, growthMul, maturityMul, breadthMul, age };
}

/** A name ending in a release marker (V2, v2, 2.0 ...) is a version of another protocol. */
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when the snapshot records no token for this protocol at all. */
export function tokenless(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that mark a protocol as a wrapped, staked or bridged product of a token that trades. */
const PRODUCT_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name starting with an exchange's name is that exchange's product. */
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_TERM = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether the board may rank this protocol: it records no token, and it is
 * not a wrapped, staked or bridged product of a token that already trades,
 * by the field guide's own rule. WBTC, Binance staked ETH and USDT0 are the
 * guide's examples: each is a token that already trades in another form, not
 * a protocol still waiting on a launch of its own. Watchlist slugs are added
 * regardless (the watchlist is the floor and the gate checks its coverage);
 * this rule only shapes the early radar.
 */
export function rankable(p: Proto): boolean {
  return (
    tokenless(p) &&
    !PRODUCT_CATS.has(p.category ?? '') &&
    !VERSION_MARK.test(p.name) &&
    !EXCHANGE_LEAD.test(p.name) &&
    !WRAPPED_TERM.test(p.name)
  );
}

/** Index the snapshot's protocols by slug. */
function indexBySlug(protocols: Proto[]): Map<string, Proto> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every watchlist slug plus every rankable early protocol, strongest implied value first. */
export function rankBoard(snap: Snap, tune: Tuning = TUNE): BoardEntry[] {
  const index = indexBySlug(snap.protocols);
  const picked = new Map<string, Proto>();
  // The watchlist is the floor: take every slug it names. (A slug the snapshot
  // no longer carries cannot happen, but coverage is the gate's row and is
  // never gambled on a missing record.)
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not
  // name, by TVL. Those are the protocols below the watchlist floor and the
  // ones above it the watchlist's own rule leaves out (a bridge or a staking
  // product can still be a protocol with no token of its own). A picked
  // protocol stays picked; the radar carries all of them, not a capped sample.
  const early = snap.protocols
    .filter((p) => !picked.has(p.slug) && rankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) picked.set(p.slug, p);

  const scored = [...picked.values()].map((p) => {
    const s = scoreProto(p, snap.as_of, tune);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: tune.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: fourDp(s.growthMul),
      maturity_multiplier: fourDp(s.maturityMul),
      breadth_multiplier: fourDp(s.breadthMul),
      age_days: s.age,
    },
    farm_steps: buildPlan(s.p, s.age).map(renderStep),
  }));
}

/** The live-token protocols, biggest market cap first, for the dashboard's Live view. */
export function liveList(snap: Snap): LiveEntry[] {
  return snap.protocols
    .filter((p) => !tokenless(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board entry's compact form for data.js; the farm plan is derived in the page. */
export function viewRow(row: BoardEntry, onWatchlist: boolean): BoardView {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: onWatchlist,
  };
}

/** Everything the dashboard renders, built from one snapshot. */
export function assembleRadar(snap: Snap, tune: Tuning = TUNE): { board: BoardEntry[]; radar: RadarPayload } {
  const board = rankBoard(snap, tune);
  const live = liveList(snap);
  const earlyCount = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const radar: RadarPayload = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tune,
    model_version: MODEL_TAG,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map((r) => viewRow(r, snap.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** One step as a single string: the action, then its cost and time, inside the gate's 20..600 characters. */
export function renderStep(step: PlanStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain the protocol names, or a neutral phrase when it names none. */
function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position takes, from the protocol's own TVL. */
function stakeFor(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function mainAction(p: Proto, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${stake} of USDC on ${name} on ${chain} and leave the supply in place.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${stake} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  if (c.includes('bridge')) return `Move $${stake} of USDC to ${chain} using ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${stake} of the chain's staking asset via ${name} and hold on to the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${stake} of USDC as margin on ${name} and open a single small hedge.`;
  if (c.includes('prediction')) return `Put $${stake} behind one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Put $${stake} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${stake} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${stake} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${stake} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** The weekly recurring action, in the words of the protocol's own category. */
function weeklyAction(p: Proto, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(stake / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Once a week, borrow $${small} against the supply and pay it back, so the wallet shows borrowing activity on ${chain}.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Once a week, swap $${small} through ${name}'s main pool on ${chain} and add what comes back to the position.`;
  if (c.includes('bridge')) return `Once a week, bridge a small amount in each direction through ${name} so the wallet shows repeated bridge use.`;
  if (c.includes('staking') || c.includes('restak')) return `Once a week, restake the rewards ${name} pays instead of taking them out.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Once a week, close the hedge and open a new one on ${name} so the wallet shows repeated trading.`;
  if (c.includes('prediction')) return `Once a week, settle one market and open another position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Once a week, move $${small} between ${name}'s vaults on ${chain}.`;
  if (c.includes('stable')) return `Once a week, mint or redeem a small amount of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Once a week, claim the yield ${name} pays on ${chain} and put it back into the same asset.`;
  if (c.includes('insurance')) return `Once a week, read the cover's terms on ${name} and renew it before it runs out.`;
  return `Once a week, take one more qualifying action on ${name}, like a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: six or seven steps, each an action with a cost and a
 * time. The plan comes from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. Multi-chain protocols get a
 * seventh step that farms a second chain, because a token launch often
 * rewards users on more than one chain.
 */
export function buildPlan(p: Proto, age: number | null): PlanStep[] {
  const chain = firstChain(p);
  const stake = stakeFor(p);
  const hold = holdFor(age);
  const steps: PlanStep[] = [
    {
      text: `Open a new wallet just for this farm and keep its recovery phrase somewhere offline, never in a screenshot or a chat.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainAction(p, stake, chain),
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyAction(p, stake, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you take anything out, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Note the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    const half = Math.max(10, Math.round(stake / 2));
    steps.splice(3, 0, {
      text: `Do the main action once more on ${second} with $${half}, so the activity is not on a single chain.`,
      cost: `$${half} of capital and about $4 of gas`,
      time: '15 minutes, once',
    });
  }
  return steps;
}

/** The snapshot out of a file's text, refused unless it is the shape this model can score. */
export function readSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, farm steps. */
export function boardProblem(board: BoardEntry[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataModule(radar: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
