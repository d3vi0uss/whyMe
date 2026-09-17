/* state.js — the single source of truth for a save. Pure logic; no DOM access. */
'use strict';

const State = (() => {

  const SAVE_KEY = 'ghostlight_save_v1';
  const SAVE_VERSION = 1;
  const STARTING_MONEY = 250;
  const HISTORY_CAP = 50;
  const DAILY_MISSION_COUNT = 3;

  // ---------- Default shape ----------
  function freshState() {
    return {
      version: SAVE_VERSION,
      money: STARTING_MONEY,
      xp: 0,
      level: 1,
      prestigeCount: 0,
      inventory: [],
      upgrades: { luck: 0, fortune: 0, xp: 0, discount: 0, insight: 0 },
      stats: {
        casesOpened: 0,
        casesOpenedByCase: {},
        itemsSold: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        coinflipWins: 0,
        coinflipLosses: 0,
        upgradeWins: 0,
        upgradeLosses: 0,
        bestRarityOrder: -1,
        bestSkinId: null
      },
      achievements: { unlocked: [] },
      missions: { date: null, list: [] },
      dailyReward: { lastClaimDate: null, streak: 0 },
      history: [],
      settings: { soundOn: true, volume: 0.6, reducedMotion: false },
      createdAt: Date.now(),
      lastSavedAt: Date.now()
    };
  }

  // Fill in any keys missing from an older/partial save without discarding progress
  function validate(raw) {
    const base = freshState();
    if (!raw || typeof raw !== 'object') return base;
    const s = { ...base, ...raw };
    s.upgrades = { ...base.upgrades, ...(raw.upgrades || {}) };
    s.stats = { ...base.stats, ...(raw.stats || {}) };
    s.achievements = { ...base.achievements, ...(raw.achievements || {}) };
    s.missions = { ...base.missions, ...(raw.missions || {}) };
    s.dailyReward = { ...base.dailyReward, ...(raw.dailyReward || {}) };
    s.settings = { ...base.settings, ...(raw.settings || {}) };
    if (!Array.isArray(s.inventory)) s.inventory = [];
    if (!Array.isArray(s.history)) s.history = [];
    if (!Array.isArray(s.achievements.unlocked)) s.achievements.unlocked = [];
    if (typeof s.money !== 'number' || isNaN(s.money)) s.money = STARTING_MONEY;
    if (typeof s.level !== 'number' || s.level < 1) s.level = 1;
    return s;
  }

  // ---------- Persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      return validate(parsed);
    } catch (e) {
      console.warn('Ghostlight: save could not be read, starting fresh.', e);
      return freshState();
    }
  }

  function save(state) {
    try {
      state.lastSavedAt = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('Ghostlight: save failed (storage may be full or unavailable).', e);
      return false;
    }
  }

  let saveTimer = null;
  function scheduleSave(state, delay = 800) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(state), delay);
  }

  function exportJSON(state) {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (typeof parsed.money !== 'number' && !parsed.stats) {
      throw new Error('This file does not look like a Ghostlight save.');
    }
    return validate(parsed);
  }

  // ---------- Derived / effective values ----------
  function luckBonus(state) {
    const u = Data.UPGRADES.find(u => u.id === 'luck');
    return state.upgrades.luck * u.step;
  }
  function fortuneMult(state) {
    const u = Data.UPGRADES.find(u => u.id === 'fortune');
    return 1 + state.upgrades.fortune * u.step;
  }
  function xpMult(state) {
    const u = Data.UPGRADES.find(u => u.id === 'xp');
    return 1 + state.upgrades.xp * u.step;
  }
  function casePriceMult(state) {
    const u = Data.UPGRADES.find(u => u.id === 'discount');
    return Math.max(0.5, 1 - state.upgrades.discount * u.step);
  }
  function insightChance(state) {
    const u = Data.UPGRADES.find(u => u.id === 'insight');
    return state.upgrades.insight * u.step;
  }
  function prestigeMult(state) {
    return 1 + state.prestigeCount * Data.PRESTIGE.bonusPerPrestige;
  }
  function effectiveCasePrice(state, caseObj) {
    return Math.max(1, Math.round(caseObj.price * casePriceMult(state)));
  }
  function isCaseUnlocked(state, caseObj) {
    return state.level >= caseObj.unlockLevel;
  }
  function rank(state) { return Data.rankForLevel(state.level); }
  function xpProgress(state) {
    const need = Data.xpToNext(state.level);
    return { xp: state.xp, need, pct: Utils.clamp(state.xp / need, 0, 1) };
  }

  // ---------- XP / leveling ----------
  function addXP(state, amount) {
    amount = Math.round(amount * xpMult(state));
    state.xp += amount;
    let leveledUp = false;
    while (state.xp >= Data.xpToNext(state.level)) {
      state.xp -= Data.xpToNext(state.level);
      state.level += 1;
      leveledUp = true;
    }
    return { gained: amount, leveledUp, level: state.level };
  }

  // ---------- Money ----------
  function addMoney(state, amount) {
    state.money += amount;
    if (amount > 0) state.stats.lifetimeEarned += amount;
    return state.money;
  }
  function spendMoney(state, amount) {
    if (state.money < amount) return false;
    state.money -= amount;
    state.stats.lifetimeSpent += amount;
    return true;
  }

  // ---------- Case opening ----------
  function rollDrop(caseObj, luck) {
    if (Math.random() < Data.PRISMATIC_CHANCE) {
      const skin = Data.PRISMATIC_SKINS[Utils.randInt(0, Data.PRISMATIC_SKINS.length - 1)];
      const condition = Data.rollCondition();
      const [lo, hi] = Data.RARITY_VALUE.prismatic;
      const value = Math.round(Utils.rand(lo, hi) * condition.mult);
      return { skin, condition, value, isPrismatic: true };
    }
    const pool = Data.skinsForCase(caseObj.id);
    const entries = pool.map(s => {
      const r = Data.RARITY_BY_ID[s.rarity];
      const boost = r.order >= 2 ? (1 + luck) : 1; // rare-and-above gets the luck boost
      return { weight: r.weight * boost, skin: s };
    });
    const picked = Utils.weightedPick(entries).skin;
    const condition = Data.rollCondition();
    const base = Data.baseValueFor(picked.id, caseObj.valueScale);
    const value = Math.round(base * condition.mult);
    return { skin: picked, condition, value, isPrismatic: false };
  }

  function openCase(state, caseId) {
    const caseObj = Data.CASE_BY_ID[caseId];
    const drop = rollDrop(caseObj, luckBonus(state));
    const item = {
      uid: Utils.uid('inv'),
      skinId: drop.skin.id,
      rarity: drop.skin.rarity,
      condition: drop.condition,
      value: drop.value,
      caseId: caseObj.id,
      obtainedAt: Date.now()
    };
    state.inventory.push(item);

    state.stats.casesOpened += 1;
    state.stats.casesOpenedByCase[caseId] = (state.stats.casesOpenedByCase[caseId] || 0) + 1;
    const order = Data.RARITY_BY_ID[item.rarity].order;
    if (order > state.stats.bestRarityOrder) {
      state.stats.bestRarityOrder = order;
      state.stats.bestSkinId = item.skinId;
    }

    const xpGain = 12 + caseObj.tier * 6;
    const xpResult = addXP(state, xpGain);

    state.history.unshift({ ts: item.obtainedAt, skinId: item.skinId, caseId: caseObj.id, rarity: item.rarity, value: item.value, condition: item.condition.name });
    if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP;

    updateMissionProgress(state, 'open_cases', 1);
    if (order >= 2) updateMissionProgress(state, 'get_rare', 1);

    return { item, xpResult, isPrismatic: drop.isPrismatic };
  }

  function buyAndOpenCase(state, caseId) {
    const caseObj = Data.CASE_BY_ID[caseId];
    if (!caseObj) throw new Error('Unknown case');
    if (!isCaseUnlocked(state, caseObj)) return { ok: false, reason: 'locked' };
    const price = effectiveCasePrice(state, caseObj);
    if (!spendMoney(state, price)) return { ok: false, reason: 'funds' };
    updateMissionProgress(state, 'spend_money', price);
    const result = openCase(state, caseId);
    return { ok: true, price, ...result };
  }

  // ---------- Inventory / market ----------
  function findItem(state, uid) {
    return state.inventory.find(i => i.uid === uid) || null;
  }

  function sellItem(state, uid) {
    const idx = state.inventory.findIndex(i => i.uid === uid);
    if (idx === -1) return { ok: false };
    const item = state.inventory[idx];
    let payout = Math.round(item.value * fortuneMult(state) * prestigeMult(state));
    let bonus = false;
    if (Math.random() < insightChance(state)) {
      payout = Math.round(payout * 1.5);
      bonus = true;
    }
    state.inventory.splice(idx, 1);
    addMoney(state, payout);
    state.stats.itemsSold += 1;
    updateMissionProgress(state, 'sell_items', 1);
    updateMissionProgress(state, 'earn_money', payout);
    return { ok: true, payout, bonus };
  }

  function sellMany(state, uids) {
    let total = 0, count = 0, anyBonus = false;
    for (const uid of uids) {
      const r = sellItem(state, uid);
      if (r.ok) { total += r.payout; count += 1; anyBonus = anyBonus || r.bonus; }
    }
    return { total, count, anyBonus };
  }

  // ---------- Upgrades ----------
  function buyUpgrade(state, upgradeId) {
    const upg = Data.UPGRADES.find(u => u.id === upgradeId);
    if (!upg) return { ok: false };
    const lvl = state.upgrades[upgradeId] || 0;
    if (lvl >= upg.maxLevel) return { ok: false, reason: 'max' };
    const cost = Data.upgradeCost(upg, lvl);
    if (!spendMoney(state, cost)) return { ok: false, reason: 'funds' };
    state.upgrades[upgradeId] = lvl + 1;
    return { ok: true, cost, newLevel: lvl + 1 };
  }

  // ---------- Prestige ----------
  function canPrestige(state) { return state.level >= Data.PRESTIGE.requiredLevel; }
  function doPrestige(state) {
    if (!canPrestige(state)) return { ok: false };
    state.prestigeCount += 1;
    state.money = STARTING_MONEY;
    state.xp = 0;
    state.level = 1;
    state.inventory = [];
    state.upgrades = { luck: 0, fortune: 0, xp: 0, discount: 0, insight: 0 };
    state.missions = { date: null, list: [] };
    // Note: achievement checks happen in the UI layer after every action (including this
    // one), never in here — doing it here would let a freshly-granted XP reward immediately
    // re-level the player in the same tick, undermining the "reset to level 1" guarantee.
    return { ok: true, prestigeCount: state.prestigeCount };
  }

  // ---------- Missions ----------
  function ensureDailyMissions(state) {
    const today = Utils.todayKey();
    if (state.missions.date === today && state.missions.list.length) return false;
    const templates = [...Data.MISSION_TEMPLATES];
    const chosen = [];
    while (chosen.length < DAILY_MISSION_COUNT && templates.length) {
      const idx = Utils.randInt(0, templates.length - 1);
      chosen.push(templates.splice(idx, 1)[0]);
    }
    state.missions = {
      date: today,
      list: chosen.map(t => {
        const target = Utils.randInt(t.range[0], t.range[1]);
        return { id: Utils.uid('m'), templateId: t.id, target, progress: 0, claimed: false };
      })
    };
    return true;
  }

  function missionTypeById(templateId) {
    return Data.MISSION_TEMPLATES.find(t => t.id === templateId);
  }

  function updateMissionProgress(state, type, amount) {
    if (!state.missions.list) return;
    for (const m of state.missions.list) {
      if (m.claimed) continue;
      const tpl = missionTypeById(m.templateId);
      if (!tpl || tpl.type !== type) continue;
      m.progress = Utils.clamp(m.progress + amount, 0, m.target);
    }
  }

  function claimMission(state, missionId) {
    const m = state.missions.list.find(x => x.id === missionId);
    if (!m || m.claimed || m.progress < m.target) return { ok: false };
    const tpl = missionTypeById(m.templateId);
    const reward = tpl.reward(m.target);
    const money = Math.round(reward.money * prestigeMult(state));
    addMoney(state, money);
    addXP(state, reward.xp);
    m.claimed = true;
    return { ok: true, money, xp: reward.xp };
  }

  // ---------- Achievements ----------
  function statValue(state, key) {
    if (key === 'level') return state.level;
    if (key === 'prestigeCount') return state.prestigeCount;
    return state.stats[key];
  }
  function checkAchievements(state) {
    const unlockedNow = [];
    for (const a of Data.ACHIEVEMENTS) {
      if (state.achievements.unlocked.includes(a.id)) continue;
      const v = statValue(state, a.stat);
      if (v !== undefined && v >= a.target) {
        state.achievements.unlocked.push(a.id);
        addMoney(state, a.reward.money || 0);
        addXP(state, a.reward.xp || 0);
        unlockedNow.push(a);
      }
    }
    return unlockedNow;
  }

  // ---------- Daily reward ----------
  function dailyRewardStatus(state) {
    const today = Utils.todayKey();
    const last = state.dailyReward.lastClaimDate;
    if (last === today) return { claimedToday: true, streak: state.dailyReward.streak };
    let nextStreak = 1;
    if (last) {
      const gap = Utils.daysBetween(last, today);
      if (gap === 1) nextStreak = (state.dailyReward.streak % 7) + 1;
    }
    return { claimedToday: false, streak: nextStreak, entry: Data.DAILY_REWARDS[nextStreak - 1] };
  }
  function claimDailyReward(state) {
    const status = dailyRewardStatus(state);
    if (status.claimedToday) return { ok: false };
    const entry = status.entry;
    const money = Math.round(entry.money * prestigeMult(state));
    addMoney(state, money);
    addXP(state, entry.xp);
    state.dailyReward.lastClaimDate = Utils.todayKey();
    state.dailyReward.streak = status.streak;
    let freeItem = null;
    if (entry.freeCase && isCaseUnlocked(state, Data.CASE_BY_ID[entry.freeCase])) {
      freeItem = openCase(state, entry.freeCase).item;
    }
    return { ok: true, money, xp: entry.xp, streak: status.streak, freeItem };
  }

  // ---------- Casino: coinflip ----------
  function coinflip(state, bet) {
    if (bet <= 0 || !spendMoney(state, bet)) return { ok: false, reason: 'funds' };
    const win = Math.random() < 0.485; // slight house edge
    if (win) {
      const payout = Math.round(bet * 1.92 * prestigeMult(state));
      addMoney(state, payout);
      state.stats.coinflipWins += 1;
      updateMissionProgress(state, 'coinflip_win', 1);
      return { ok: true, win: true, payout };
    }
    state.stats.coinflipLosses += 1;
    return { ok: true, win: false, payout: 0 };
  }

  // ---------- Casino: upgrade contract ----------
  function upgradeTargets(state, uids) {
    const items = uids.map(u => findItem(state, u)).filter(Boolean);
    const inputValue = items.reduce((s, i) => s + i.value, 0);
    const unlockedCases = Data.CASES.filter(c => isCaseUnlocked(state, c));
    const candidates = [];
    for (const c of unlockedCases) {
      for (const s of Data.skinsForCase(c.id)) {
        const val = Data.baseValueFor(s.id, c.valueScale);
        if (val > inputValue * 1.15 && val <= inputValue * 9) {
          const chance = Utils.clamp((inputValue / val) * 0.9, 0.04, 0.75);
          candidates.push({ skin: s, caseId: c.id, value: val, chance });
        }
      }
    }
    candidates.sort((a, b) => a.value - b.value);
    // de-dup by rarity tier, keep cheapest-to-hit per tier, cap at 4 options
    const seen = new Set();
    const out = [];
    for (const c of candidates) {
      if (seen.has(c.skin.rarity)) continue;
      seen.add(c.skin.rarity);
      out.push(c);
      if (out.length >= 4) break;
    }
    return { inputValue, options: out };
  }

  function runUpgradeContract(state, uids, targetSkinId, targetCaseId, chance) {
    const items = uids.map(u => findItem(state, u)).filter(Boolean);
    if (!items.length) return { ok: false };
    // remove wagered items
    state.inventory = state.inventory.filter(i => !uids.includes(i.uid));
    const win = Math.random() < chance;
    if (win) {
      const caseObj = Data.CASE_BY_ID[targetCaseId];
      const condition = Data.rollCondition();
      const base = Data.baseValueFor(targetSkinId, caseObj.valueScale);
      const skin = Data.SKIN_BY_ID[targetSkinId];
      const item = {
        uid: Utils.uid('inv'), skinId: skin.id, rarity: skin.rarity,
        condition, value: Math.round(base * condition.mult), caseId: caseObj.id, obtainedAt: Date.now()
      };
      state.inventory.push(item);
      state.stats.upgradeWins += 1;
      return { ok: true, win: true, item };
    }
    state.stats.upgradeLosses += 1;
    return { ok: true, win: false };
  }

  return {
    SAVE_KEY, STARTING_MONEY,
    freshState, validate, load, save, scheduleSave, exportJSON, importJSON,
    luckBonus, fortuneMult, xpMult, casePriceMult, insightChance, prestigeMult,
    effectiveCasePrice, isCaseUnlocked, rank, xpProgress,
    addXP, addMoney, spendMoney,
    rollDrop, openCase, buyAndOpenCase,
    findItem, sellItem, sellMany,
    buyUpgrade,
    canPrestige, doPrestige,
    ensureDailyMissions, updateMissionProgress, claimMission, missionTypeById,
    checkAchievements,
    dailyRewardStatus, claimDailyReward,
    coinflip,
    upgradeTargets, runUpgradeContract
  };
})();
