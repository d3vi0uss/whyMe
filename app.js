/* app.js — the UI layer. Owns the live state object, all rendering, and all event handling.
   Every user action funnels through here and ends with afterAction(), which is the single
   place that saves, checks achievements/missions, and re-renders — see the note in
   state.js:doPrestige for why that centralization matters. */
'use strict';

const App = (() => {
  let state = null;
  let currentTab = 'cases';
  let profileSubtab = 'stats';
  let selectedInventoryUids = new Set();
  let contractSelectedUids = new Set();
  let contractTargets = null;
  let pendingConfirm = null;
  let betAmount = 25;

  const $ = (sel, root = document) => root.querySelector(sel);
  const screenEl = () => $('#screen');

  // ---------------- boot ----------------
  function init() {
    state = State.load();
    State.ensureDailyMissions(state);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    window.addEventListener('beforeunload', () => State.save(state));
    document.addEventListener('visibilitychange', () => { if (document.hidden) State.save(state); });

    Audio2.setEnabled(state.settings.soundOn);
    Audio2.setVolume(state.settings.volume);
    updateSoundIcon();

    renderHeader();
    go('cases');

    checkAchievements(true);
    State.save(state);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  // ---------------- central post-action hook ----------------
  function afterAction({ leveledUp, toLevel } = {}) {
    if (leveledUp) {
      showToast(`Level up! You're now level ${toLevel}.`, 'level');
      Audio2.play.levelUp();
    }
    checkAchievements();
    renderHeader();
    render();
    State.scheduleSave(state);
  }

  function checkAchievements(silent) {
    const newly = State.checkAchievements(state);
    if (newly.length && !silent) {
      for (const a of newly) showToast(`Achievement unlocked: ${a.name}`, 'achievement');
      if (newly.length) Audio2.play.levelUp();
    }
    return newly;
  }

  // ---------------- navigation ----------------
  function go(tab) {
    currentTab = tab;
    selectedInventoryUids.clear();
    contractSelectedUids.clear();
    contractTargets = null;
    screenEl().scrollTop = 0;
    render();
    for (const btn of document.querySelectorAll('.nav-btn')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
  }

  function render() {
    State.ensureDailyMissions(state);
    switch (currentTab) {
      case 'cases': return renderCases();
      case 'inventory': return renderInventory();
      case 'upgrades': return renderUpgrades();
      case 'missions': return renderMissions();
      case 'casino': return renderCasino();
      case 'profile': return renderProfile();
      default: return renderCases();
    }
  }

  // ---------------- header ----------------
  function renderHeader() {
    const rank = State.rank(state);
    const prog = State.xpProgress(state);
    $('#rankName').textContent = rank.name;
    $('#levelText').textContent = `Lv ${state.level}`;
    $('#xpFill').style.width = `${Math.round(prog.pct * 100)}%`;
    $('#rankBadge').innerHTML = SvgArt.rankBadge(rank, Math.min(5, Math.ceil(state.level / 12) + 1));
    const moneyEl = $('#moneyText');
    moneyEl.textContent = Utils.formatMoney(state.money);
    moneyEl.title = `$${Utils.formatInt(state.money)}`;
    flashEl(moneyEl.closest('.money-chip'));
  }

  function flashEl(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function updateSoundIcon() {
    const btn = $('#soundToggle');
    if (btn) btn.textContent = state.settings.soundOn ? '🔊' : '🔇';
  }

  // ---------------- toasts ----------------
  function showToast(message, kind = 'info') {
    const region = $('#toastRegion');
    const node = Utils.el('div', { class: `toast toast-${kind}` }, [message]);
    region.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 350);
    }, 3200);
  }

  // ---------------- modal ----------------
  function openModal(html, opts = {}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" data-action="${opts.dismissible === false ? '' : 'closeModal'}"><div class="modal-card ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    root.classList.add('open');
  }
  function closeModal() {
    const root = $('#modalRoot');
    root.classList.remove('open');
    setTimeout(() => { root.innerHTML = ''; }, 200);
  }
  function showConfirm({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    pendingConfirm = onConfirm;
    openModal(`
      <h3>${Utils.escapeHtml(title)}</h3>
      <p class="modal-body">${body}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="closeModal">Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirmYes">${Utils.escapeHtml(confirmLabel)}</button>
      </div>
    `);
  }

  // ================= CASES SCREEN =================
  function featuredCaseId() {
    const idx = Utils.hashString(Utils.todayKey() + ':feature') % Data.CASES.length;
    return Data.CASES[idx].id;
  }

  function renderCases() {
    const featured = featuredCaseId();
    const cards = Data.CASES.map(c => {
      const unlocked = State.isCaseUnlocked(state, c);
      const price = State.effectiveCasePrice(state, c);
      const discounted = price < c.price;
      const canAfford = state.money >= price;
      const isFeatured = c.id === featured;
      return `
        <div class="case-card ${!unlocked ? 'locked' : ''} ${isFeatured ? 'featured' : ''}">
          ${isFeatured ? '<div class="badge-featured">TODAY\u2019S EVENT · +20% XP</div>' : ''}
          <div class="case-art">${SvgArt.caseIcon(c)}</div>
          <div class="case-info">
            <h3>${Utils.escapeHtml(c.name)}</h3>
            <p class="case-tag">${Utils.escapeHtml(c.tagline)}</p>
            <div class="case-price ${discounted ? 'discounted' : ''}">
              ${discounted ? `<span class="price-was">$${Utils.formatInt(c.price)}</span>` : ''}
              $${Utils.formatInt(price)}
            </div>
          </div>
          ${unlocked
            ? `<div class="case-actions">
                 <button type="button" class="btn btn-primary" data-action="openCase" data-case="${c.id}" data-qty="1" ${!canAfford ? 'disabled' : ''}>Open</button>
                 <button type="button" class="btn btn-ghost" data-action="openCase" data-case="${c.id}" data-qty="3" ${state.money < price * 3 ? 'disabled' : ''}>Open ×3</button>
               </div>`
            : `<div class="case-lock">Unlocks at level ${c.unlockLevel}</div>`
          }
        </div>`;
    }).join('');

    screenEl().innerHTML = `
      <section class="panel">
        <h2 class="screen-title">Cases</h2>
        <p class="screen-sub">Every case has the same base odds. Better cases just carry better skins.</p>
        <div class="case-grid">${cards}</div>
      </section>
    `;
  }

  function handleOpenCase(caseId, qty) {
    const caseObj = Data.CASE_BY_ID[caseId];
    if (!caseObj) return;
    if (!State.isCaseUnlocked(state, caseObj)) { showToast(`Locked until level ${caseObj.unlockLevel}.`, 'error'); Audio2.play.error(); return; }

    if (qty > 1) {
      const results = [];
      let leveledUp = false, toLevel = state.level;
      for (let i = 0; i < qty; i++) {
        const r = State.buyAndOpenCase(state, caseId);
        if (!r.ok) break;
        results.push(r.item);
        if (r.xpResult.leveledUp) { leveledUp = true; toLevel = r.xpResult.level; }
      }
      if (!results.length) { showToast('Not enough money.', 'error'); Audio2.play.error(); return; }
      showBatchReveal(results);
      afterAction({ leveledUp, toLevel });
      return;
    }

    const price = State.effectiveCasePrice(state, caseObj);
    if (state.money < price) { showToast('Not enough money.', 'error'); Audio2.play.error(); return; }
    playReelOpening(caseObj);
  }

  function playReelOpening(caseObj) {
    const price = State.effectiveCasePrice(state, caseObj);
    if (!State.spendMoney(state, price)) return;
    State.updateMissionProgress(state, 'spend_money', price);
    renderHeader();
    State.scheduleSave(state);

    const result = State.openCase(state, caseObj.id);
    const pool = Data.skinsForCase(caseObj.id);
    const reduced = state.settings.reducedMotion;

    const trackLen = 44;
    const targetIndex = Utils.randInt(34, 38);
    const items = [];
    for (let i = 0; i < trackLen; i++) {
      if (i === targetIndex) { items.push({ skinId: result.item.skinId, rarity: result.item.rarity }); continue; }
      const r = pool[Utils.randInt(0, pool.length - 1)];
      items.push({ skinId: r.id, rarity: r.rarity });
    }

    const cellW = 128, gap = 12, step = cellW + gap;
    const strip = items.map((it, i) => {
      const skin = Data.SKIN_BY_ID[it.skinId];
      const rarity = Data.RARITY_BY_ID[it.rarity];
      return `<div class="reel-cell rarity-${it.rarity}" style="--rc:${rarity.color}">${SvgArt.skinIcon(skin)}</div>`;
    }).join('');

    openModal(`
      <div class="reel-wrap">
        <div class="reel-viewport" id="reelViewport">
          <div class="reel-marker"></div>
          <div class="reel-track" id="reelTrack" style="width:${trackLen * step}px">${strip}</div>
        </div>
      </div>
      <div id="revealArea" class="reveal-area hidden"></div>
    `, { dismissible: false, cls: 'modal-wide' });

    const track = $('#reelTrack');
    const viewport = $('#reelViewport');

    const finish = () => {
      const revealArea = $('#revealArea');
      if (!revealArea) return;
      revealArea.classList.remove('hidden');
      revealArea.innerHTML = renderRevealCard(result.item, { canOpenAnother: true, caseId: caseObj.id });
      Audio2.play.reveal(Data.RARITY_BY_ID[result.item.rarity].order);
      if (Data.RARITY_BY_ID[result.item.rarity].order >= 4) pulseScreen();
      afterAction({ leveledUp: result.xpResult.leveledUp, toLevel: result.xpResult.level });
      // re-render reveal area after afterAction's render() left modal untouched (modal is outside #screen)
    };

    if (reduced || !track || !viewport) {
      closeModal();
      openModal(`<div id="revealArea" class="reveal-area"></div>`, { dismissible: false });
      finish();
      return;
    }

    Audio2.play.caseSpin();
    requestAnimationFrame(() => {
      const vpWidth = viewport.clientWidth;
      const finalX = -(targetIndex * step + cellW / 2 - vpWidth / 2);
      track.style.transition = 'transform 3.1s cubic-bezier(0.08,0.82,0.1,1)';
      track.style.transform = `translateX(${finalX}px)`;
    });
    setTimeout(() => Audio2.play.caseStop(), 2950);
    let done = false;
    track.addEventListener('transitionend', () => { if (!done) { done = true; finish(); } }, { once: true });
    setTimeout(() => { if (!done) { done = true; finish(); } }, 3400);
  }

  function pulseScreen() {
    document.body.classList.remove('flash-rare');
    void document.body.offsetWidth;
    document.body.classList.add('flash-rare');
  }

  function renderRevealCard(item, opts = {}) {
    const skin = Data.SKIN_BY_ID[item.skinId];
    const weapon = Data.WEAPONS[skin.weapon];
    const rarity = Data.RARITY_BY_ID[item.rarity];
    return `
      <div class="reveal-card rarity-${item.rarity}" style="--rc:${rarity.color}">
        <div class="reveal-art">${SvgArt.skinIcon(skin)}</div>
        <div class="reveal-info">
          <div class="reveal-rarity">${rarity.name}</div>
          <div class="reveal-name">${Utils.escapeHtml(weapon.name)} — ${Utils.escapeHtml(skin.name)}</div>
          <div class="reveal-cond">${item.condition.name} condition</div>
          <div class="reveal-value">$${Utils.formatInt(item.value)}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="closeModal">Keep &amp; close</button>
        <button type="button" class="btn btn-primary" data-action="sellFromModal" data-uid="${item.uid}">Sell for $${Utils.formatInt(item.value)}</button>
        ${opts.canOpenAnother ? `<button type="button" class="btn btn-accent" data-action="openAnother" data-case="${opts.caseId}">Open another</button>` : ''}
      </div>
    `;
  }

  function showBatchReveal(items) {
    const cards = items.map(it => {
      const skin = Data.SKIN_BY_ID[it.skinId];
      const rarity = Data.RARITY_BY_ID[it.rarity];
      return `<div class="batch-item rarity-${it.rarity}" style="--rc:${rarity.color}">
        <div class="batch-art">${SvgArt.skinIcon(skin)}</div>
        <div class="batch-name">${Utils.escapeHtml(skin.name)}</div>
        <div class="batch-value">$${Utils.formatInt(it.value)}</div>
      </div>`;
    }).join('');
    openModal(`
      <h3>You opened ${items.length} cases</h3>
      <div class="batch-grid">${cards}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-action="closeModal">Nice</button>
      </div>
    `);
    Audio2.play.reveal(Math.max(...items.map(i => Data.RARITY_BY_ID[i.rarity].order)));
  }

  // ================= INVENTORY SCREEN =================
  function renderInventory() {
    const items = [...state.inventory].sort((a, b) => b.value - a.value);
    const selTotal = items.filter(i => selectedInventoryUids.has(i.uid)).reduce((s, i) => s + i.value, 0);

    if (!items.length) {
      screenEl().innerHTML = `
        <section class="panel">
          <h2 class="screen-title">Inventory</h2>
          <div class="empty-state">
            <p>Nothing here yet. Open a case to start building your collection.</p>
            <button type="button" class="btn btn-primary" data-action="go" data-tab="cases">Go to Cases</button>
          </div>
        </section>`;
      return;
    }

    const grid = items.map(item => renderInventoryCard(item)).join('');
    screenEl().innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <h2 class="screen-title">Inventory <span class="count-pill">${items.length}</span></h2>
          <div class="quick-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="selectRarity" data-rarity="standard">Select Standard</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="clearSelection">Clear</button>
          </div>
        </div>
        <p class="screen-sub">This is also your market — sell items here for cash, one at a time or in bulk.</p>
        <div class="item-grid">${grid}</div>
      </section>
      ${selectedInventoryUids.size ? `
      <div class="sticky-bar">
        <span>${selectedInventoryUids.size} selected · $${Utils.formatInt(selTotal)}</span>
        <button type="button" class="btn btn-primary" data-action="sellSelected">Sell Selected</button>
      </div>` : ''}
    `;
  }

  function renderInventoryCard(item) {
    const skin = Data.SKIN_BY_ID[item.skinId];
    const weapon = Data.WEAPONS[skin.weapon];
    const rarity = Data.RARITY_BY_ID[item.rarity];
    const selected = selectedInventoryUids.has(item.uid);
    return `
      <div class="item-card rarity-${item.rarity} ${selected ? 'selected' : ''}" style="--rc:${rarity.color}" data-action="toggleItem" data-uid="${item.uid}">
        <div class="item-art">${SvgArt.skinIcon(skin)}</div>
        <div class="item-name">${Utils.escapeHtml(weapon.name)}</div>
        <div class="item-skin">${Utils.escapeHtml(skin.name)}</div>
        <div class="item-meta"><span>${item.condition.name}</span><span>$${Utils.formatInt(item.value)}</span></div>
        <button type="button" class="btn btn-sm btn-sell" data-action="sellItem" data-uid="${item.uid}">Sell</button>
      </div>`;
  }

  // ================= UPGRADES SCREEN =================
  function renderUpgrades() {
    const cards = Data.UPGRADES.map(u => {
      const lvl = state.upgrades[u.id] || 0;
      const maxed = lvl >= u.maxLevel;
      const cost = maxed ? null : Data.upgradeCost(u, lvl);
      const canAfford = cost !== null && state.money >= cost;
      const pct = Math.round((lvl / u.maxLevel) * 100);
      return `
        <div class="upg-card">
          <div class="upg-head">
            <h3>${Utils.escapeHtml(u.name)}</h3>
            <span class="upg-level">${lvl}/${u.maxLevel}</span>
          </div>
          <p class="upg-desc">${Utils.escapeHtml(u.desc)}</p>
          <div class="upg-bar"><div class="upg-bar-fill" style="width:${pct}%"></div></div>
          ${maxed
            ? `<button type="button" class="btn btn-ghost" disabled>Maxed out</button>`
            : `<button type="button" class="btn btn-primary" data-action="buyUpgrade" data-upg="${u.id}" ${!canAfford ? 'disabled' : ''}>Upgrade — $${Utils.formatInt(cost)}</button>`}
        </div>`;
    }).join('');
    screenEl().innerHTML = `
      <section class="panel">
        <h2 class="screen-title">Upgrades</h2>
        <p class="screen-sub">Permanent boosts, paid for with money. Reset on Prestige.</p>
        <div class="upg-grid">${cards}</div>
      </section>`;
  }

  // ================= MISSIONS SCREEN =================
  function renderMissions() {
    const dr = State.dailyRewardStatus(state);
    const calendar = Data.DAILY_REWARDS.map(d => {
      const isToday = !dr.claimedToday && d.day === dr.streak;
      const isPast = dr.claimedToday ? d.day <= dr.streak : d.day < dr.streak;
      return `<div class="day-chip ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}">
        <span class="day-num">D${d.day}</span>
        <span class="day-reward">$${d.money}${d.freeCase ? ' +case' : ''}</span>
      </div>`;
    }).join('');

    const missionCards = state.missions.list.map(m => {
      const tpl = State.missionTypeById(m.templateId);
      const ready = m.progress >= m.target && !m.claimed;
      const pct = Math.round((m.progress / m.target) * 100);
      return `
        <div class="mission-card ${m.claimed ? 'claimed' : ''}">
          <div class="mission-label">${tpl.label(m.target)}</div>
          <div class="mission-bar"><div class="mission-bar-fill" style="width:${pct}%"></div></div>
          <div class="mission-foot">
            <span>${Math.min(m.progress, m.target)}/${m.target}</span>
            ${m.claimed
              ? '<span class="mission-done">Claimed</span>'
              : `<button type="button" class="btn btn-sm btn-primary" data-action="claimMission" data-mission="${m.id}" ${!ready ? 'disabled' : ''}>Claim</button>`}
          </div>
        </div>`;
    }).join('');

    screenEl().innerHTML = `
      <section class="panel">
        <h2 class="screen-title">Daily Reward</h2>
        <div class="day-row">${calendar}</div>
        <button type="button" class="btn btn-primary" data-action="claimDaily" ${dr.claimedToday ? 'disabled' : ''}>
          ${dr.claimedToday ? 'Come back tomorrow' : `Claim Day ${dr.streak}`}
        </button>
      </section>
      <section class="panel">
        <h2 class="screen-title">Today's Missions</h2>
        <div class="mission-grid">${missionCards}</div>
      </section>`;
  }

  // ================= CASINO SCREEN =================
  function renderCasino() {
    screenEl().innerHTML = `
      <section class="panel">
        <h2 class="screen-title">Coinflip</h2>
        <p class="screen-sub">Simple odds, small house edge. Never bet more than you can lose.</p>
        <div class="coinflip-box">
          <div class="coin ${'idle'}" id="coinEl">◈</div>
          <div class="bet-row">
            <button type="button" class="btn btn-ghost btn-sm" data-action="betQuick" data-amount="10">$10</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="betQuick" data-amount="50">$50</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="betQuick" data-amount="100">$100</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="betMax">Max</button>
          </div>
          <input type="range" id="betRange" min="1" max="${Math.max(1, Math.floor(state.money))}" value="${Math.min(betAmount, Math.max(1, Math.floor(state.money)))}" data-action="rangeBet">
          <div class="bet-amount">Bet: $${Utils.formatInt(betAmount)}</div>
          <button type="button" class="btn btn-primary btn-lg" data-action="flipCoin" ${state.money < betAmount ? 'disabled' : ''}>Flip</button>
        </div>
      </section>
      <section class="panel">
        <h2 class="screen-title">Upgrade Contract</h2>
        <p class="screen-sub">Wager 2 or more items for a chance at something rarer. Lose the roll, lose the items.</p>
        ${renderContractBody()}
      </section>`;
  }

  function renderContractBody() {
    if (!state.inventory.length) {
      return `<div class="empty-state"><p>You need items in your inventory to run a contract.</p></div>`;
    }
    const items = [...state.inventory].sort((a, b) => b.value - a.value);
    const grid = items.map(item => {
      const skin = Data.SKIN_BY_ID[item.skinId];
      const rarity = Data.RARITY_BY_ID[item.rarity];
      const sel = contractSelectedUids.has(item.uid);
      return `<div class="mini-item rarity-${item.rarity} ${sel ? 'selected' : ''}" style="--rc:${rarity.color}" data-action="toggleContractItem" data-uid="${item.uid}">
        <div class="mini-art">${SvgArt.skinIcon(skin)}</div>
        <div class="mini-value">$${Utils.formatInt(item.value)}</div>
      </div>`;
    }).join('');

    const selCount = contractSelectedUids.size;
    const selValue = items.filter(i => contractSelectedUids.has(i.uid)).reduce((s, i) => s + i.value, 0);

    let targetsHtml = '';
    if (contractTargets) {
      if (!contractTargets.options.length) {
        targetsHtml = `<p class="screen-sub">No target found for this combination — try a different mix of items.</p>`;
      } else {
        targetsHtml = `<div class="target-grid">${contractTargets.options.map((opt, i) => {
          const rarity = Data.RARITY_BY_ID[opt.skin.rarity];
          return `<div class="target-card" style="--rc:${rarity.color}">
            <div class="target-art">${SvgArt.skinIcon(opt.skin)}</div>
            <div class="target-name">${Utils.escapeHtml(opt.skin.name)}</div>
            <div class="target-chance">${Math.round(opt.chance * 100)}% chance</div>
            <button type="button" class="btn btn-sm btn-primary" data-action="runContract" data-index="${i}">Wager</button>
          </div>`;
        }).join('')}</div>`;
      }
    }

    return `
      <div class="mini-grid">${grid}</div>
      <div class="contract-foot">
        <span>${selCount} selected · $${Utils.formatInt(selValue)}</span>
        <button type="button" class="btn btn-primary" data-action="findTargets" ${selCount < 2 ? 'disabled' : ''}>Find Targets</button>
      </div>
      ${targetsHtml}
    `;
  }

  function flipCoin() {
    if (betAmount <= 0 || state.money < betAmount) { showToast('Not enough money.', 'error'); Audio2.play.error(); return; }
    const coin = $('#coinEl');
    if (coin && !state.settings.reducedMotion) coin.classList.add('spin');
    const bet = betAmount;
    setTimeout(() => {
      const res = State.coinflip(state, bet);
      if (!res.ok) { showToast('Not enough money.', 'error'); return; }
      if (res.win) { showToast(`You won $${Utils.formatInt(res.payout)}!`, 'win'); Audio2.play.win(); }
      else { showToast(`You lost $${Utils.formatInt(bet)}.`, 'lose'); Audio2.play.lose(); }
      afterAction({});
    }, state.settings.reducedMotion ? 0 : 650);
  }

  // ================= PROFILE SCREEN (stats / achievements / prestige / settings) =================
  function renderProfile() {
    screenEl().innerHTML = `
      <section class="panel">
        <div class="subtabs">
          ${['stats', 'achievements', 'prestige', 'settings'].map(s =>
            `<button type="button" class="subtab-btn ${profileSubtab === s ? 'active' : ''}" data-action="profileSub" data-sub="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`
          ).join('')}
        </div>
        <div id="profileBody">${renderProfileBody()}</div>
      </section>`;
  }

  function renderProfileBody() {
    if (profileSubtab === 'stats') return renderStatsBody();
    if (profileSubtab === 'achievements') return renderAchievementsBody();
    if (profileSubtab === 'prestige') return renderPrestigeBody();
    if (profileSubtab === 'settings') return renderSettingsBody();
    return '';
  }

  function renderStatsBody() {
    const st = state.stats;
    const rows = [
      ['Cases opened', Utils.formatInt(st.casesOpened)],
      ['Items sold', Utils.formatInt(st.itemsSold)],
      ['Lifetime earned', `$${Utils.formatInt(st.lifetimeEarned)}`],
      ['Lifetime spent', `$${Utils.formatInt(st.lifetimeSpent)}`],
      ['Coinflip record', `${st.coinflipWins}W / ${st.coinflipLosses}L`],
      ['Contract record', `${st.upgradeWins}W / ${st.upgradeLosses}L`],
      ['Best pull', st.bestSkinId ? Data.SKIN_BY_ID[st.bestSkinId].name : '—'],
      ['Prestige count', st.prestigeCount || state.prestigeCount || 0]
    ];
    const statRows = rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
    const history = state.history.slice(0, 20).map(h => {
      const skin = Data.SKIN_BY_ID[h.skinId];
      const rarity = Data.RARITY_BY_ID[h.rarity];
      return `<div class="hist-row" style="--rc:${rarity.color}"><span class="hist-dot"></span><span class="hist-name">${Utils.escapeHtml(skin.name)}</span><span class="hist-val">$${Utils.formatInt(h.value)}</span></div>`;
    }).join('') || '<p class="screen-sub">No openings yet.</p>';

    return `
      <h3 class="sub-heading">Lifetime Stats</h3>
      <div class="stat-grid">${statRows}</div>
      <h3 class="sub-heading">Recent History</h3>
      <div class="hist-list">${history}</div>`;
  }

  function renderAchievementsBody() {
    const cards = Data.ACHIEVEMENTS.map(a => {
      const unlocked = state.achievements.unlocked.includes(a.id);
      return `<div class="ach-card ${unlocked ? 'unlocked' : ''}">
        <div class="ach-icon">${unlocked ? '★' : '☆'}</div>
        <div class="ach-name">${Utils.escapeHtml(a.name)}</div>
        <div class="ach-desc">${Utils.escapeHtml(a.desc)}</div>
        ${!unlocked ? `<div class="ach-reward">+$${a.reward.money || 0}${a.reward.xp ? ` · +${a.reward.xp}xp` : ''}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="ach-grid">${cards}</div>`;
  }

  function renderPrestigeBody() {
    const need = Data.PRESTIGE.requiredLevel;
    const can = State.canPrestige(state);
    const pct = Math.min(100, Math.round((state.level / need) * 100));
    return `
      <p class="screen-sub">Prestiging resets your money, inventory, level and upgrades — but keeps your lifetime stats and achievements, and permanently increases everything you earn by ${Math.round(Data.PRESTIGE.bonusPerPrestige * 100)}% per prestige.</p>
      <div class="stat-row"><span>Current prestige</span><strong>${state.prestigeCount}</strong></div>
      <div class="stat-row"><span>Current bonus</span><strong>+${Math.round((State.prestigeMult(state) - 1) * 100)}%</strong></div>
      <div class="upg-bar"><div class="upg-bar-fill" style="width:${pct}%"></div></div>
      <p class="screen-sub">Level ${state.level} / ${need} required</p>
      <button type="button" class="btn ${can ? 'btn-primary' : 'btn-ghost'} btn-lg" data-action="goPrestige" ${can ? '' : 'disabled'}>Prestige Now</button>
    `;
  }

  function renderSettingsBody() {
    return `
      <div class="settings-row">
        <label for="volumeRange">Sound volume</label>
        <input type="range" id="volumeRange" min="0" max="100" value="${Math.round(state.settings.volume * 100)}" data-action="rangeVolume">
      </div>
      <div class="settings-row">
        <label for="reducedMotionToggle">Reduced motion</label>
        <input type="checkbox" id="reducedMotionToggle" data-action="toggleReducedMotion" ${state.settings.reducedMotion ? 'checked' : ''}>
      </div>
      <div class="settings-row-col">
        <button type="button" class="btn btn-ghost" data-action="exportSave">Export save (.json)</button>
        <button type="button" class="btn btn-ghost" data-action="importSaveTrigger">Import save</button>
        <input type="file" id="importFile" accept="application/json" class="hidden-file">
      </div>
      <div class="settings-row-col">
        <button type="button" class="btn btn-danger" data-action="hardResetTrigger">Erase save and start over</button>
      </div>
      <p class="screen-sub">Ghostlight saves automatically to this browser. Export a backup before switching devices or browsers.</p>
    `;
  }

  // ---------------- click delegation ----------------
  function onClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;

    Audio2.unlock();

    switch (action) {
      case 'go': Audio2.play.nav(); go(target.dataset.tab); break;
      case 'closeModal': closeModal(); break;
      case 'toggleSound': {
        state.settings.soundOn = !state.settings.soundOn;
        Audio2.setEnabled(state.settings.soundOn);
        updateSoundIcon();
        Audio2.play.toggle();
        State.scheduleSave(state);
        break;
      }
      case 'openCase': Audio2.play.click(); handleOpenCase(target.dataset.case, parseInt(target.dataset.qty, 10) || 1); break;
      case 'openAnother': closeModal(); setTimeout(() => handleOpenCase(target.dataset.case, 1), 220); break;
      case 'sellItem': {
        const r = State.sellItem(state, target.dataset.uid);
        if (r.ok) { showToast(`Sold for $${Utils.formatInt(r.payout)}${r.bonus ? ' (bonus!)' : ''}`, 'sell'); Audio2.play.sell(); afterAction({}); }
        break;
      }
      case 'sellFromModal': {
        const r = State.sellItem(state, target.dataset.uid);
        if (r.ok) { showToast(`Sold for $${Utils.formatInt(r.payout)}${r.bonus ? ' (bonus!)' : ''}`, 'sell'); Audio2.play.sell(); }
        closeModal();
        afterAction({});
        break;
      }
      case 'toggleItem': {
        const uid = target.dataset.uid;
        selectedInventoryUids.has(uid) ? selectedInventoryUids.delete(uid) : selectedInventoryUids.add(uid);
        renderInventory();
        break;
      }
      case 'selectRarity': {
        state.inventory.filter(i => i.rarity === target.dataset.rarity).forEach(i => selectedInventoryUids.add(i.uid));
        renderInventory();
        break;
      }
      case 'clearSelection': selectedInventoryUids.clear(); renderInventory(); break;
      case 'sellSelected': {
        const r = State.sellMany(state, [...selectedInventoryUids]);
        selectedInventoryUids.clear();
        if (r.count) { showToast(`Sold ${r.count} items for $${Utils.formatInt(r.total)}`, 'sell'); Audio2.play.sell(); }
        afterAction({});
        break;
      }
      case 'buyUpgrade': {
        const r = State.buyUpgrade(state, target.dataset.upg);
        if (r.ok) { showToast('Upgrade purchased.', 'info'); Audio2.play.coin(); afterAction({}); }
        else { showToast(r.reason === 'max' ? 'Already maxed.' : 'Not enough money.', 'error'); Audio2.play.error(); }
        break;
      }
      case 'claimMission': {
        const r = State.claimMission(state, target.dataset.mission);
        if (r.ok) { showToast(`Mission complete: +$${Utils.formatInt(r.money)}, +${r.xp}xp`, 'win'); Audio2.play.coin(); afterAction({}); }
        break;
      }
      case 'claimDaily': {
        const r = State.claimDailyReward(state);
        if (r.ok) {
          showToast(`Day ${r.streak} reward: +$${Utils.formatInt(r.money)}${r.freeItem ? ' + a free case!' : ''}`, 'win');
          Audio2.play.coin();
          afterAction({});
        }
        break;
      }
      case 'betQuick': betAmount = Math.min(Math.floor(state.money), parseInt(target.dataset.amount, 10)); render(); break;
      case 'betMax': betAmount = Math.max(1, Math.floor(state.money)); render(); break;
      case 'flipCoin': flipCoin(); break;
      case 'toggleContractItem': {
        const uid = target.dataset.uid;
        contractSelectedUids.has(uid) ? contractSelectedUids.delete(uid) : contractSelectedUids.add(uid);
        contractTargets = null;
        renderCasino();
        break;
      }
      case 'findTargets': {
        contractTargets = State.upgradeTargets(state, [...contractSelectedUids]);
        renderCasino();
        break;
      }
      case 'runContract': {
        const opt = contractTargets.options[parseInt(target.dataset.index, 10)];
        const uids = [...contractSelectedUids];
        const res = State.runUpgradeContract(state, uids, opt.skin.id, opt.caseId, opt.chance);
        contractSelectedUids.clear();
        contractTargets = null;
        if (res.win) { showToast(`Contract won! You got ${res.item.skinId ? Data.SKIN_BY_ID[res.item.skinId].name : ''}`, 'win'); Audio2.play.win(); }
        else { showToast('Contract failed. Items lost.', 'lose'); Audio2.play.lose(); }
        afterAction({});
        break;
      }
      case 'profileSub': profileSubtab = target.dataset.sub; renderProfile(); break;
      case 'exportSave': doExport(); break;
      case 'importSaveTrigger': $('#importFile').click(); break;
      case 'hardResetTrigger': {
        showConfirm({
          title: 'Erase your save?',
          body: 'This deletes all progress in this browser permanently. This cannot be undone.',
          confirmLabel: 'Erase everything',
          danger: true,
          onConfirm: () => {
            state = State.freshState();
            State.save(state);
            closeModal();
            renderHeader();
            go('cases');
            showToast('Save erased. Starting fresh.', 'info');
          }
        });
        break;
      }
      case 'goPrestige': {
        showConfirm({
          title: 'Prestige now?',
          body: `Money, inventory, level and upgrades reset. You gain a permanent +${Math.round(Data.PRESTIGE.bonusPerPrestige * 100)}% earnings bonus.`,
          confirmLabel: 'Prestige',
          onConfirm: () => {
            const r = State.doPrestige(state);
            closeModal();
            if (r.ok) { showToast(`Prestige ${r.prestigeCount}! Fresh start, permanent bonus.`, 'level'); Audio2.play.levelUp(); }
            afterAction({});
          }
        });
        break;
      }
      case 'confirmYes': { const fn = pendingConfirm; pendingConfirm = null; if (fn) fn(); break; }
    }
  }

  // ---------------- input/change delegation ----------------
  function onInput(e) {
    if (e.target.id === 'betRange') {
      betAmount = Utils.clamp(parseInt(e.target.value, 10) || 1, 1, Math.max(1, Math.floor(state.money)));
      const amt = $('.bet-amount'); if (amt) amt.textContent = `Bet: $${Utils.formatInt(betAmount)}`;
    }
    if (e.target.id === 'volumeRange') {
      const v = parseInt(e.target.value, 10) / 100;
      state.settings.volume = v;
      Audio2.setVolume(v);
      State.scheduleSave(state);
    }
  }

  function onChange(e) {
    if (e.target.id === 'reducedMotionToggle') {
      state.settings.reducedMotion = e.target.checked;
      State.scheduleSave(state);
    }
    if (e.target.id === 'importFile') {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = State.importJSON(reader.result);
          state = imported;
          State.save(state);
          renderHeader();
          go('profile');
          showToast('Save imported successfully.', 'win');
        } catch (err) {
          showToast('That file could not be read as a Ghostlight save.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }
  }

  function doExport() {
    try {
      const blob = new Blob([State.exportJSON(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghostlight-save-${Utils.todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Save exported.', 'info');
    } catch (err) {
      showToast('Export failed.', 'error');
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
