'use strict';

/* PackSmith - combine Minecraft texture packs in the browser. */
(function () {
  var PACK_COLORS = ['#6ee7a0', '#7cc4ff', '#f7c948', '#a78bfa', '#ff9ecb', '#ffa657', '#4be1d0', '#ff8a80'];
  var PAGE = 160;
  var PALETTE_LIMIT = 400;

  var CATEGORY_LABELS = {
    all: 'All',
    block: 'Blocks',
    item: 'Items',
    entity: 'Entities',
    gui: 'GUI',
    environment: 'Environment',
    particle: 'Particles',
    painting: 'Paintings',
    mob_effect: 'Effects',
    font: 'Fonts',
    misc: 'Misc',
    colormap: 'Colormaps',
    map: 'Maps',
    effect: 'Effects'
  };

  var CATEGORY_ORDER = ['block', 'item', 'entity', 'gui', 'environment', 'particle', 'painting', 'mob_effect', 'effect', 'font', 'colormap', 'map', 'misc'];

  var QUICK_FILTERS = [
    { id: 'sword', label: 'Swords', test: function (n) { return /(^|_)swords?$/.test(n); } },
    { id: 'pickaxe', label: 'Pickaxes', test: function (n) { return /pickaxe$/.test(n); } },
    { id: 'axe', label: 'Axes', test: function (n) { return /(^|_)axe$/.test(n); } },
    { id: 'shovel', label: 'Shovels', test: function (n) { return /shovel$/.test(n); } },
    { id: 'hoe', label: 'Hoes', test: function (n) { return /_hoe$/.test(n); } },
    { id: 'armor', label: 'Armor', test: function (n) { return /(helmet|chestplate|leggings|boots)$/.test(n); } },
    { id: 'food', label: 'Food', test: function (n) { return /(apple|bread|beef|porkchop|chicken|mutton|carrot|potato|stew|pie|cod|salmon|cookie|cake|melon_slice|berries)$/.test(n); } },
    { id: 'ore', label: 'Ores', test: function (n) { return /_ore$/.test(n); } },
    { id: 'wool', label: 'Wool', test: function (n) { return /_wool$/.test(n); } },
    { id: 'planks', label: 'Planks', test: function (n) { return /_planks$/.test(n); } },
    { id: 'log', label: 'Logs', test: function (n) { return /(_log|_wood|_stem|_hyphae)$/.test(n); } },
    { id: 'leaves', label: 'Leaves', test: function (n) { return /_leaves$/.test(n); } },
    { id: 'glass', label: 'Glass', test: function (n) { return /glass/.test(n); } },
    { id: 'stone', label: 'Stone', test: function (n) { return /stone/.test(n); } },
    { id: 'concrete', label: 'Concrete', test: function (n) { return /_concrete$/.test(n); } },
    { id: 'terracotta', label: 'Terracotta', test: function (n) { return /terracotta$/.test(n); } }
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtSize(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function pretty(path) {
    var base = path.split('/').pop().replace(/\.png$/i, '');
    return base.split('_').filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ') || base;
  }
  function baseName(path) {
    return String(path).split('/').pop().replace(/\.png$/i, '').toLowerCase();
  }
  function categoryOf(path) {
    var parts = path.split('/');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].toLowerCase() === 'textures') return (parts[i + 1] || 'other').toLowerCase();
    }
    return 'other';
  }
  function labelForCategory(cat) {
    if (CATEGORY_LABELS[cat]) return CATEGORY_LABELS[cat];
    return cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
  }
  function isJunk(name) {
    return /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name);
  }
  function hasFiles(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
  }
  function isTextureDrag(e) {
    if (dragName) return true;
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.prototype.indexOf.call(e.dataTransfer.types, 'application/x-packsmith') !== -1;
  }
  function nextFrame() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

  var state = {
    packs: [],
    baseId: null,
    overrides: new Map(),
    catalog: new Map(),
    categories: [],
    view: [],
    shown: 0,
    search: '',
    category: 'all',
    quick: null,
    onlySwapped: false,
    palettePackId: null,
    paletteSearch: '',
    paletteCategory: 'all',
    paletteFiltered: [],
    selected: new Set(),
    selectedPackId: null,
    exportName: 'Merged Pack'
  };

  var thumbCache = new Map();
  var dragName = null;
  var saveTimer = null;
  var storageWarned = false;
  var dbPromise = null;
  var sessionReady = false;

  /* ------------------------------------------------------------------ *
   * local storage (IndexedDB) - packs and swaps survive a refresh
   * ------------------------------------------------------------------ */

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      var request;
      try {
        request = indexedDB.open('packsmith', 1);
      } catch (err) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'key' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function warnStorage() {
    if (storageWarned) return;
    storageWarned = true;
    toast('Could not save locally - this browser blocked or ran out of storage', 'error');
  }

  function dbRequest(mode, storeName, action, fallback) {
    return openDb().then(function (db) {
      if (!db) return fallback === undefined ? null : fallback;
      return new Promise(function (resolve) {
        var settled = false;
        function finish(value) {
          if (settled) return;
          settled = true;
          resolve(value);
        }
        try {
          var tx = db.transaction(storeName, mode);
          var request = action(tx.objectStore(storeName));
          tx.oncomplete = function () { finish(request.result); };
          tx.onabort = tx.onerror = function () {
            if (mode !== 'readonly') warnStorage();
            finish(fallback === undefined ? null : fallback);
          };
        } catch (err) {
          if (mode !== 'readonly') warnStorage();
          finish(fallback === undefined ? null : fallback);
        }
      });
    });
  }

  function dbPut(storeName, value) {
    return dbRequest('readwrite', storeName, function (store) { return store.put(value); });
  }

  function dbDelete(storeName, key) {
    return dbRequest('readwrite', storeName, function (store) { return store.delete(key); });
  }

  function dbGet(storeName, key) {
    return dbRequest('readonly', storeName, function (store) { return store.get(key); });
  }

  function dbGetAll(storeName) {
    return dbRequest('readonly', storeName, function (store) { return store.getAll(); }, []);
  }

  function savePack(pack) {
    if (!pack.buffer) return;
    dbPut('packs', {
      id: pack.id,
      name: pack.name,
      bytes: pack.bytes,
      color: pack.color,
      addedAt: pack.addedAt,
      data: pack.buffer
    });
  }

  function writeSession() {
    clearTimeout(saveTimer);
    if (!sessionReady) return;
    dbPut('session', { key: 'baseId', value: state.baseId });
    dbPut('session', { key: 'palettePackId', value: state.palettePackId });
    dbPut('session', { key: 'overrides', value: Array.from(state.overrides.entries()) });
  }

  function saveSession() {
    clearTimeout(saveTimer);
    if (!sessionReady) return;
    saveTimer = setTimeout(writeSession, 150);
  }

  var els = {
    packInput: $('#packInput'),
    importBtn: $('#importBtn'),
    exportBtn: $('#exportBtn'),
    packCount: $('#packCount'),
    packList: $('#packList'),
    itemSearch: $('#itemSearch'),
    itemCount: $('#itemCount'),
    categoryChips: $('#categoryChips'),
    quickLine: $('#quickLine'),
    quickChips: $('#quickChips'),
    onlyChanged: $('#onlyChanged'),
    resetSwaps: $('#resetSwaps'),
    itemGrid: $('#itemGrid'),
    gridEmpty: $('#gridEmpty'),
    emptyStart: $('#emptyStart'),
    emptyNoMatch: $('#emptyNoMatch'),
    emptyNoMatchText: $('#emptyNoMatchText'),
    emptyImport: $('#emptyImport'),
    sourceTabs: $('#sourceTabs'),
    paletteSearch: $('#paletteSearch'),
    paletteCategory: $('#paletteCategory'),
    paletteGrid: $('#paletteGrid'),
    paletteTotal: $('#paletteTotal'),
    selectionInfo: $('#selectionInfo'),
    clearSelection: $('#clearSelection'),
    selectAll: $('#selectAll'),
    applyMatches: $('#applyMatches'),
    dropOverlay: $('#dropOverlay'),
    exportModal: $('#exportModal'),
    exBase: $('#exBase'),
    exName: $('#exName'),
    exFormat: $('#exFormat'),
    exStats: $('#exStats'),
    exGo: $('#exGo'),
    busy: $('#busy'),
    busyLabel: $('#busyLabel'),
    busyBar: $('#busyBar'),
    toasts: $('#toasts')
  };

  /* ------------------------------------------------------------------ *
   * misc ui
   * ------------------------------------------------------------------ */

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' toast-error' : kind === 'ok' ? ' toast-ok' : '');
    el.textContent = message;
    els.toasts.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 320);
    }, 4200);
  }

  function setBusy(on, label, pct) {
    els.busy.hidden = !on;
    if (label) els.busyLabel.textContent = label;
    if (on) {
      if (pct == null) {
        els.busyBar.classList.add('indet');
        els.busyBar.style.width = '';
      } else {
        els.busyBar.classList.remove('indet');
        els.busyBar.style.width = Math.max(2, Math.min(100, pct)) + '%';
      }
    } else {
      els.busyBar.classList.remove('indet');
      els.busyBar.style.width = '0';
    }
  }

  function basePack() {
    for (var i = 0; i < state.packs.length; i++) {
      if (state.packs[i].id === state.baseId) return state.packs[i];
    }
    return null;
  }

  function packById(id) {
    for (var i = 0; i < state.packs.length; i++) {
      if (state.packs[i].id === id) return state.packs[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * reading packs
   * ------------------------------------------------------------------ */

  function detectPrefix(names) {
    var counts = new Map();
    names.forEach(function (n) {
      var m = /^(.*?)assets\/[^/]+\/textures\//i.exec(n);
      if (!m) return;
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    });
    var best = '';
    var bestCount = 0;
    counts.forEach(function (count, prefix) {
      if (count > bestCount) { best = prefix; bestCount = count; }
    });
    return best;
  }

  async function addZip(zip, filename, bytes, options) {
    options = options || {};
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
    var prefix = detectPrefix(names);
    var textures = new Map();
    var metaByPng = new Map();
    var files = [];
    var mcmetaObj = null;
    var iconObj = null;

    names.forEach(function (full) {
      if (full.indexOf('__MACOSX/') === 0) return;
      if (prefix && full.indexOf(prefix) !== 0) return;
      var rel = prefix ? full.slice(prefix.length) : full;
      if (!rel || isJunk(rel)) return;
      files.push(rel);
      var rl = rel.toLowerCase();
      if (rl === 'pack.mcmeta') { mcmetaObj = zip.files[full]; return; }
      if (rl.slice(-11) === '.png.mcmeta') {
        metaByPng.set(rl.slice(0, -7), zip.files[full]);
        return;
      }
      if (rl === 'pack.png') { iconObj = zip.files[full]; return; }
      if (/^assets\/[^/]+\/textures\/.+\.png$/i.test(rel)) {
        textures.set(rl, { lower: rl, path: rel, file: zip.files[full], meta: false, metaFile: null });
      }
    });

    textures.forEach(function (tex, key) {
      var meta = metaByPng.get(key);
      if (meta) { tex.meta = true; tex.metaFile = meta; }
    });

    if (!textures.size) throw new Error('no assets/*/textures/*.png found');

    var format = null;
    if (mcmetaObj) {
      try {
        var parsed = JSON.parse(await mcmetaObj.async('string'));
        if (parsed && parsed.pack && Number.isFinite(parsed.pack.pack_format)) format = parsed.pack.pack_format;
      } catch (err) { /* broken mcmeta - keep going */ }
    }

    var iconUrl = null;
    if (iconObj) {
      try {
        var buf = await iconObj.async('uint8array');
        iconUrl = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
      } catch (err) { /* no pack icon */ }
    }

    var pack = {
      id: options.id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: options.name || String(filename || 'pack').replace(/\.zip$/i, ''),
      color: options.color || PACK_COLORS[state.packs.length % PACK_COLORS.length],
      zip: zip,
      prefix: prefix,
      files: files,
      textures: textures,
      format: format,
      iconUrl: iconUrl,
      bytes: bytes || 0,
      addedAt: options.addedAt || Date.now(),
      buffer: options.buffer || null
    };
    state.packs.push(pack);
    return pack;
  }

  async function importFiles(fileList) {
    var zips = Array.prototype.filter.call(fileList, function (file) {
      return /\.zip$/i.test(file.name) || file.type === 'application/zip';
    });
    if (!zips.length) {
      toast('Drop .zip texture packs only', 'error');
      return;
    }
    setBusy(true, 'Reading packs...');
    var loaded = 0;
    for (var i = 0; i < zips.length; i++) {
      var file = zips[i];
      setBusy(true, 'Reading ' + file.name + '...');
      try {
        var buffer = await file.arrayBuffer();
        var zip = await JSZip.loadAsync(buffer);
        var pack = await addZip(zip, file.name, file.size, { buffer: buffer });
        savePack(pack);
        loaded++;
      } catch (err) {
        console.error(err);
        toast(file.name + ': ' + (err && err.message ? err.message : 'could not read'), 'error');
      }
      await nextFrame();
    }
    setBusy(false);
    if (loaded) {
      afterPacksChanged();
      toast('Imported ' + loaded + ' pack' + (loaded === 1 ? '' : 's') + ' - filter, select textures, then swap them in', 'ok');
    }
  }

  async function restoreSession() {
    var db = await openDb();
    var records = db ? await dbGetAll('packs') : [];
    if (records.length) setBusy(true, 'Loading saved packs...');
    try {
      records.sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        setBusy(true, 'Loading ' + (record.name || 'pack') + '...');
        try {
          var zip = await JSZip.loadAsync(record.data);
          await addZip(zip, record.name, record.bytes, {
            id: record.id,
            name: record.name,
            color: record.color,
            addedAt: record.addedAt,
            buffer: record.data
          });
        } catch (err) {
          console.error('Could not restore ' + (record.name || 'pack'), err);
          dbDelete('packs', record.id);
        }
        await nextFrame();
      }

      var savedBase = await dbGet('session', 'baseId');
      var savedPalette = await dbGet('session', 'palettePackId');
      var savedSwaps = await dbGet('session', 'overrides');
      if (savedBase && savedBase.value && packById(savedBase.value)) state.baseId = savedBase.value;
      if (savedPalette && savedPalette.value && packById(savedPalette.value)) state.palettePackId = savedPalette.value;
      if (savedSwaps && Array.isArray(savedSwaps.value)) {
        savedSwaps.value.forEach(function (pair) {
          if (!Array.isArray(pair) || pair.length !== 2) return;
          var override = pair[1];
          var pack = override && packById(override.packId);
          var tex = pack && pack.textures.get(override.lower);
          if (!tex) return;
          if (baseName(pair[0]) !== baseName(override.lower)) return;
          state.overrides.set(pair[0], { packId: override.packId, lower: override.lower });
        });
      }
    } catch (err) {
      console.error('Could not restore saved session', err);
    } finally {
      setBusy(false);
    }
    sessionReady = true;
    afterPacksChanged();
    if (state.packs.length) {
      toast('Restored ' + state.packs.length + ' pack' + (state.packs.length === 1 ? '' : 's') +
        ' and ' + state.overrides.size + ' swap' + (state.overrides.size === 1 ? '' : 's'), 'ok');
    }
  }

  /* ------------------------------------------------------------------ *
   * catalog
   * ------------------------------------------------------------------ */

  function rebuildCatalog() {
    var map = new Map();
    state.packs.forEach(function (pack) {
      pack.textures.forEach(function (tex, key) {
        if (!map.has(key)) {
          map.set(key, { lower: key, display: tex.path, category: categoryOf(tex.path), hay: '' });
        }
      });
    });

    var base = basePack();
    if (base) {
      map.forEach(function (entry) {
        var tex = base.textures.get(entry.lower);
        if (tex) {
          entry.display = tex.path;
          entry.category = categoryOf(tex.path);
        }
      });
    }
    map.forEach(function (entry) { entry.hay = ''; });
    state.catalog = map;

    var counts = new Map();
    map.forEach(function (entry) {
      counts.set(entry.category, (counts.get(entry.category) || 0) + 1);
    });
    var order = function (cat) {
      var i = CATEGORY_ORDER.indexOf(cat);
      return i === -1 ? 90 : i;
    };
    state.categories = Array.from(counts.entries()).sort(function (a, b) {
      return order(a[0]) - order(b[0]) || b[1] - a[1];
    });
    if (state.category !== 'all' && !counts.has(state.category)) state.category = 'all';
  }

  function afterPacksChanged() {
    if (!state.packs.length) {
      state.baseId = null;
      state.palettePackId = null;
    } else {
      if (!basePack()) state.baseId = state.packs[0].id;
      if (!packById(state.palettePackId)) {
        state.palettePackId = state.baseId;
        state.selected.clear();
        state.selectedPackId = null;
      }
    }
    if (!packById(state.selectedPackId)) {
      state.selected.clear();
      state.selectedPackId = null;
    }
    state.overrides.forEach(function (override, key) {
      if (!packById(override.packId)) state.overrides.delete(key);
    });
    rebuildCatalog();
    state.overrides.forEach(function (override, key) {
      if (!state.catalog.has(key)) state.overrides.delete(key);
    });
    renderPacks();
    renderSourceTabs();
    renderChips();
    renderQuickChips();
    renderPaletteCategories();
    renderPalette();
    renderGrid();
    updateToolbar();
    renderSelectionBar();
    saveSession();
  }

  function updateToolbar() {
    var swaps = state.overrides.size;
    els.resetSwaps.disabled = swaps === 0;
    els.resetSwaps.textContent = swaps ? 'Reset ' + swaps : 'Reset';
    els.exportBtn.disabled = !state.packs.length;
    els.exportBtn.textContent = swaps ? 'Export .zip (' + swaps + ')' : 'Export .zip';
    els.itemCount.textContent = state.view.length
      ? state.view.length + ' item' + (state.view.length === 1 ? '' : 's') + (swaps ? ' / ' + swaps + ' swapped' : '')
      : '';
  }

  /* ------------------------------------------------------------------ *
   * thumbnails
   * ------------------------------------------------------------------ */

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
  }

  function getThumb(pack, tex) {
    var key = pack.id + ':' + tex.lower;
    if (thumbCache.has(key)) return thumbCache.get(key);
    var job = (async function () {
      var buf = await tex.file.async('uint8array');
      var url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
      try {
        var img = await loadImage(url);
        if (img.naturalHeight > img.naturalWidth * 1.5) {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalWidth;
          canvas.getContext('2d').drawImage(img, 0, 0);
          var cropped = await canvasBlob(canvas);
          if (cropped) {
            URL.revokeObjectURL(url);
            url = URL.createObjectURL(cropped);
          }
        }
      } catch (err) { /* keep the original url */ }
      return url;
    })().catch(function () { return null; });
    thumbCache.set(key, job);
    return job;
  }

  function runLimited(items, limit, worker) {
    var index = 0;
    var workers = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) {
      workers.push((async function () {
        while (index < items.length) {
          var item = items[index++];
          try { await worker(item); } catch (err) { /* skip broken texture */ }
        }
      })());
    }
    return Promise.all(workers);
  }

  function paintThumbs(tiles) {
    var jobs = [];
    tiles.forEach(function (tile) {
      if (tile.dataset.painted) return;
      tile.dataset.painted = '1';
      var src = sourceFor(tile.dataset.path);
      var img = $('img', tile);
      if (!src || !img) { tile.classList.add('no-tex'); return; }
      jobs.push({ img: img, src: src });
    });
    runLimited(jobs, 8, async function (job) {
      var url = await getThumb(job.src.pack, job.src.tex);
      if (url && job.img.isConnected) job.img.src = url;
    });
  }

  /* ------------------------------------------------------------------ *
   * item grid
   * ------------------------------------------------------------------ */

  function sourceFor(pathLower) {
    var override = state.overrides.get(pathLower);
    if (override) {
      var pack = packById(override.packId);
      var tex = pack && pack.textures.get(override.lower);
      if (tex) return { pack: pack, tex: tex, swapped: true };
    }
    var base = basePack();
    if (base) {
      var baseTex = base.textures.get(pathLower);
      if (baseTex) return { pack: base, tex: baseTex, swapped: false };
    }
    for (var i = 0; i < state.packs.length; i++) {
      var other = state.packs[i].textures.get(pathLower);
      if (other) return { pack: state.packs[i], tex: other, swapped: false, extra: true };
    }
    return null;
  }

  function tileHTML(entry) {
    var src = sourceFor(entry.lower);
    var swapped = !!(src && src.swapped);
    var extra = !src || src.extra;
    var title = entry.display;
    if (swapped) title += ' - from ' + src.pack.name;
    if (extra) title += ' (not in the base pack - drop a texture here to include it)';
    title += ' - swaps need the same file name';
    return '<div class="tile' + (swapped ? ' is-swapped' : '') + (extra ? ' is-extra' : '') + '"' +
      ' data-path="' + esc(entry.lower) + '" title="' + esc(title) + '">' +
      '<div class="tile-thumb"><img data-pending alt="" draggable="false"></div>' +
      '<div class="tile-label">' + esc(pretty(entry.display)) + '</div>' +
      (swapped ? '<i class="tile-dot" style="--c:' + src.pack.color + '"></i>' +
        '<button class="tile-x" type="button" title="Revert to base">x</button>' : '') +
      (extra ? '<i class="tile-plus" title="Not in the base pack">+</i>' : '') +
      '</div>';
  }

  function computeView() {
    var tokens = state.search.toLowerCase().split(/\s+/).filter(Boolean);
    var quick = null;
    for (var q = 0; q < QUICK_FILTERS.length; q++) {
      if (QUICK_FILTERS[q].id === state.quick) quick = QUICK_FILTERS[q];
    }
    var out = [];
    state.catalog.forEach(function (entry) {
      if (state.category !== 'all' && entry.category !== state.category) return;
      if (quick && !quick.test(baseName(entry.display))) return;
      if (state.onlySwapped && !state.overrides.has(entry.lower)) return;
      if (tokens.length) {
        if (!entry.hay) {
          entry.hay = (entry.display.toLowerCase().replace(/\.png$/, '') + ' ' + entry.category)
            .replace(/[\/_]/g, ' ');
        }
        for (var i = 0; i < tokens.length; i++) {
          if (entry.hay.indexOf(tokens[i]) === -1) return;
        }
      }
      out.push(entry);
    });
    out.sort(function (a, b) { return a.display < b.display ? -1 : a.display > b.display ? 1 : 0; });
    return out;
  }

  function renderGrid(options) {
    options = options || {};
    var keepScroll = options.keepScroll && !!els.itemGrid.scrollTop;
    state.view = computeView();
    state.shown = 0;
    els.itemGrid.innerHTML = '';

    if (!state.view.length) {
      els.gridEmpty.hidden = false;
      els.emptyStart.hidden = state.packs.length > 0;
      els.emptyNoMatch.hidden = state.packs.length === 0;
      if (state.packs.length) {
        els.emptyNoMatchText.textContent = state.onlySwapped
          ? 'No swaps yet - pick a texture in the library and swap it into an item.'
          : 'No textures match these filters. Try another category, type or search.';
      }
      els.itemCount.textContent = '';
      return;
    }

    els.gridEmpty.hidden = true;
    appendPage();
    if (!keepScroll) els.itemGrid.scrollTop = 0;
    paintTargets();
  }

  function appendPage() {
    if (state.shown >= state.view.length) return;
    var end = Math.min(state.shown + PAGE, state.view.length);
    var html = state.view.slice(state.shown, end).map(tileHTML).join('');
    els.itemGrid.insertAdjacentHTML('beforeend', html);
    state.shown = end;
    paintThumbs($$('.tile:not([data-painted])', els.itemGrid));
    paintTargets();
  }

  function renderChips() {
    var chips = ['<button class="chip' + (state.category === 'all' ? ' is-on' : '') +
      '" data-cat="all">All<b>' + state.catalog.size + '</b></button>'];
    state.categories.forEach(function (pair) {
      chips.push('<button class="chip' + (state.category === pair[0] ? ' is-on' : '') +
        '" data-cat="' + esc(pair[0]) + '">' + esc(labelForCategory(pair[0])) + '<b>' + pair[1] + '</b></button>');
    });
    els.categoryChips.innerHTML = chips.join('');
  }

  function renderQuickChips() {
    var counts = new Map();
    state.catalog.forEach(function (entry) {
      if (state.category !== 'all' && entry.category !== state.category) return;
      var name = baseName(entry.display);
      for (var i = 0; i < QUICK_FILTERS.length; i++) {
        var filter = QUICK_FILTERS[i];
        if (filter.test(name)) counts.set(filter.id, (counts.get(filter.id) || 0) + 1);
      }
    });
    if (state.quick && !counts.get(state.quick)) state.quick = null;
    var html = QUICK_FILTERS.filter(function (filter) {
      return counts.get(filter.id);
    }).map(function (filter) {
      return '<button class="chip' + (state.quick === filter.id ? ' is-on' : '') +
        '" data-quick="' + filter.id + '">' + esc(filter.label) + '<b>' + counts.get(filter.id) + '</b></button>';
    });
    els.quickLine.hidden = html.length === 0;
    els.quickChips.innerHTML = html.join('');
  }

  function paintTargets() {
    var names = new Set();
    if (dragName) {
      names.add(dragName);
    } else {
      selectedTextures().forEach(function (tex) { names.add(baseName(tex.path)); });
    }
    $$('.tile', els.itemGrid).forEach(function (tile) {
      tile.classList.toggle('is-target', names.size > 0 && names.has(baseName(tile.dataset.path)));
    });
  }

  function refreshTile(pathLower) {
    var tile = $$('.tile', els.itemGrid).find(function (el) { return el.dataset.path === pathLower; });
    var entry = state.catalog.get(pathLower);
    if (!tile || !entry) return;
    var holder = document.createElement('div');
    holder.innerHTML = tileHTML(entry);
    var fresh = holder.firstElementChild;
    tile.replaceWith(fresh);
    paintThumbs([fresh]);
    paintTargets();
  }

  /* ------------------------------------------------------------------ *
   * swapping
   * ------------------------------------------------------------------ */

  function toggleOverride(targetPath, packId, texLower) {
    var base = basePack();
    var baseTex = base && base.textures.get(targetPath);
    if (baseTex && packId === base.id && texLower === targetPath) {
      state.overrides.delete(targetPath);
    } else {
      state.overrides.set(targetPath, { packId: packId, lower: texLower });
    }
    afterSwapChange(targetPath);
  }

  function setOverride(targetPath, packId, texLower) {
    var pack = packById(packId);
    var tex = pack && pack.textures.get(texLower);
    if (!tex) return false;
    if (baseName(targetPath) !== baseName(texLower)) {
      toast('Names must match: ' + baseName(targetPath) + '.png can only swap with another ' +
        baseName(targetPath) + '.png', 'error');
      return false;
    }
    toggleOverride(targetPath, packId, texLower);
    return true;
  }

  function applyToTile(targetPath) {
    var textures = selectedTextures();
    if (!textures.length) return false;
    var target = baseName(targetPath);
    var tex = textures.find(function (t) { return baseName(t.path) === target; });
    if (!tex) {
      toast('No selected texture is named ' + target + '.png - names must match', 'error');
      return false;
    }
    return setOverride(targetPath, state.selectedPackId, tex.lower);
  }

  function clearSwap(pathLower) {
    if (!state.overrides.delete(pathLower)) return;
    afterSwapChange(pathLower);
  }

  function afterSwapChange(pathLower) {
    if (state.onlySwapped) {
      renderGrid({ keepScroll: true });
      updateToolbar();
    } else {
      updateToolbar();
      refreshTile(pathLower);
    }
    renderSelectionBar();
    saveSession();
  }

  /* ------------------------------------------------------------------ *
   * packs panel
   * ------------------------------------------------------------------ */

  function renderPacks() {
    els.packCount.textContent = state.packs.length;
    if (!state.packs.length) {
      els.packList.innerHTML = '<li class="pack-empty">Nothing here yet. Import a pack to get started.</li>';
      return;
    }
    els.packList.innerHTML = state.packs.map(function (pack) {
      var classes = 'pack-row' + (pack.id === state.baseId ? ' is-base' : '') +
        (pack.id === state.palettePackId ? ' is-source' : '');
      return '<li class="' + classes + '" data-id="' + esc(pack.id) + '">' +
        '<button class="pack-thumb" type="button" data-act="base" title="Make this the base pack">' +
        (pack.iconUrl ? '<img src="' + esc(pack.iconUrl) + '" alt="" draggable="false">'
          : '<span class="swatch" style="--c:' + pack.color + '"></span>') +
        '<span class="base-tag">BASE</span></button>' +
        '<div class="pack-meta" data-act="browse" title="Browse this pack in the texture library">' +
        '<strong>' + esc(pack.name) + '</strong>' +
        '<span>' + pack.textures.size + ' textures / ' + fmtSize(pack.bytes) + '</span></div>' +
        '<button class="icon-btn" type="button" data-act="remove" title="Remove pack">x</button>' +
        '</li>';
    }).join('');
  }

  function removePack(id) {
    var index = -1;
    for (var i = 0; i < state.packs.length; i++) if (state.packs[i].id === id) index = i;
    if (index === -1) return;
    var pack = state.packs[index];
    if (pack.iconUrl) URL.revokeObjectURL(pack.iconUrl);
    dbDelete('packs', pack.id);
    state.packs.splice(index, 1);
    if (state.baseId === id) state.baseId = state.packs.length ? state.packs[0].id : null;
    if (state.palettePackId === id) {
      state.palettePackId = state.baseId;
      state.selected.clear();
      state.selectedPackId = null;
    }
    if (state.selectedPackId === id) {
      state.selected.clear();
      state.selectedPackId = null;
    }
    state.overrides.forEach(function (override, key) {
      if (!packById(override.packId)) state.overrides.delete(key);
    });
    afterPacksChanged();
    toast('Removed ' + pack.name);
  }

  /* ------------------------------------------------------------------ *
   * texture library
   * ------------------------------------------------------------------ */

  function renderSourceTabs() {
    els.sourceTabs.hidden = !state.packs.length;
    els.sourceTabs.innerHTML = state.packs.map(function (pack) {
      return '<button class="src-tab' + (pack.id === state.palettePackId ? ' is-active' : '') +
        '" type="button" data-id="' + esc(pack.id) + '" title="' + esc(pack.name) + '">' +
        '<i style="--c:' + pack.color + '"></i><span>' + esc(pack.name) + '</span></button>';
    }).join('');
  }

  function renderPaletteCategories() {
    var pack = packById(state.palettePackId) || state.packs[0];
    if (!pack) {
      els.paletteCategory.innerHTML = '<option value="all">All textures</option>';
      state.paletteCategory = 'all';
      return;
    }
    var counts = new Map();
    pack.textures.forEach(function (tex) {
      var cat = categoryOf(tex.path);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    var order = function (cat) {
      var i = CATEGORY_ORDER.indexOf(cat);
      return i === -1 ? 90 : i;
    };
    var entries = Array.from(counts.entries()).sort(function (a, b) {
      return order(a[0]) - order(b[0]) || b[1] - a[1];
    });
    els.paletteCategory.innerHTML = '<option value="all">All textures (' + pack.textures.size + ')</option>' +
      entries.map(function (pair) {
        return '<option value="' + esc(pair[0]) + '">' + esc(labelForCategory(pair[0])) + ' (' + pair[1] + ')</option>';
      }).join('');
    if (state.paletteCategory !== 'all' && !counts.has(state.paletteCategory)) state.paletteCategory = 'all';
    els.paletteCategory.value = state.paletteCategory;
  }

  function renderPalette() {
    var pack = packById(state.palettePackId) || state.packs[0];
    if (!pack) {
      state.paletteFiltered = [];
      state.palettePackId = null;
      els.paletteGrid.innerHTML = '<p class="p-note">Import a pack to browse its textures.</p>';
      els.paletteTotal.textContent = '';
      return;
    }
    state.palettePackId = pack.id;
    els.paletteTotal.textContent = pack.textures.size + ' textures';

    var list = Array.from(pack.textures.values());
    if (state.paletteCategory !== 'all') {
      list = list.filter(function (tex) { return categoryOf(tex.path) === state.paletteCategory; });
    }
    var query = state.paletteSearch.trim().toLowerCase();
    if (query) list = list.filter(function (tex) { return tex.path.toLowerCase().indexOf(query) !== -1; });
    list.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    state.paletteFiltered = list;

    if (!list.length) {
      els.paletteGrid.innerHTML = '<p class="p-note">No textures match. Try another category or search.</p>';
      renderSelectionBar();
      return;
    }

    var shown = list.slice(0, PALETTE_LIMIT);
    var selected = state.selectedPackId === pack.id ? state.selected : new Set();
    els.paletteGrid.innerHTML = shown.map(function (tex) {
      var on = selected.has(tex.lower);
      return '<div class="p-tile' + (on ? ' is-selected' : '') + '" draggable="true" tabindex="0"' +
        ' role="button" aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' data-path="' + esc(tex.lower) + '" title="' + esc(tex.path) + '">' +
        '<img data-pending alt="" draggable="false"></div>';
    }).join('') + (list.length > shown.length
      ? '<p class="p-note">+' + (list.length - shown.length) + ' more - narrow the category or search to see them</p>' : '');

    var tiles = $$('.p-tile', els.paletteGrid);
    var jobs = [];
    tiles.forEach(function (el, i) {
      if (shown[i]) jobs.push({ el: el, tex: shown[i] });
    });
    runLimited(jobs, 8, async function (job) {
      var url = await getThumb(pack, job.tex);
      var img = $('img', job.el);
      if (url && img && img.isConnected) img.src = url;
    });
    renderSelectionBar();
  }

  function selectedTextures() {
    var pack = packById(state.selectedPackId);
    if (!pack) return [];
    var out = [];
    state.selected.forEach(function (lower) {
      var tex = pack.textures.get(lower);
      if (tex) out.push(tex);
    });
    return out;
  }

  function renderSelectionBar() {
    var pack = packById(state.selectedPackId);
    var textures = selectedTextures();
    var count = textures.length;
    els.clearSelection.hidden = count === 0;
    els.selectAll.disabled = !state.paletteFiltered.length;

    if (!count) {
      els.selectionInfo.textContent = 'Click textures to select. Names must match to swap.';
      els.applyMatches.disabled = true;
      els.applyMatches.textContent = 'Swap matching';
      return;
    }

    var names = new Set();
    textures.forEach(function (tex) { names.add(baseName(tex.path)); });
    var matches = 0;
    state.catalog.forEach(function (entry) {
      if (names.has(baseName(entry.display))) matches++;
    });

    els.selectionInfo.innerHTML = '<b>' + count + '</b> selected from ' + esc(pack.name) + ' - ' +
      (matches ? matches + ' matching item' + (matches === 1 ? '' : 's') : 'no matching items');
    els.applyMatches.disabled = matches === 0;
    els.applyMatches.textContent = matches ? 'Swap ' + matches : 'Swap matching';
  }

  function paintPaletteSelection() {
    var pack = packById(state.palettePackId);
    $$('.p-tile', els.paletteGrid).forEach(function (el) {
      var on = !!(pack && state.selectedPackId === pack.id && state.selected.has(el.dataset.path));
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function afterSelectionChange() {
    paintPaletteSelection();
    renderSelectionBar();
    paintTargets();
  }

  function resetSelectionForPack() {
    state.selected.clear();
    state.selectedPackId = state.palettePackId;
  }

  function toggleSelection(lower) {
    if (state.selectedPackId !== state.palettePackId) {
      state.selected.clear();
      state.selectedPackId = state.palettePackId;
    }
    if (state.selected.has(lower)) state.selected.delete(lower);
    else state.selected.add(lower);
    afterSelectionChange();
  }

  function clearSelection() {
    state.selected.clear();
    afterSelectionChange();
  }

  function selectAllShown() {
    var pack = packById(state.palettePackId);
    if (!pack || !state.paletteFiltered.length) return;
    if (state.selectedPackId !== pack.id) {
      state.selected.clear();
      state.selectedPackId = pack.id;
    }
    state.paletteFiltered.forEach(function (tex) { state.selected.add(tex.lower); });
    afterSelectionChange();
  }

  function applySelectedToMatches() {
    var pack = packById(state.selectedPackId);
    var textures = selectedTextures();
    if (!pack || !textures.length) return;
    var byName = new Map();
    textures.forEach(function (tex) { byName.set(baseName(tex.path), tex); });

    var base = basePack();
    var applied = 0;
    state.catalog.forEach(function (entry) {
      var tex = byName.get(baseName(entry.display));
      if (!tex) return;
      var baseTex = base && base.textures.get(entry.lower);
      if (baseTex && pack.id === base.id && tex.lower === entry.lower) return;
      state.overrides.set(entry.lower, { packId: pack.id, lower: tex.lower });
      applied++;
    });

    if (!applied) {
      toast('Those textures are already coming from the base pack', 'ok');
      return;
    }
    renderGrid({ keepScroll: true });
    updateToolbar();
    paintTargets();
    renderSelectionBar();
    saveSession();
    toast('Swapped ' + applied + ' item' + (applied === 1 ? '' : 's') + ' from ' + pack.name, 'ok');
  }

  /* ------------------------------------------------------------------ *
   * export
   * ------------------------------------------------------------------ */

  function openExport() {
    var base = basePack();
    if (!base) return;
    els.exBase.textContent = base.name;
    els.exName.value = state.exportName;
    els.exFormat.value = base.format || 15;
    els.exStats.textContent = base.files.length + ' files in the base pack / ' +
      state.overrides.size + ' swapped textures / ' + state.catalog.size + ' items in the library';
    els.exportModal.hidden = false;
    els.exName.focus();
    els.exName.select();
  }

  function closeExport() {
    els.exportModal.hidden = true;
  }

  async function buildExport() {
    var base = basePack();
    if (!base) return;
    var name = (els.exName.value || 'Merged Pack').trim() || 'Merged Pack';
    var format = parseInt(els.exFormat.value, 10) || 15;
    state.exportName = name;
    closeExport();
    setBusy(true, 'Copying base pack...', 0);

    try {
      var out = new JSZip();
      var names = Object.keys(base.zip.files);
      var written = 0;
      for (var i = 0; i < names.length; i++) {
        var full = names[i];
        var entry = base.zip.files[full];
        if (entry.dir) continue;
        if (full.indexOf('__MACOSX/') === 0) continue;
        if (base.prefix && full.indexOf(base.prefix) !== 0) continue;
        var rel = base.prefix ? full.slice(base.prefix.length) : full;
        if (!rel || isJunk(rel) || rel.toLowerCase() === 'pack.mcmeta') continue;
        out.file(rel, await entry.async('uint8array'));
        written++;
        if (written % 150 === 0) {
          setBusy(true, 'Copying base pack... ' + written + ' files', null);
          await nextFrame();
        }
      }

      var swaps = 0;
      for (var pair of state.overrides) {
        var pathLower = pair[0];
        var override = pair[1];
        var srcPack = packById(override.packId);
        var srcTex = srcPack && srcPack.textures.get(override.lower);
        if (!srcTex) continue;
        if (baseName(override.lower) !== baseName(pathLower)) continue;
        var baseTex = base.textures.get(pathLower);
        var targetPath = baseTex ? baseTex.path : srcTex.path;
        out.file(targetPath, await srcTex.file.async('uint8array'));
        if (srcTex.meta && srcTex.metaFile) {
          out.file(targetPath + '.mcmeta', await srcTex.metaFile.async('uint8array'));
        } else {
          out.remove(targetPath + '.mcmeta');
        }
        swaps++;
        if (swaps % 25 === 0) {
          setBusy(true, 'Applying swapped textures... ' + swaps, null);
          await nextFrame();
        }
      }

      out.file('pack.mcmeta', JSON.stringify({
        pack: { pack_format: format, description: name }
      }, null, 2));

      setBusy(true, 'Compressing ' + written + ' files and ' + swaps + ' swaps...', 0);
      var blob = await out.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        function (meta) { setBusy(true, null, meta.percent); }
      );

      var fileName = (name.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-') || 'merged-pack') + '.zip';
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      var sources = new Set(Array.from(state.overrides.values()).map(function (o) { return o.packId; })).size;
      toast(swaps
        ? 'Saved ' + fileName + ' - ' + swaps + ' swapped textures from ' + sources +
          ' pack' + (sources === 1 ? '' : 's') + ' on top of ' + base.name
        : 'Saved ' + fileName + ' - a straight copy of ' + base.name, 'ok');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ *
   * events
   * ------------------------------------------------------------------ */

  els.importBtn.addEventListener('click', function () { els.packInput.click(); });
  els.emptyImport.addEventListener('click', function () { els.packInput.click(); });
  els.exportBtn.addEventListener('click', openExport);
  els.exGo.addEventListener('click', buildExport);
  els.packInput.addEventListener('change', function (event) {
    var files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) importFiles(files);
  });

  els.packList.addEventListener('click', function (event) {
    var row = event.target.closest('.pack-row');
    if (!row) return;
    var act = event.target.closest('[data-act]');
    var action = act ? act.dataset.act : 'browse';
    var id = row.dataset.id;
    if (action === 'remove') {
      removePack(id);
      return;
    }
    if (action === 'base') {
      if (state.baseId === id) return;
      state.baseId = id;
      rebuildCatalog();
      renderPacks();
      renderChips();
      renderQuickChips();
      renderGrid();
      updateToolbar();
      renderSelectionBar();
      saveSession();
      toast('Base pack: ' + (basePack() ? basePack().name : '-'), 'ok');
      return;
    }
    if (state.palettePackId !== id) {
      state.palettePackId = id;
      resetSelectionForPack();
    }
    renderPacks();
    renderSourceTabs();
    renderPaletteCategories();
    renderPalette();
    renderSelectionBar();
    paintTargets();
    saveSession();
  });

  els.sourceTabs.addEventListener('click', function (event) {
    var tab = event.target.closest('.src-tab');
    if (!tab) return;
    if (state.palettePackId === tab.dataset.id) return;
    state.palettePackId = tab.dataset.id;
    resetSelectionForPack();
    renderPacks();
    renderSourceTabs();
    renderPaletteCategories();
    renderPalette();
    renderSelectionBar();
    paintTargets();
    saveSession();
  });

  var paletteSearchTimer = null;
  els.paletteSearch.addEventListener('input', function () {
    state.paletteSearch = els.paletteSearch.value;
    clearTimeout(paletteSearchTimer);
    paletteSearchTimer = setTimeout(renderPalette, 120);
  });

  els.paletteCategory.addEventListener('change', function () {
    state.paletteCategory = els.paletteCategory.value;
    renderPalette();
  });

  var itemSearchTimer = null;
  els.itemSearch.addEventListener('input', function () {
    state.search = els.itemSearch.value;
    clearTimeout(itemSearchTimer);
    itemSearchTimer = setTimeout(function () {
      renderGrid();
      updateToolbar();
    }, 120);
  });

  els.categoryChips.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderChips();
    renderQuickChips();
    renderGrid();
    updateToolbar();
  });

  els.quickChips.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    state.quick = state.quick === chip.dataset.quick ? null : chip.dataset.quick;
    renderQuickChips();
    renderGrid();
    updateToolbar();
  });

  els.onlyChanged.addEventListener('change', function () {
    state.onlySwapped = els.onlyChanged.checked;
    renderGrid();
    updateToolbar();
  });

  els.resetSwaps.addEventListener('click', function () {
    if (!state.overrides.size) return;
    state.overrides.clear();
    renderGrid({ keepScroll: true });
    updateToolbar();
    renderSelectionBar();
    saveSession();
    toast('All swaps reverted to the base pack');
  });

  els.itemGrid.addEventListener('scroll', function () {
    if (els.itemGrid.scrollTop + els.itemGrid.clientHeight > els.itemGrid.scrollHeight - 600) appendPage();
  });

  els.itemGrid.addEventListener('click', function (event) {
    var tile = event.target.closest('.tile');
    if (!tile) return;
    if (event.target.closest('.tile-x')) {
      clearSwap(tile.dataset.path);
      return;
    }
    if (state.selected.size) {
      applyToTile(tile.dataset.path);
      return;
    }
    var src = sourceFor(tile.dataset.path);
    if (src && src.swapped) {
      toast(pretty(tile.dataset.path) + ' is from ' + src.pack.name + ' - double-click to revert');
    } else {
      toast('Select a texture in the library first - names must match to swap');
    }
  });

  els.itemGrid.addEventListener('dblclick', function (event) {
    var tile = event.target.closest('.tile');
    if (tile) clearSwap(tile.dataset.path);
  });

  els.paletteGrid.addEventListener('click', function (event) {
    var tile = event.target.closest('.p-tile');
    if (!tile) return;
    toggleSelection(tile.dataset.path);
  });

  els.paletteGrid.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var tile = event.target.closest('.p-tile');
    if (!tile) return;
    event.preventDefault();
    toggleSelection(tile.dataset.path);
  });

  els.clearSelection.addEventListener('click', clearSelection);
  els.selectAll.addEventListener('click', selectAllShown);
  els.applyMatches.addEventListener('click', applySelectedToMatches);

  els.paletteGrid.addEventListener('dragstart', function (event) {
    var tile = event.target.closest('.p-tile');
    if (!tile || !state.palettePackId) return;
    event.dataTransfer.setData('application/x-packsmith', JSON.stringify({
      packId: state.palettePackId,
      lower: tile.dataset.path
    }));
    event.dataTransfer.setData('text/plain', tile.title);
    event.dataTransfer.effectAllowed = 'copy';
    tile.classList.add('dragging');
    dragName = baseName(tile.dataset.path);
    document.body.classList.add('tex-drag');
    dragDepth = 0;
    els.dropOverlay.hidden = true;
    paintTargets();
  });

  els.paletteGrid.addEventListener('dragend', function () {
    dragName = null;
    document.body.classList.remove('tex-drag');
    $$('.p-tile.dragging').forEach(function (el) { el.classList.remove('dragging'); });
    $$('.tile.drop-hover, .tile.drop-bad').forEach(function (el) {
      el.classList.remove('drop-hover', 'drop-bad');
    });
    paintTargets();
  });

  els.itemGrid.addEventListener('dragover', function (event) {
    if (!dragName) return;
    var tile = event.target.closest('.tile');
    if (!tile) return;
    var compatible = baseName(tile.dataset.path) === dragName;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = compatible ? 'copy' : 'none';
    if (tile.classList.contains('drop-hover') || tile.classList.contains('drop-bad')) return;
    $$('.tile.drop-hover, .tile.drop-bad', els.itemGrid).forEach(function (el) {
      el.classList.remove('drop-hover', 'drop-bad');
    });
    tile.classList.add(compatible ? 'drop-hover' : 'drop-bad');
  });

  els.itemGrid.addEventListener('dragleave', function (event) {
    var tile = event.target.closest('.tile');
    if (tile && !tile.contains(event.relatedTarget)) tile.classList.remove('drop-hover', 'drop-bad');
  });

  els.itemGrid.addEventListener('drop', function (event) {
    if (!dragName) return;
    var tile = event.target.closest('.tile');
    if (!tile) return;
    event.preventDefault();
    tile.classList.remove('drop-hover', 'drop-bad');
    var raw = event.dataTransfer.getData('application/x-packsmith');
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      setOverride(tile.dataset.path, data.packId, data.lower);
    } catch (err) { /* not our drag */ }
  });

  document.addEventListener('dragstart', function (event) {
    if (event.dataTransfer && event.dataTransfer.types &&
      Array.prototype.indexOf.call(event.dataTransfer.types, 'application/x-packsmith') !== -1) {
      document.body.classList.add('tex-drag');
    }
  });

  document.addEventListener('dragend', function () {
    dragName = null;
    document.body.classList.remove('tex-drag');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (!els.exportModal.hidden) { closeExport(); return; }
      if (state.selected.size) { clearSelection(); return; }
      if (state.quick || state.category !== 'all' || state.search) {
        state.search = '';
        els.itemSearch.value = '';
        state.category = 'all';
        state.quick = null;
        renderChips();
        renderQuickChips();
        renderGrid();
        updateToolbar();
      }
      return;
    }
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (event.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      event.preventDefault();
      els.itemSearch.focus();
      els.itemSearch.select();
    }
  });

  $$('[data-close]').forEach(function (el) { el.addEventListener('click', closeExport); });

  var dragDepth = 0;
  document.addEventListener('dragenter', function (event) {
    if (isTextureDrag(event)) return;
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    els.dropOverlay.hidden = false;
  });
  document.addEventListener('dragover', function (event) {
    if (isTextureDrag(event)) { event.preventDefault(); return; }
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', function (event) {
    if (isTextureDrag(event)) return;
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropOverlay.hidden = true;
  });
  document.addEventListener('drop', function (event) {
    if (isTextureDrag(event)) {
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      event.preventDefault();
      return;
    }
    dragDepth = 0;
    els.dropOverlay.hidden = true;
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    event.preventDefault();
    var files = Array.from(event.dataTransfer.files);
    if (files.length) importFiles(files);
  });

  window.addEventListener('pagehide', function () { writeSession(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') writeSession();
  });

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */

  restoreSession();
})();
