import { PlayerProfile, Sponsor, LeaderboardEntry } from '../types';

const DB_NAME = 'zen_towers_db';
const DB_VERSION = 1;
const LOCAL_STORAGE_KEY = 'zen_towers_sponsored_v1';

export function generateSilentPlayerId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'ZT-';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const INITIAL_PROFILE: PlayerProfile = {
  playerId: generateSilentPlayerId(),
  nickname: '',
  xHandle: '',
  bestDailyHeight: 0,
  bestEndlessHeight: 0,
  streak: 0,
  lastCompletedDay: 0,
  theme: 'oak',
};

class GameDatabase {
  private dbPromise: Promise<IDBDatabase | null>;
  private memoryCache: {
    profile: PlayerProfile;
    blockSponsors: Sponsor[];
    skySponsors: Sponsor[];
    waterSponsors: Sponsor[];
    leaderboard: LeaderboardEntry[];
  };

  constructor() {
    this.memoryCache = this.loadFromLocalStorage();
    this.dbPromise = this.initIndexedDB();
  }

  private loadFromLocalStorage() {
    let profile = { ...INITIAL_PROFILE };
    let blockSponsors: Sponsor[] = [];
    let skySponsors: Sponsor[] = [];
    let waterSponsors: Sponsor[] = [];
    let leaderboard: LeaderboardEntry[] = [];

    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.playerId) {
          profile = {
            playerId: parsed.playerId,
            nickname: parsed.nickname || '',
            xHandle: parsed.xHandle || '',
            bestDailyHeight: parsed.bestDailyHeight || 0,
            bestEndlessHeight: parsed.bestEndlessHeight || 0,
            streak: parsed.streak || 0,
            lastCompletedDay: parsed.lastCompletedDay || 0,
            theme: parsed.theme || 'oak',
          };
        }
        if (Array.isArray(parsed.blockSponsors)) blockSponsors = parsed.blockSponsors;
        if (Array.isArray(parsed.skySponsors)) skySponsors = parsed.skySponsors;
        if (Array.isArray(parsed.waterSponsors)) waterSponsors = parsed.waterSponsors;
        if (Array.isArray(parsed.leaderboard)) leaderboard = parsed.leaderboard;

        // Fresh Start: Reset all old test sponsors to empty []
        if (!localStorage.getItem('zt_fresh_start_reset')) {
          blockSponsors = [];
          skySponsors = [];
          waterSponsors = [];
          localStorage.setItem('zt_fresh_start_reset', 'true');
        }
      } else {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
          ...profile,
          blockSponsors,
          skySponsors,
          waterSponsors,
          leaderboard,
        }));
      }
    } catch (err) {
      console.warn('LocalStorage not available, falling back to memory', err);
    }

    return { profile, blockSponsors, skySponsors, waterSponsors, leaderboard };
  }

  private syncToLocalStorage() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        ...this.memoryCache.profile,
        blockSponsors: this.memoryCache.blockSponsors,
        skySponsors: this.memoryCache.skySponsors,
        waterSponsors: this.memoryCache.waterSponsors,
        leaderboard: this.memoryCache.leaderboard,
      }));
    } catch (err) {
      console.warn('Failed to sync to LocalStorage', err);
    }
  }

  private async initIndexedDB(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null;
    }

    return new Promise((resolve) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sponsors_block')) {
          db.createObjectStore('sponsors_block', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sponsors_sky')) {
          db.createObjectStore('sponsors_sky', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('leaderboard')) {
          const lbStore = db.createObjectStore('leaderboard', { autoIncrement: true });
          lbStore.createIndex('mode', 'mode', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('IndexedDB failed to open, continuing with LocalStorage');
        resolve(null);
      };
    });
  }

  // Profile API
  public getProfile(): PlayerProfile {
    return { ...this.memoryCache.profile };
  }

  public async updateProfile(partial: Partial<PlayerProfile>): Promise<PlayerProfile> {
    this.memoryCache.profile = {
      ...this.memoryCache.profile,
      ...partial,
    };
    this.syncToLocalStorage();

    const db = await this.dbPromise;
    if (db) {
      try {
        const tx = db.transaction('profile', 'readwrite');
        tx.objectStore('profile').put({ id: 'current', ...this.memoryCache.profile });
      } catch (e) {
        console.warn('IndexedDB profile put failed', e);
      }
    }

    return { ...this.memoryCache.profile };
  }

  // Sponsors API
  public getBlockSponsors(): Sponsor[] {
    return [...this.memoryCache.blockSponsors].sort((a, b) => b.bid - a.bid);
  }

  public getSkySponsors(): Sponsor[] {
    return [...this.memoryCache.skySponsors].sort((a, b) => b.bid - a.bid);
  }

  public getWaterSponsors(): Sponsor[] {
    return [...this.memoryCache.waterSponsors].sort((a, b) => b.bid - a.bid);
  }

  public async addSponsorBid(slot: 'block' | 'sky' | 'water', bid: Omit<Sponsor, 'id'>): Promise<Sponsor> {
    const newSponsor: Sponsor = {
      ...bid,
      id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };

    if (slot === 'sky') {
      this.memoryCache.skySponsors.push(newSponsor);
      this.memoryCache.skySponsors.sort((a, b) => b.bid - a.bid);
    } else if (slot === 'water') {
      this.memoryCache.waterSponsors.push(newSponsor);
      this.memoryCache.waterSponsors.sort((a, b) => b.bid - a.bid);
    } else {
      this.memoryCache.blockSponsors.push(newSponsor);
      this.memoryCache.blockSponsors.sort((a, b) => b.bid - a.bid);
    }

    this.syncToLocalStorage();

    const db = await this.dbPromise;
    if (db) {
      try {
        const storeName = slot === 'sky' ? 'sponsors_sky' : slot === 'water' ? 'sponsors_water' : 'sponsors_block';
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(newSponsor);
      } catch (e) {
        console.warn('IndexedDB sponsor put failed', e);
      }
    }

    window.dispatchEvent(new CustomEvent('zt_sponsors_updated'));
    return newSponsor;
  }

  // Leaderboard API
  public getLeaderboard(mode: 'daily' | 'endless'): LeaderboardEntry[] {
    return this.memoryCache.leaderboard
      .filter((item) => item.mode === mode)
      .sort((a, b) => b.height - a.height || b.balanced - a.balanced);
  }

  public async postLeaderboardScore(entry: LeaderboardEntry): Promise<void> {
    const list = this.memoryCache.leaderboard;
    const existingIndex = list.findIndex(
      (item) => item.playerId === entry.playerId && item.mode === entry.mode
    );

    if (existingIndex >= 0) {
      if (entry.height >= list[existingIndex].height) {
        list[existingIndex] = entry;
      }
    } else {
      list.push(entry);
    }

    this.syncToLocalStorage();

    const db = await this.dbPromise;
    if (db) {
      try {
        const tx = db.transaction('leaderboard', 'readwrite');
        tx.objectStore('leaderboard').put(entry);
      } catch (e) {
        console.warn('IndexedDB leaderboard put failed', e);
      }
    }

    window.dispatchEvent(new CustomEvent('zt_leaderboard_updated'));
  }
}

export const db = new GameDatabase();
