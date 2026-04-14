// RepixBridge — Persistence layer (IndexedDB)
// Stores projects and snapshots so users can close the editor and come
// back later to continue editing. Also powers the rollback/history UI.
//
// Runs in content script context alongside editor.js. Exposed as
// `window.__rbPersist` so editor.js and mode-e.js can use it.

(function() {
  'use strict';
  if (window.__rbPersist) return window.__rbPersist;

  var DB_NAME = 'repix';
  var DB_VERSION = 1;
  var STORE_PROJECTS = 'projects';
  var STORE_SNAPSHOTS = 'snapshots';

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          var projectsStore = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
          projectsStore.createIndex('url', 'url', { unique: false });
          projectsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          var snapshotsStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
          snapshotsStore.createIndex('projectId', 'projectId', { unique: false });
          snapshotsStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
    return dbPromise;
  }

  // Generate a UUID-like id using crypto.randomUUID if available, fallback
  // to a timestamp + random suffix pattern.
  function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function tx(storeNames, mode, work) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var t = db.transaction(storeNames, mode);
        t.oncomplete = function() { resolve(result); };
        t.onerror = function() { reject(t.error); };
        t.onabort = function() { reject(t.error || new Error('tx aborted')); };
        var stores = {};
        (Array.isArray(storeNames) ? storeNames : [storeNames]).forEach(function(n) {
          stores[n] = t.objectStore(n);
        });
        var result;
        Promise.resolve(work(stores)).then(function(r) { result = r; }).catch(reject);
      });
    });
  }

  function reqToPromise(req) {
    return new Promise(function(resolve, reject) {
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  // ─── Projects API ──────────────────────────────────────────────────────

  // Create a new project from a Mode E chunking result.
  // result: {
  //   url, title, designMD, stitchedHTML, sourceScreenshot (base64 thumbnail),
  //   chunks: [{id, screenshot, html}]
  // }
  function createProject(result) {
    var projectId = genId();
    var now = Date.now();
    var project = {
      id: projectId,
      url: result.url || '',
      title: result.title || '',
      createdAt: now,
      updatedAt: now,
      designMD: (result.designMD || '').slice(0, 100000),
      sourceScreenshot: result.sourceScreenshot || '',
      thumbnailHTML: (result.stitchedHTML || '').slice(0, 500)
    };

    // First snapshot captures the raw chunking output so user can always
    // rollback to the initial clone.
    var initialSnapshot = {
      id: genId(),
      projectId: projectId,
      createdAt: now,
      label: 'Initial clone',
      isInitial: true,
      html: result.stitchedHTML || ''
    };

    return tx([STORE_PROJECTS, STORE_SNAPSHOTS], 'readwrite', function(stores) {
      return Promise.all([
        reqToPromise(stores[STORE_PROJECTS].put(project)),
        reqToPromise(stores[STORE_SNAPSHOTS].put(initialSnapshot))
      ]).then(function() { return { project: project, snapshot: initialSnapshot }; });
    });
  }

  function getProject(projectId) {
    return tx(STORE_PROJECTS, 'readonly', function(stores) {
      return reqToPromise(stores[STORE_PROJECTS].get(projectId));
    });
  }

  // Find a project by URL (for "you already cloned this site" detection).
  function findProjectByUrl(url) {
    return tx(STORE_PROJECTS, 'readonly', function(stores) {
      return new Promise(function(resolve, reject) {
        var req = stores[STORE_PROJECTS].index('url').get(url);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function listProjects(limit) {
    limit = limit || 50;
    return tx(STORE_PROJECTS, 'readonly', function(stores) {
      return new Promise(function(resolve, reject) {
        var results = [];
        var req = stores[STORE_PROJECTS].index('updatedAt').openCursor(null, 'prev');
        req.onsuccess = function(e) {
          var cursor = e.target.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function deleteProject(projectId) {
    return tx([STORE_PROJECTS, STORE_SNAPSHOTS], 'readwrite', function(stores) {
      var deletions = [reqToPromise(stores[STORE_PROJECTS].delete(projectId))];
      // Delete all snapshots belonging to this project
      return new Promise(function(resolve, reject) {
        var req = stores[STORE_SNAPSHOTS].index('projectId').openCursor(IDBKeyRange.only(projectId));
        req.onsuccess = function(e) {
          var cursor = e.target.result;
          if (cursor) {
            deletions.push(reqToPromise(cursor.delete()));
            cursor.continue();
          } else {
            Promise.all(deletions).then(resolve, reject);
          }
        };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function touchProject(projectId) {
    return tx(STORE_PROJECTS, 'readwrite', function(stores) {
      return reqToPromise(stores[STORE_PROJECTS].get(projectId)).then(function(p) {
        if (!p) return null;
        p.updatedAt = Date.now();
        return reqToPromise(stores[STORE_PROJECTS].put(p));
      });
    });
  }

  // ─── Snapshots API ─────────────────────────────────────────────────────

  // Save a new snapshot of the current edit state.
  // html: current stitched HTML (or whatever serializable state represents the edit).
  // opts.label: optional human label ("before color change", etc).
  // opts.auto: true if this is an auto-save (vs manual save).
  function saveSnapshot(projectId, html, opts) {
    opts = opts || {};
    var snapshot = {
      id: genId(),
      projectId: projectId,
      createdAt: Date.now(),
      label: opts.label || (opts.auto ? 'Auto-save' : 'Manual save'),
      isAuto: !!opts.auto,
      isInitial: false,
      html: html || ''
    };
    return tx([STORE_SNAPSHOTS, STORE_PROJECTS], 'readwrite', function(stores) {
      return Promise.all([
        reqToPromise(stores[STORE_SNAPSHOTS].put(snapshot)),
        reqToPromise(stores[STORE_PROJECTS].get(projectId)).then(function(p) {
          if (!p) return;
          p.updatedAt = snapshot.createdAt;
          return reqToPromise(stores[STORE_PROJECTS].put(p));
        })
      ]).then(function() { return snapshot; });
    });
  }

  // Get all snapshots for a project, newest first.
  function getSnapshots(projectId, limit) {
    limit = limit || 100;
    return tx(STORE_SNAPSHOTS, 'readonly', function(stores) {
      return new Promise(function(resolve, reject) {
        var results = [];
        var req = stores[STORE_SNAPSHOTS].index('projectId').openCursor(IDBKeyRange.only(projectId));
        req.onsuccess = function(e) {
          var cursor = e.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            results.sort(function(a, b) { return b.createdAt - a.createdAt; });
            resolve(results.slice(0, limit));
          }
        };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function getSnapshot(snapshotId) {
    return tx(STORE_SNAPSHOTS, 'readonly', function(stores) {
      return reqToPromise(stores[STORE_SNAPSHOTS].get(snapshotId));
    });
  }

  function deleteSnapshot(snapshotId) {
    return tx(STORE_SNAPSHOTS, 'readwrite', function(stores) {
      return reqToPromise(stores[STORE_SNAPSHOTS].delete(snapshotId));
    });
  }

  // Prune auto-save snapshots older than maxAgeMs or beyond maxCount.
  // Keeps the initial snapshot always. Called periodically to prevent
  // IndexedDB bloat from aggressive auto-save.
  function pruneAutoSnapshots(projectId, opts) {
    opts = opts || {};
    var maxCount = opts.maxCount || 50;
    var maxAgeMs = opts.maxAgeMs || (7 * 24 * 60 * 60 * 1000); // 7 days
    var cutoff = Date.now() - maxAgeMs;

    return getSnapshots(projectId, 1000).then(function(snaps) {
      var autoSnaps = snaps.filter(function(s) { return s.isAuto && !s.isInitial; });
      var toDelete = [];
      // Delete those older than cutoff
      autoSnaps.forEach(function(s) {
        if (s.createdAt < cutoff) toDelete.push(s.id);
      });
      // If still over maxCount, delete the oldest auto snapshots
      var survivors = autoSnaps.filter(function(s) { return toDelete.indexOf(s.id) === -1; });
      if (survivors.length > maxCount) {
        survivors.sort(function(a, b) { return a.createdAt - b.createdAt; });
        var excess = survivors.slice(0, survivors.length - maxCount);
        excess.forEach(function(s) { toDelete.push(s.id); });
      }
      return Promise.all(toDelete.map(deleteSnapshot));
    });
  }

  // ─── Storage estimation (for future UI: "you're using X of Y MB") ─────

  function estimateUsage() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve({ usage: 0, quota: 0, supported: false });
    }
    return navigator.storage.estimate().then(function(est) {
      return {
        usage: est.usage || 0,
        quota: est.quota || 0,
        supported: true
      };
    });
  }

  // ─── Export ────────────────────────────────────────────────────────────

  var api = {
    createProject: createProject,
    getProject: getProject,
    findProjectByUrl: findProjectByUrl,
    listProjects: listProjects,
    deleteProject: deleteProject,
    touchProject: touchProject,
    saveSnapshot: saveSnapshot,
    getSnapshots: getSnapshots,
    getSnapshot: getSnapshot,
    deleteSnapshot: deleteSnapshot,
    pruneAutoSnapshots: pruneAutoSnapshots,
    estimateUsage: estimateUsage,
    // Constants for test/debug
    _DB_NAME: DB_NAME,
    _STORE_PROJECTS: STORE_PROJECTS,
    _STORE_SNAPSHOTS: STORE_SNAPSHOTS
  };

  window.__rbPersist = api;
  return api;
})();
