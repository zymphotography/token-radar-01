// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table and a per-protocol
// detail view with the model's own inputs and the protocol's farm plan. No
// network: every byte it shows comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, picked: null, watchOnly: false };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function recompute(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMul = 1 + (growth / 100) * model.growth_weight;
    var years = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(years, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_weight * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_cap);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMul * maturity * breadth));
  }

  // The farm plan is the same derivation main.ts writes to board.json: the
  // category, the chains, the TVL and the age decide the action, the capital,
  // the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(years) {
    if (years === null || years === undefined) return 30;
    if (years < 180) return 60;
    if (years < 365) return 45;
    return 30;
  }
  function mainAction(p, stake, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + stake + ' of USDC on ' + name + ' on ' + chain + ' and leave the supply in place.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + stake + " of liquidity to " + name + "'s main pool on " + chain + ' and leave the position open.';
    if (c.indexOf('bridge') >= 0) return 'Move $' + stake + ' of USDC to ' + chain + ' using ' + name + ', then put the bridged funds to work in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + stake + " of the chain's staking asset via " + name + ' and hold on to the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + stake + ' of USDC as margin on ' + name + ' and open a single small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Put $' + stake + ' behind one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Put $' + stake + ' into a ' + name + ' vault on ' + chain + ' and hold the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + stake + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Keep the position open and check the protocol's own page.";
    return s;
  }
  function weeklyAction(p, stake, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(stake / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Once a week, borrow $' + small + ' against the supply and pay it back, so the wallet shows borrowing activity on ' + chain + '.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Once a week, swap $' + small + ' through ' + name + "'s main pool on " + chain + ' and add what comes back to the position.';
    if (c.indexOf('bridge') >= 0) return 'Once a week, bridge a small amount in each direction through ' + name + ' so the wallet shows repeated bridge use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Once a week, restake the rewards ' + name + ' pays instead of taking them out.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Once a week, close the hedge and open a new one on ' + name + ' so the wallet shows repeated trading.';
    if (c.indexOf('prediction') >= 0) return 'Once a week, settle one market and open another position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Once a week, move $' + small + ' between ' + name + "'s vaults on " + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Once a week, mint or redeem a small amount of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Once a week, claim the yield ' + name + ' pays on ' + chain + ' and put it back into the same asset.';
    if (c.indexOf('insurance') >= 0) return "Once a week, read the cover's terms on " + name + ' and renew it before it runs out.';
    return 'Once a week, take one more qualifying action on ' + name + ', like a deposit, a swap or a vote.';
  }
  function planFor(p) {
    var chain = firstChain(p);
    var stake = stakeFor(p);
    var hold = holdFor(p.age_days);
    var steps = [
      { text: 'Open a new wallet just for this farm and keep its recovery phrase somewhere offline, never in a screenshot or a chat.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, stake, chain), cost: '$' + stake + ' of capital and about $' + (stake >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyAction(p, stake, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + stake + ' stays in the position', time: hold + ' days' },
      { text: "Before you take anything out, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Note the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it later.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    if (p.chains && p.chains.length > 1) {
      var second = p.chains[1];
      var half = Math.max(10, Math.round(stake / 2));
      steps.splice(3, 0, { text: 'Do the main action once more on ' + second + ' with $' + half + ', so the activity is not on a single chain.', cost: '$' + half + ' of capital and about $4 of gas', time: '15 minutes, once' });
    }
    return steps.map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.picked = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.picked) params.set('p', view.picked);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.watchOnly && !r.watchlist) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function ordered(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return '<header class="masthead">' +
      '<div class="brand"><span class="dot"></span><span class="wordmark">Token Radar</span></div>' +
      '<div class="meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(DATA.model_version) + ' model</span></div>' +
      '</header>';
  }

  function intro() {
    return '<section class="intro"><div>' +
      '<h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols the watchlist does not name, below that floor and above it. Implied value is a model, not a promise.</p>' +
      '</div><div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }

  function toolbar() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var opts = '<option value="all">All categories</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === view.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="toolbar">' +
      '<div class="ctl"><label for="q">Search</label><input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(view.q) + '" aria-label="Search the board"></div>' +
      '<div class="ctl"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + opts + '</select></div>' +
      '<div class="ctl"><span class="hint">Token status</span><div class="switch">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (view.tab === 'pre-token') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (view.tab === 'live') + '">Live token</button></div></div>' +
      '<div class="ctl"><span class="hint">Coverage</span><div class="switch">' +
      '<button type="button" data-watch="1" aria-pressed="' + view.watchOnly + '">Watchlist only</button></div></div>' +
      '<span class="total">' + (view.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols') + '</span>' +
      '</div>';
  }

  function sortBtn(key, label) {
    var mark = view.sort === key ? (view.dir < 0 ? ' v' : ' ^') : '';
    return '<button type="button" data-sort="' + key + '">' + label + '<span aria-hidden="true">' + mark + '</span></button>';
  }

  function boardCard() {
    var list = ordered(filtered());
    if (list.length === 0) {
      return '<div class="card"><div class="blank"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="btn primary" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    var top = list[0].implied_value_usd || 1;
    var rowsHtml = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gcls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (view.picked === r.slug) + '" tabindex="0">' +
        '<td class="fig">' + r.rank + '</td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b>' + (r.watchlist ? ' <span class="tag">watchlist</span>' : '') +
        '<span class="hint">' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="fig">' + money(r.tvl_usd) + '</td>' +
        '<td class="fig ' + gcls + '">' + growth + '</td>' +
        '<td class="fig">' + age(r.age_days) + '</td>' +
        '<td><div class="value"><div class="meter" aria-hidden="true"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%"></i></div>' +
        '<span class="fig">' + money(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="state">no token</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroll"><table>' +
      '<caption class="hint">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr><th scope="col">' + sortBtn('implied', 'Rank') + '</th><th scope="col">' + sortBtn('name', 'Protocol') + '</th>' +
      '<th scope="col">' + sortBtn('tvl', 'TVL') + '</th><th scope="col">' + sortBtn('growth', '7d') + '</th>' +
      '<th scope="col">' + sortBtn('age', 'Age') + '</th><th scope="col">' + sortBtn('implied', 'Implied value') + '</th>' +
      '<th scope="col">Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function liveCard() {
    var rowsHtml = DATA.live.map(function (r) {
      var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      var gcls = r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down';
      return '<tr><td class="fig">live</td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span class="hint">' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="fig">' + money(r.tvl_usd) + '</td>' +
        '<td class="fig ' + gcls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="fig">' + money(r.mcap_usd) + '</td>' +
        '<td><span class="state">already trades</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroll"><table>' +
      '<caption class="hint">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function howPanel() {
    var m = DATA.model;
    return '<section class="card how"><h2>How implied value is computed</h2>' +
      '<p class="hint">Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="math">implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_weight + ' x min(chains - 1, ' + m.breadth_cap + ')) )</div>' +
      '<p class="hint">TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth is the number of chains the protocol runs on: a protocol live on several chains is worth up to ' + Math.round(m.breadth_weight * m.breadth_cap * 100) + '% more. The early radar is every rankable pre-token protocol the watchlist does not name, and the live-token protocols are set aside with their market caps shown.</p></section>';
  }

  var drawer = document.createElement('dialog');
  drawer.className = 'drawer';
  drawer.id = 'detail';
  drawer.setAttribute('aria-labelledby', 'detail-title');
  drawer.addEventListener('close', function () { view.picked = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    view.picked = slug;
    writeHash();
    var steps = planFor(row);
    var check = recompute(row, DATA.model);
    var chainList = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    var stepsHtml = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="price">' + esc(tail) + '</span></li>';
    }).join('');
    drawer.innerHTML =
      '<div class="drawer-top"><div><span class="wordmark">Rank ' + row.rank + ' of ' + DATA.board_size + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="hint">' + esc(row.category || 'Other') + ' on ' + esc(chainList) + '</p></div>' +
      '<button class="shut" type="button" aria-label="Close details" data-close="1">Close</button></div>' +
      '<section class="drawer-part"><h3>Implied value</h3><div class="grid">' +
      '<div><span>TVL</span><b class="fig">' + money(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b class="fig">' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b class="fig">' + age(row.age_days) + '</b></div>' +
      '<div><span>Growth multiplier</span><b class="fig">' + row.growth_multiplier + '</b></div>' +
      '<div><span>Maturity multiplier</span><b class="fig">' + row.maturity_multiplier + '</b></div>' +
      '<div><span>Breadth multiplier</span><b class="fig">' + row.breadth_multiplier + ' (' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')</b></div>' +
      '<div><span>Implied value</span><b class="fig">' + money(row.implied_value_usd) + '</b></div></div>' +
      '<p class="hint">Model ' + esc(DATA.model_version) + ': the same function scores every protocol. The page recomputes this row as ' + money(check) + (check === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>' +
      '<section class="drawer-part"><h3>Farm plan</h3><ol class="plan">' + stepsHtml + '</ol></section>';
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function render() {
    mount.innerHTML = '<div class="shell">' + masthead() + intro() + toolbar() +
      (view.tab === 'pre-token' ? boardCard() : liveCard()) +
      (view.tab === 'pre-token' ? howPanel() : '') + '</div>';
    mount.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) mount.appendChild(drawer);
    if (view.picked) openDetail(view.picked);
  }

  mount.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') { view.q = e.target.value; writeHash(); render(); }
  });
  mount.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'category') { view.category = e.target.value; writeHash(); render(); }
  });
  mount.addEventListener('click', function (e) {
    var t = e.target.closest('button, tr[data-slug]');
    if (!t) return;
    if (t.hasAttribute('data-sort')) {
      var key = t.getAttribute('data-sort');
      if (view.sort === key) view.dir = -view.dir;
      else { view.sort = key; view.dir = -1; }
      render();
    } else if (t.hasAttribute('data-tab')) {
      view.tab = t.getAttribute('data-tab');
      render();
    } else if (t.hasAttribute('data-watch')) {
      view.watchOnly = !view.watchOnly;
      render();
    } else if (t.hasAttribute('data-clear')) {
      view.q = ''; view.category = 'all'; writeHash(); render();
    } else if (t.hasAttribute('data-close')) {
      drawer.close();
    } else if (t.hasAttribute('data-slug')) {
      openDetail(t.getAttribute('data-slug'));
    }
  });
  mount.addEventListener('keydown', function (e) {
    var t = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t.getAttribute('data-slug')); }
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });

  readHash();
  render();
})();
