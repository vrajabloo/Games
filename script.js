/*
  بمباران/جنگ کاغذی – Paper Bombing
  معماری مختصر:
  - GameState: وضعیت کلی بازی، بازیکن فعال، فاز (start, placement, battle, gameover)، تاریخچه ضربه‌ها، تنظیمات.
  - Board (for each player): مدل Grid N×N، لیست واحدها، ثبت Hit/Miss، محاسبه نابودی.
  - Renderer: دو Canvas (زمین من/حریف)، رسم شبکه، واحدهای خودی، نقاط ضربه، انیمیشن‌ها.
  - UI: منوها/مودال‌ها، پنل چیدمان، دکمه‌ها و رویدادها، متن‌ها.
  - Storage: ذخیره/بارگذاری در localStorage.
  - Audio: صدای کوتاه Hit/Miss با WebAudio.
*/
(() => {
  'use strict';

  // کلید ذخیره‌سازی
  const STORAGE_KEY = 'paper-bombing-save-v1';
  const SETTINGS_KEY = 'paper-bombing-settings-v1';

  // عناصر DOM اصلی
  const el = {
    canvasMy: document.getElementById('canvasMy'),
    canvasEnemy: document.getElementById('canvasEnemy'),
    topActiveLabel: document.getElementById('activePlayerLabel'),
    p1UnitsLeft: document.getElementById('p1UnitsLeft'),
    p2UnitsLeft: document.getElementById('p2UnitsLeft'),
    turnCount: document.getElementById('turnCount'),
    placementPanel: document.getElementById('placementPanel'),
    unitPalette: document.getElementById('unitPalette'),
    placementPlayer: document.getElementById('placementPlayer'),
    startOverlay: document.getElementById('startOverlay'),
    helpOverlay: document.getElementById('helpOverlay'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    gameOverOverlay: document.getElementById('gameOverOverlay'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    gameOverDesc: document.getElementById('gameOverDesc'),
    // buttons
    btnHelp: document.getElementById('btnHelp'),
    btnSettings: document.getElementById('btnSettings'),
    btnNewGame: document.getElementById('btnNewGame'),
    btnStart: document.getElementById('btnStart'),
    btnContinue: document.getElementById('btnContinue'),
    btnOpenHelp: document.getElementById('btnOpenHelp'),
    btnOpenSettings: document.getElementById('btnOpenSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    btnRematch: document.getElementById('btnRematch'),
    btnPlacementDone: document.getElementById('btnPlacementDone'),
    btnRandomPlace: document.getElementById('btnRandomPlace'),
    btnRotateSelected: document.getElementById('btnRotateSelected'),
    btnClearPlacement: document.getElementById('btnClearPlacement'),
    btnMobileSwitch: document.getElementById('btnMobileSwitch'),
    // settings inputs
    gridSize: document.getElementById('gridSize'),
    gridSizeVal: document.getElementById('gridSizeVal'),
    dotSize: document.getElementById('dotSize'),
    dotSizeVal: document.getElementById('dotSizeVal'),
    previewEnabled: document.getElementById('previewEnabled'),
    soundEnabled: document.getElementById('soundEnabled'),
    count_soldier: document.getElementById('count_soldier'),
    count_tank: document.getElementById('count_tank'),
    count_artillery: document.getElementById('count_artillery'),
    count_bunker: document.getElementById('count_bunker'),
    count_plane: document.getElementById('count_plane'),
    hp_soldier: document.getElementById('hp_soldier'),
    hp_tank: document.getElementById('hp_tank'),
    hp_artillery: document.getElementById('hp_artillery'),
    hp_bunker: document.getElementById('hp_bunker'),
    hp_plane: document.getElementById('hp_plane'),
  };

  const ctxMy = el.canvasMy.getContext('2d');
  const ctxEnemy = el.canvasEnemy.getContext('2d');

  // ابزار عمومی
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // واحدها و تنظیمات پیش‌فرض
  const defaultSettings = {
    gridSize: 12,
    dotSize: 14,
    previewEnabled: true,
    soundEnabled: true,
    units: {
      soldier: { count: 4, hp: 1, w: 1, h: 1 },
      tank: { count: 3, hp: 2, w: 2, h: 1 },
      artillery: { count: 2, hp: 2, w: 3, h: 1 },
      bunker: { count: 1, hp: 3, w: 2, h: 2 },
      plane: { count: 1, hp: 2, w: 1, h: 3 },
    },
  };

  // بارگذاری/ذخیره تنظیمات
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return structuredClone(defaultSettings);
      const parsed = JSON.parse(raw);
      // ادغام با پیش‌فرض‌ها برای سازگاری
      return mergeDeep(structuredClone(defaultSettings), parsed);
    } catch {
      return structuredClone(defaultSettings);
    }
  }
  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ادغام عمیق ساده
  function mergeDeep(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        mergeDeep(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  // مدل واحد
  function createUnit(kind, x, y, w, h, hp) {
    return { id: Math.random().toString(36).slice(2), kind, x, y, w, h, hp, maxHp: hp, destroyed: false, rotated: false };
  }

  // مدل برد
  function createBoard(size) {
    return {
      size,
      units: [],
      hits: [], // {r,c, result: 'hit'|'miss', unitId?}
    };
  }

  // وضعیت کلی بازی
  const Game = {
    phase: 'start', // 'start' | 'placement' | 'battle' | 'gameover'
    activePlayer: 1, // 1 یا 2
    turnCount: 0,
    settings: loadSettings(),
    boards: { 1: createBoard(12), 2: createBoard(12) },
    placement: { player: 1, done1: false, done2: false, selectedPalette: null },
    winner: null,
  };

  // به‌روزرسانی Grid از تنظیمات
  function applyGridSize() {
    const n = Game.settings.gridSize;
    Game.boards[1].size = n;
    Game.boards[2].size = n;
    requestRender();
  }

  // نگاشت مختصات: Canvas → نرمالیزه 0..1 → Grid
  function canvasToNorm(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width;
    const y = (evt.clientY - rect.top) / rect.height;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }
  function normToGrid(board, nx, ny) {
    const n = board.size;
    const c = Math.floor(nx * n);
    const r = Math.floor(ny * n);
    return { r: clamp(r, 0, n - 1), c: clamp(c, 0, n - 1) };
  }
  function gridToCellRect(canvas, board, r, c) {
    const n = board.size;
    const w = canvas.width;
    const h = canvas.height;
    const cw = w / n;
    const ch = h / n;
    return { x: c * cw, y: r * ch, w: cw, h: ch };
  }

  // بررسی هم‌پوشانی واحدها
  function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  function canPlaceUnit(board, unit) {
    const n = board.size;
    if (unit.x < 0 || unit.y < 0 || unit.x + unit.w > n || unit.y + unit.h > n) return false;
    for (const u of board.units) {
      if (u.destroyed) continue;
      if (rectsOverlap(u, unit)) return false;
    }
    return true;
  }

  // قرار دادن واحد
  function placeUnit(board, unit) {
    if (!canPlaceUnit(board, unit)) return false;
    board.units.push(unit);
    return true;
  }

  // زدن ضربه روی Grid حریف
  function hitAt(board, r, c) {
    // اگر قبلاً زده شده بود
    if (board.hits.find(h => h.r === r && h.c === c)) return { already: true };

    let result = 'miss';
    let unitHit = null;
    for (const u of board.units) {
      if (u.destroyed) continue;
      if (r >= u.y && r < u.y + u.h && c >= u.x && c < u.x + u.w) {
        result = 'hit';
        unitHit = u;
        u.hp -= 1;
        if (u.hp <= 0) {
          u.destroyed = true;
        }
        break;
      }
    }
    const record = { r, c, result, unitId: unitHit ? unitHit.id : undefined };
    board.hits.push(record);
    return record;
  }

  function remainingUnits(board) {
    return board.units.filter(u => !u.destroyed).length;
  }

  // رندر
  const Renderer = (() => {
    const state = { needsRender: true, previewNorm: null, showMy: true };

    function request() { state.needsRender = true; }

    function drawGrid(ctx, canvas, board) {
      const n = board.size;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // پس‌زمینه
      ctx.fillStyle = '#0b0e13';
      ctx.fillRect(0, 0, w, h);

      // شبکه
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
      ctx.lineWidth = 1;
      const cw = w / n, ch = h / n;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        ctx.moveTo(0, i * ch); ctx.lineTo(w, i * ch);
        ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h);
      }
      ctx.stroke();

      // خطوط قوی‌تر 3×3
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-strong');
      ctx.beginPath();
      const step = 3;
      for (let i = 0; i <= n; i += step) {
        ctx.moveTo(0, i * ch); ctx.lineTo(w, i * ch);
        ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h);
      }
      ctx.stroke();
    }

    function drawUnits(ctx, canvas, board) {
      const n = board.size;
      const cw = canvas.width / n;
      const ch = canvas.height / n;

      for (const u of board.units) {
        if (u.destroyed) continue;
        ctx.save();
        const x = u.x * cw, y = u.y * ch, w = u.w * cw, h = u.h * ch;
        // پس‌زمینه واحد
        ctx.fillStyle = 'rgba(45,212,191,.18)';
        ctx.strokeStyle = 'rgba(45,212,191,.8)';
        ctx.lineWidth = 2;
        roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 6);
        ctx.fill();
        ctx.stroke();

        // نوار HP
        const hpRatio = u.hp / u.maxHp;
        ctx.fillStyle = 'rgba(96,165,250,.8)';
        ctx.fillRect(x + 4, y + h - 10, (w - 8) * hpRatio, 6);
        ctx.restore();
      }

      // واحدهای نابود شده به صورت محو
      for (const u of board.units) {
        if (!u.destroyed) continue;
        ctx.save();
        const x = u.x * cw, y = u.y * ch, w = u.w * cw, h = u.h * ch;
        ctx.fillStyle = 'rgba(239,68,68,.16)';
        ctx.strokeStyle = 'rgba(239,68,68,.6)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6);
        ctx.stroke();
        ctx.restore();
      }
    }

    function drawHits(ctx, canvas, board, revealUnits) {
      const n = board.size;
      const cw = canvas.width / n;
      const ch = canvas.height / n;
      for (const h of board.hits) {
        const cx = h.c * cw + cw / 2;
        const cy = h.r * ch + ch / 2;
        const radius = Math.max(3, Math.min(18, Game.settings.dotSize * 0.45));
        if (h.result === 'hit') {
          ctx.fillStyle = 'rgba(245,158,11,.9)';
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(148,163,184,.9)';
          ctx.lineWidth = Math.max(1, Math.min(4, Game.settings.dotSize * 0.16));
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (revealUnits) {
        // برای نمایش نابودی حریف پس از صفر شدن HP
        drawUnits(ctx, canvas, board);
      }
    }

    function render() {
      if (!state.needsRender) return;
      state.needsRender = false;

      // مقیاس داخلی Canvas را با CSS همگام کنیم
      syncCanvas(el.canvasMy);
      syncCanvas(el.canvasEnemy);

      // انتخاب ایندکس‌ها بر حسب فاز
      const myIndex = (Game.phase === 'placement') ? Game.placement.player : Game.activePlayer;
      const opponent = myIndex === 1 ? 2 : 1;

      // زمین من: کامل (واحدها + ضربه‌های حریف روی زمین من)
      drawGrid(ctxMy, el.canvasMy, Game.boards[myIndex]);
      const myBoard = Game.boards[myIndex];
      drawUnits(ctxMy, el.canvasMy, myBoard);
      // ضربه‌های دریافت‌شده روی زمین من
      drawHits(ctxMy, el.canvasMy, Game.boards[myIndex], true);

      // زمین حریف: فقط نقاطی که من زده‌ام (واحدها مخفی تا نابود شوند)
      const enemyBoard = Game.boards[opponent];
      drawGrid(ctxEnemy, el.canvasEnemy, enemyBoard);
      // فقط ضربه‌ها را نشان بده؛ واحدها را فقط وقتی نابود شدند با فرم محو نشان می‌دهیم
      drawHits(ctxEnemy, el.canvasEnemy, enemyBoard, false);
      // نمایش حدود واحدهای نابودشده برای فیدبک
      (function drawDestroyed() {
        const n = enemyBoard.size;
        const cw = el.canvasEnemy.width / n;
        const ch = el.canvasEnemy.height / n;
        for (const u of enemyBoard.units) {
          if (!u.destroyed) continue;
          const x = u.x * cw, y = u.y * ch, w = u.w * cw, h = u.h * ch;
          ctxEnemy.save();
          ctxEnemy.strokeStyle = 'rgba(239,68,68,.6)';
          ctxEnemy.lineWidth = 1.5;
          ctxEnemy.setLineDash([6, 6]);
          ctxEnemy.strokeRect(x + 3, y + 3, w - 6, h - 6);
          ctxEnemy.restore();
        }
      })();

      // پیش‌نمایش تا زدن: روی زمین حریف نشانگر شفاف
      if (Game.phase === 'battle' && Game.settings.previewEnabled && state.previewNorm) {
        showPreviewMarker(el.canvasEnemy, state.previewNorm);
      } else {
        hidePreviewMarker(el.canvasEnemy);
      }
    }

    function syncCanvas(canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width * dpr));
      const h = Math.max(300, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
    }

    function roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function setPreview(norm) { state.previewNorm = norm; request(); }

    // DOM marker برای پیش‌نمایش
    function showPreviewMarker(containerCanvas, norm) {
      let marker = containerCanvas.parentElement.querySelector('.preview-marker');
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'preview-marker';
        containerCanvas.parentElement.appendChild(marker);
      }
      const rect = containerCanvas.getBoundingClientRect();
      // نقل به مختصات محلی والد برای جلوگیری از جابجایی با اسکرول
      const parentRect = containerCanvas.parentElement.getBoundingClientRect();
      const mx = (norm.x * rect.width);
      const my = (norm.y * rect.height);
      marker.style.left = `${Math.round(mx)}px`;
      marker.style.top = `${Math.round(my)}px`;
      marker.style.position = 'absolute';
    }
    function hidePreviewMarker(containerCanvas) {
      const marker = containerCanvas.parentElement.querySelector('.preview-marker');
      if (marker) marker.remove();
    }

    return { request, render, setPreview };
  })();

  function requestRender() { Renderer.request(); }

  // Audio: صداهای کوتاه بدون فایل (Oscillator)
  const AudioFX = (() => {
    let ctx = null;
    function init() {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    function beep(type = 'sine', startFreq = 440, endFreq = 220, duration = 0.12, gain = 0.04) {
      if (!Game.settings.soundEnabled) return;
      if (!ctx) init();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    }
    return { beep };
  })();

  // ذخیره/بارگذاری بازی
  function saveGame() {
    try {
      const toSave = {
        phase: Game.phase,
        activePlayer: Game.activePlayer,
        turnCount: Game.turnCount,
        settings: Game.settings,
        boards: {
          1: {
            size: Game.boards[1].size,
            units: Game.boards[1].units,
            hits: Game.boards[1].hits,
          },
          2: {
            size: Game.boards[2].size,
            units: Game.boards[2].units,
            hits: Game.boards[2].hits,
          },
        },
        placement: Game.placement,
        winner: Game.winner,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      el.btnContinue && (el.btnContinue.disabled = false);
    } catch (e) {
      console.error('saveGame failed', e);
    }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      Object.assign(Game, data);
      return true;
    } catch (e) {
      console.error('loadGame failed', e);
      return false;
    }
  }

  function clearGame() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // UI helpers
  function showOverlay(id, show) {
    const elx = document.getElementById(id);
    if (!elx) return;
    elx.classList.toggle('visible', !!show);
  }

  function updateTopbar() {
    el.topActiveLabel.textContent = `نوبت بازیکن ${Game.activePlayer}`;
    const me = Game.activePlayer;
    const op = me === 1 ? 2 : 1;
    el.p1UnitsLeft.textContent = remainingUnits(Game.boards[1]);
    el.p2UnitsLeft.textContent = remainingUnits(Game.boards[2]);
    el.turnCount.textContent = Game.turnCount;
  }

  // ایجاد پالت واحدها بر اساس تنظیمات
  function buildPalette() {
    el.unitPalette.innerHTML = '';
    const uDefs = Game.settings.units;
    const items = [
      { key: 'soldier', label: 'سرباز', w: uDefs.soldier.w, h: uDefs.soldier.h, hp: uDefs.soldier.hp, count: uDefs.soldier.count },
      { key: 'tank', label: 'تانک', w: uDefs.tank.w, h: uDefs.tank.h, hp: uDefs.tank.hp, count: uDefs.tank.count },
      { key: 'artillery', label: 'توپ‌خانه', w: uDefs.artillery.w, h: uDefs.artillery.h, hp: uDefs.artillery.hp, count: uDefs.artillery.count },
      { key: 'bunker', label: 'سنگر', w: uDefs.bunker.w, h: uDefs.bunker.h, hp: uDefs.bunker.hp, count: uDefs.bunker.count },
      { key: 'plane', label: 'هواپیما', w: uDefs.plane.w, h: uDefs.plane.h, hp: uDefs.plane.hp, count: uDefs.plane.count },
    ];

    for (const it of items) {
      if (it.count <= 0) continue;
      const div = document.createElement('div');
      div.className = 'unit-item';
      div.draggable = true;
      div.dataset.kind = it.key;
      div.dataset.w = String(it.w);
      div.dataset.h = String(it.h);
      div.dataset.hp = String(it.hp);
      div.textContent = `${it.label} ×${it.count} (HP ${it.hp})`;
      el.unitPalette.appendChild(div);
    }
  }

  // درگ/دراپ ساده برای چیدمان روی Canvas «زمین من»
  let dragItem = null; // {kind,w,h,hp}
  let hoverCell = null; // {r,c}

  function setupPlacementDnD() {
    el.unitPalette.addEventListener('dragstart', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('unit-item')) return;
      dragItem = {
        kind: target.dataset.kind,
        w: parseInt(target.dataset.w, 10),
        h: parseInt(target.dataset.h, 10),
        hp: parseInt(target.dataset.hp, 10),
      };
      e.dataTransfer.setData('text/plain', JSON.stringify(dragItem));
    });

    el.canvasMy.addEventListener('dragover', (e) => {
      if (!dragItem) return;
      e.preventDefault();
      const myBoard = Game.boards[Game.placement.player];
      const norm = canvasToNorm(el.canvasMy, e);
      const cell = normToGrid(myBoard, norm.x, norm.y);
      hoverCell = cell;
      requestRender();
    });

    el.canvasMy.addEventListener('drop', (e) => {
      if (!dragItem) return;
      e.preventDefault();
      const myBoard = Game.boards[Game.placement.player];
      const norm = canvasToNorm(el.canvasMy, e);
      const cell = normToGrid(myBoard, norm.x, norm.y);
      const unit = createUnit(dragItem.kind, cell.c, cell.r, dragItem.w, dragItem.h, dragItem.hp);
      if (placeUnit(myBoard, unit)) {
        AudioFX.beep('triangle', 660, 440, 0.08, 0.03);
        consumePaletteItem(dragItem.kind);
      } else {
        AudioFX.beep('sawtooth', 330, 220, 0.07, 0.02);
      }
      dragItem = null;
      hoverCell = null;
      requestRender();
      saveGame();
    });
  }

  function consumePaletteItem(kind) {
    // یکی از اقلام را کم می‌کنیم؛ اگر صفر شد، حذف
    const item = Array.from(el.unitPalette.querySelectorAll('.unit-item')).find(d => d.dataset.kind === kind);
    if (!item) return;
    const txt = item.textContent || '';
    const m = txt.match(/×(\d+)/);
    if (m) {
      const cnt = Math.max(0, parseInt(m[1], 10) - 1);
      if (cnt <= 0) item.remove(); else item.textContent = txt.replace(/×\d+/, `×${cnt}`);
    }
  }

  function clearPlacementFor(player) {
    Game.boards[player].units = [];
    requestRender();
    saveGame();
  }

  // رویدادهای Canvas برای نبرد
  function setupBattleEvents() {
    // کلیک روی زمین خود = تعیین مختصات نرمالیزه و اعمال روی حریف
    el.canvasMy.addEventListener('click', (e) => {
      if (Game.phase !== 'battle') return;
      const norm = canvasToNorm(el.canvasMy, e);
      doAttackWithNormalized(norm);
    });

    // پیش‌نمایش
    el.canvasMy.addEventListener('pointermove', (e) => {
      if (Game.phase !== 'battle' || !Game.settings.previewEnabled) return;
      const norm = canvasToNorm(el.canvasMy, e);
      Renderer.setPreview(norm);
    });
    el.canvasMy.addEventListener('pointerleave', () => {
      Renderer.setPreview(null);
    });
  }

  function doAttackWithNormalized(norm) {
    // همان مختصات روی زمین حریف بدون هرگونه آینه/چرخش
    const me = Game.activePlayer;
    const op = me === 1 ? 2 : 1;
    const enemyBoard = Game.boards[op];
    const cell = normToGrid(enemyBoard, norm.x, norm.y);
    const res = hitAt(enemyBoard, cell.r, cell.c);
    if (res.already) return; // خانه تکراری

    // افکت‌ها
    spawnHitEffect(el.canvasEnemy, norm, res.result === 'hit');
    if (res.result === 'hit') AudioFX.beep('square', 880, 440, 0.12, 0.05); else AudioFX.beep('sine', 440, 330, 0.1, 0.03);

    // شمارش نوبت و بررسی برد/باخت
    Game.turnCount += 1;
    const left = remainingUnits(enemyBoard);
    updateTopbar();
    requestRender();
    saveGame();

    if (left <= 0) {
      Game.phase = 'gameover';
      Game.winner = me;
      el.gameOverTitle.textContent = `برد با بازیکن ${me}!`;
      el.gameOverDesc.textContent = `پس از ${Game.turnCount} ضربه.`;
      showOverlay('gameOverOverlay', true);
      saveGame();
      return;
    }

    // تعویض نوبت
    Game.activePlayer = op;
    updateTopbar();
    requestRender();
    saveGame();
  }

  function spawnHitEffect(canvas, norm, isHit) {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + norm.x * rect.width;
    const y = rect.top + norm.y * rect.height;
    const elDiv = document.createElement('div');
    elDiv.className = isHit ? 'effect-explosion' : 'effect-ripple';
    elDiv.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    document.body.appendChild(elDiv);
    setTimeout(() => elDiv.remove(), 900);
  }

  // کنترل مودال‌ها و دکمه‌ها
  function setupUI() {
    // topbar
    el.btnHelp.addEventListener('click', () => showOverlay('helpOverlay', true));
    el.btnSettings.addEventListener('click', () => showOverlay('settingsOverlay', true));
    el.btnNewGame.addEventListener('click', () => startNewGameFlow());

    // start overlay
    el.btnStart.addEventListener('click', () => startNewGameFlow());
    el.btnContinue.addEventListener('click', () => {
      showOverlay('startOverlay', false);
      Game.phase = Game.phase || 'placement';
      updatePhaseUI();
      requestRender();
    });
    el.btnOpenHelp.addEventListener('click', () => showOverlay('helpOverlay', true));
    el.btnOpenSettings.addEventListener('click', () => showOverlay('settingsOverlay', true));

    // generic close buttons
    document.body.addEventListener('click', (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.dataset.close) {
        showOverlay(t.dataset.close, false);
      }
    });

    // settings
    const s = Game.settings;
    el.gridSize.value = String(s.gridSize);
    el.gridSizeVal.textContent = String(s.gridSize);
    el.dotSize.value = String(s.dotSize);
    el.dotSizeVal.textContent = String(s.dotSize);
    el.previewEnabled.checked = s.previewEnabled;
    el.soundEnabled.checked = s.soundEnabled;
    el.count_soldier.value = String(s.units.soldier.count);
    el.count_tank.value = String(s.units.tank.count);
    el.count_artillery.value = String(s.units.artillery.count);
    el.count_bunker.value = String(s.units.bunker.count);
    el.count_plane.value = String(s.units.plane.count);
    el.hp_soldier.value = String(s.units.soldier.hp);
    el.hp_tank.value = String(s.units.tank.hp);
    el.hp_artillery.value = String(s.units.artillery.hp);
    el.hp_bunker.value = String(s.units.bunker.hp);
    el.hp_plane.value = String(s.units.plane.hp);

    el.gridSize.addEventListener('input', () => el.gridSizeVal.textContent = el.gridSize.value);
    el.dotSize.addEventListener('input', () => el.dotSizeVal.textContent = el.dotSize.value);

    el.btnSaveSettings.addEventListener('click', () => {
      Game.settings.gridSize = parseInt(el.gridSize.value, 10);
      Game.settings.dotSize = parseInt(el.dotSize.value, 10);
      Game.settings.previewEnabled = el.previewEnabled.checked;
      Game.settings.soundEnabled = el.soundEnabled.checked;
      Game.settings.units.soldier.count = parseInt(el.count_soldier.value, 10);
      Game.settings.units.tank.count = parseInt(el.count_tank.value, 10);
      Game.settings.units.artillery.count = parseInt(el.count_artillery.value, 10);
      Game.settings.units.bunker.count = parseInt(el.count_bunker.value, 10);
      Game.settings.units.plane.count = parseInt(el.count_plane.value, 10);
      Game.settings.units.soldier.hp = parseInt(el.hp_soldier.value, 10);
      Game.settings.units.tank.hp = parseInt(el.hp_tank.value, 10);
      Game.settings.units.artillery.hp = parseInt(el.hp_artillery.value, 10);
      Game.settings.units.bunker.hp = parseInt(el.hp_bunker.value, 10);
      Game.settings.units.plane.hp = parseInt(el.hp_plane.value, 10);
      saveSettings(Game.settings);
      applyGridSize();
      buildPalette();
      showOverlay('settingsOverlay', false);
      saveGame();
    });

    // placement
    el.btnPlacementDone.addEventListener('click', onPlacementDone);
    el.btnRandomPlace.addEventListener('click', () => randomPlacement(Game.placement.player));
    el.btnRotateSelected.addEventListener('click', rotateLastUnit);
    el.btnClearPlacement.addEventListener('click', () => clearPlacementFor(Game.placement.player));

    // gameover
    el.btnRematch.addEventListener('click', () => {
      showOverlay('gameOverOverlay', false);
      startNewGameFlow();
    });

    // mobile switch (نمایش بوردها عمودی)
    el.btnMobileSwitch.addEventListener('click', () => {
      // فقط برای UX؛ رندر تغییری نمی‌کند
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function onPlacementDone() {
    const p = Game.placement.player;
    const need = countRequiredUnits();
    const placed = Game.boards[p].units.length;
    if (placed < need) {
      alert(`لطفاً همه واحدها را بچین (${placed}/${need})`);
      return;
    }
    if (p === 1) {
      Game.placement.done1 = true;
      Game.placement.player = 2;
      el.placementPlayer.textContent = '۲';
      buildPalette();
      requestRender();
      saveGame();
    } else {
      Game.placement.done2 = true;
      Game.phase = 'battle';
      Game.activePlayer = 1; // بازیکن ۱ شروع کند
      el.placementPanel.classList.add('hidden');
      requestRender();
      saveGame();
    }
    updatePhaseUI();
  }

  function countRequiredUnits() {
    const u = Game.settings.units;
    return u.soldier.count + u.tank.count + u.artillery.count + u.bunker.count + u.plane.count;
  }

  function rotateLastUnit() {
    const p = Game.placement.player;
    const units = Game.boards[p].units;
    if (units.length === 0) return;
    const u = units[units.length - 1];
    const rotated = { ...u, w: u.h, h: u.w };
    if (canPlaceUnit(Game.boards[p], rotated)) {
      u.w = rotated.w; u.h = rotated.h; u.rotated = !u.rotated;
      AudioFX.beep('triangle', 700, 500, 0.06, 0.03);
      requestRender(); saveGame();
    } else {
      AudioFX.beep('sawtooth', 300, 240, 0.06, 0.02);
    }
  }

  function randomPlacement(player) {
    const board = Game.boards[player];
    board.units = [];
    const defs = Game.settings.units;
    const items = [
      ['bunker', defs.bunker],
      ['artillery', defs.artillery],
      ['plane', defs.plane],
      ['tank', defs.tank],
      ['soldier', defs.soldier],
    ];
    for (const [key, def] of items) {
      for (let i = 0; i < def.count; i++) {
        let placed = false;
        for (let tries = 0; tries < 200 && !placed; tries++) {
          const w = def.w, h = def.h;
          const x = Math.floor(Math.random() * (board.size - w + 1));
          const y = Math.floor(Math.random() * (board.size - h + 1));
          const u = createUnit(key, x, y, w, h, def.hp);
          if (Math.random() < 0.5) { // احتمال چرخش
            const alt = { ...u, w: h, h: w };
            if (canPlaceUnit(board, alt)) Object.assign(u, alt);
          }
          if (placeUnit(board, u)) placed = true;
        }
        if (!placed) console.warn('نتوانستم واحد را بچینم:', key);
      }
    }
    requestRender();
    saveGame();
  }

  // رندر Hover هنگام چیدمان
  function renderPlacementOverlay() {
    if (Game.phase !== 'placement') return;
    const board = Game.boards[Game.placement.player];
    if (!hoverCell) return;
    const { r, c } = hoverCell;
    const ctx = ctxMy;
    const canvas = el.canvasMy;
    const cw = canvas.width / board.size;
    const ch = canvas.height / board.size;
    ctx.save();
    ctx.strokeStyle = 'rgba(96,165,250,.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
    ctx.restore();
  }

  // حلقه رندر
  function rafLoop() {
    Renderer.render();
    renderPlacementOverlay();
    requestAnimationFrame(rafLoop);
  }

  // فازها
  function updatePhaseUI() {
    if (Game.phase === 'start') {
      showOverlay('startOverlay', true);
      el.placementPanel.classList.add('hidden');
    } else if (Game.phase === 'placement') {
      showOverlay('startOverlay', false);
      el.placementPanel.classList.remove('hidden');
      el.placementPlayer.textContent = Game.placement.player === 1 ? '۱' : '۲';
    } else if (Game.phase === 'battle') {
      showOverlay('startOverlay', false);
      el.placementPanel.classList.add('hidden');
    } else if (Game.phase === 'gameover') {
      // handled elsewhere
    }
    updateTopbar();
    requestRender();
  }

  function startNewGameFlow() {
    clearGame();
    Game.phase = 'placement';
    Game.activePlayer = 1;
    Game.turnCount = 0;
    Game.boards = { 1: createBoard(Game.settings.gridSize), 2: createBoard(Game.settings.gridSize) };
    Game.placement = { player: 1, done1: false, done2: false, selectedPalette: null };
    Game.winner = null;
    showOverlay('startOverlay', false);
    buildPalette();
    updatePhaseUI();
    saveGame();
  }

  // بوت برنامه
  function boot() {
    // پرچم ادامه بازی
    el.btnContinue.disabled = !localStorage.getItem(STORAGE_KEY);

    // بارگذاری بازی قبلی در صورت وجود
    const loaded = loadGame();
    if (!loaded) {
      Game.phase = 'start';
      Game.activePlayer = 1;
      Game.turnCount = 0;
      Game.boards = { 1: createBoard(Game.settings.gridSize), 2: createBoard(Game.settings.gridSize) };
      Game.placement = { player: 1, done1: false, done2: false, selectedPalette: null };
      Game.winner = null;
    }

    applyGridSize();
    setupUI();
    buildPalette();
    setupPlacementDnD();
    setupBattleEvents();
    updatePhaseUI();
    updateTopbar();
    requestRender();
    rafLoop();

    window.addEventListener('resize', requestRender);
  }

  boot();
})();