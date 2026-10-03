// ==========================================================================
// Offline Storage Engine (IndexedDB): 오프라인 저장 및 데이터 없는 재생 지원
// ==========================================================================

const DB_NAME = 'streamvance_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_tracks';

class OfflineStorage {
  constructor() {
    this.db = null;
    this.isReady = false;
    this.initPromise = this.initDB();
  }

  async initDB() {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      console.warn("IndexedDB is not supported in this browser.");
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('artist', 'artist', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.isReady = true;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error("IndexedDB open error:", e.target.error);
        reject(e.target.error);
      };
    });
  }

  async saveTrack(track) {
    if (!track) return false;
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const offlineItem = {
          id: track.id || `offline-${Date.now()}`,
          videoId: track.videoId || '',
          title: track.title || '알 수 없는 곡',
          artist: track.artist || '알 수 없는 아티스트',
          album: track.album || '오프라인 저장 앨범',
          duration: track.duration || 210,
          cover: track.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80',
          lyrics: Array.isArray(track.lyrics) ? track.lyrics : [],
          lyricsOffset: track.lyricsOffset || 0,
          genre: track.genre || 'pop',
          mood: track.mood || 'all',
          isOffline: true,
          savedAt: Date.now()
        };

        const req = store.put(offlineItem);
        req.onsuccess = () => resolve(offlineItem);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async getTracks() {
    await this.initPromise;
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async hasTrack(trackId) {
    if (!trackId) return false;
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(trackId);
        req.onsuccess = () => resolve(!!req.result);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async removeTrack(trackId) {
    if (!trackId) return false;
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(trackId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

export const offlineStorage = new OfflineStorage();
