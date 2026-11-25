/**
 * Storage Manager
 * Stores strictly anonymous numerical experiment trials and participant comfort ratings.
 * Uses IndexedDB as primary local storage with safe try/catch localStorage and in-memory
 * fallbacks (works cleanly even in restricted browser/iframe contexts).
 * Never stores video frames, images, or personal identifiers.
 */
const DB_NAME = 'HeadControlledPointerResearchDB';
const DB_VERSION = 1;
const STORE_TRIALS = 'trials';
const LS_KEY = 'hcp_experiment_trials_v1';

export class StorageManager {
  constructor() {
    this.db = null;
    this.memoryCache = [];
  }

  async init() {
    if (typeof indexedDB === 'undefined') {
      this._loadFromLocalStorage();
      return;
    }
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_TRIALS)) {
            db.createObjectStore(STORE_TRIALS, { keyPath: 'recordId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this.memoryCache = await this._readAllFromIDB();
    } catch (_err) {
      this.db = null;
      this._loadFromLocalStorage();
    }
  }

  async getAllTrials() {
    if (this.db) {
      try {
        this.memoryCache = await this._readAllFromIDB();
      } catch (_err) {
        // Fallback to in-memory cache
      }
    }
    return [...this.memoryCache];
  }

  async saveTrials(trials) {
    if (!Array.isArray(trials) || trials.length === 0) return;
    for (const t of trials) {
      if (!t.recordId) {
        t.recordId = `${t.participantId}_${t.condition}_${t.trialNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      }
      this.memoryCache.push(t);
    }

    if (this.db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction(STORE_TRIALS, 'readwrite');
          const store = tx.objectStore(STORE_TRIALS);
          for (const t of trials) {
            store.put(t);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (_err) {
        this._saveToLocalStorage();
      }
    } else {
      this._saveToLocalStorage();
    }
  }

  async clearAll() {
    this.memoryCache = [];
    if (this.db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction(STORE_TRIALS, 'readwrite');
          tx.objectStore(STORE_TRIALS).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (_err) {
        // Ignore IDB clear failure
      }
    }
    try {
      localStorage.removeItem(LS_KEY);
    } catch (_err) {
      // Ignore storage restriction
    }
  }

  _readAllFromIDB() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_TRIALS, 'readonly');
      const req = tx.objectStore(STORE_TRIALS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.memoryCache = parsed;
      }
    } catch (_err) {
      // Restricted storage; keep in-memory cache
    }
  }

  _saveToLocalStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.memoryCache));
    } catch (_err) {
      // Restricted storage; in-memory cache remains active
    }
  }
}
