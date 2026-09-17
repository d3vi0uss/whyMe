/* audio.js — every sound is synthesized with the Web Audio API. No .mp3/.wav files exist,
   so there is nothing that can fail to load. */
'use strict';

const Audio2 = (() => {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.6;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  }

  // Must be called from within a user-gesture event handler (click/tap) the first time,
  // to satisfy browser autoplay policies.
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }

  function setEnabled(v) { enabled = v; }
  function setVolume(v) { volume = Utils.clamp(v, 0, 1); if (master) master.gain.value = volume; }

  function tone({ freq = 440, type = 'sine', duration = 0.15, gain = 0.25, sweepTo = null, delay = 0 }) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noiseBurst({ duration = 0.2, gain = 0.2, delay = 0, filterFreq = 2000 }) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const Sfx = {
    click: () => tone({ freq: 720, type: 'square', duration: 0.05, gain: 0.12 }),
    nav: () => tone({ freq: 340, type: 'sine', duration: 0.08, gain: 0.15 }),
    error: () => { tone({ freq: 180, type: 'sawtooth', duration: 0.18, gain: 0.15 }); },
    coin: () => { tone({ freq: 880, type: 'triangle', duration: 0.1, gain: 0.18 }); tone({ freq: 1320, type: 'triangle', duration: 0.12, gain: 0.14, delay: 0.05 }); },
    caseSpin: () => noiseBurst({ duration: 1.1, gain: 0.06, filterFreq: 1200 }),
    caseStop: () => { tone({ freq: 200, type: 'square', duration: 0.09, gain: 0.2 }); noiseBurst({ duration: 0.12, gain: 0.12, filterFreq: 800 }); },
    reveal: (rarityOrder) => {
      const base = 260 + rarityOrder * 90;
      tone({ freq: base, type: 'sine', duration: 0.22, gain: 0.2, sweepTo: base * 1.6 });
      if (rarityOrder >= 4) tone({ freq: base * 1.5, type: 'triangle', duration: 0.3, gain: 0.16, delay: 0.08 });
      if (rarityOrder >= 6) { tone({ freq: base * 2, type: 'triangle', duration: 0.4, gain: 0.16, delay: 0.16 }); tone({ freq: base * 2.5, type: 'sine', duration: 0.5, gain: 0.12, delay: 0.24 }); }
    },
    levelUp: () => { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', duration: 0.18, gain: 0.18, delay: i * 0.07 })); },
    sell: () => tone({ freq: 500, type: 'sine', duration: 0.09, gain: 0.16, sweepTo: 700 }),
    win: () => { tone({ freq: 600, type: 'sine', duration: 0.15, gain: 0.2, sweepTo: 900 }); tone({ freq: 900, type: 'triangle', duration: 0.2, gain: 0.14, delay: 0.1 }); },
    lose: () => tone({ freq: 300, type: 'sawtooth', duration: 0.25, gain: 0.14, sweepTo: 120 }),
    toggle: () => tone({ freq: 500, type: 'square', duration: 0.06, gain: 0.12 })
  };

  return { unlock, setEnabled, setVolume, play: Sfx };
})();
