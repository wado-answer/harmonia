// データベース管理モジュール
export class DBManager {
    constructor() {
        this.dbName = 'HarmoniaDB';
        this.version = 5; // バージョンアップ
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            let settled = false;

            const cleanup = () => {
                request.onerror = null;
                request.onsuccess = null;
                request.onupgradeneeded = null;
                request.onblocked = null;
                if (timeoutId) clearTimeout(timeoutId);
            };

            request.onerror = () => {
                if (settled) return;
                settled = true;
                const error = new Error('Failed to open database');
                error.originalError = request.error;
                cleanup();
                reject(error);
            };

            request.onblocked = () => {
                if (settled) return;
                settled = true;
                const error = new Error('Database open blocked by another connection');
                cleanup();
                reject(error);
            };

            request.onsuccess = () => {
                if (settled) return;
                settled = true;
                this.db = request.result;

                // 他タブなどでバージョン変更が発生したら安全に閉じる
                try {
                    this.db.onversionchange = () => {
                        console.warn('IndexedDB version change detected. Closing DB connection.');
                        try {
                            this.db.close();
                        } catch (e) {
                            console.warn('Error closing DB on versionchange:', e);
                        }
                        this.db = null;
                    };
                } catch (e) {
                    // 一部ブラウザでは設定不可
                }

                console.log('✅ Database initialized');
                cleanup();
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // オブジェクトストアを作成（まだ存在しない場合）
                this._createStoreIfNotExists(db, 'tracks', { keyPath: 'id' });
                this._createStoreIfNotExists(db, 'playlists', { keyPath: 'id' });
                this._createStoreIfNotExists(db, 'settings', { keyPath: 'key' });
                this._createStoreIfNotExists(db, 'favorites', { keyPath: 'trackId' });
                this._createStoreIfNotExists(db, 'audioFiles', { keyPath: 'id' });
                this._createStoreIfNotExists(db, 'queue', { keyPath: 'id', autoIncrement: true });
                this._createStoreIfNotExists(db, 'lyrics', { keyPath: 'trackId' });
                this._createStoreIfNotExists(db, 'bookmarks', { keyPath: 'id', autoIncrement: true });
                this._createStoreIfNotExists(db, 'playHistory', { keyPath: 'id', autoIncrement: true });
            };

            // タイムアウト（稀に open がハングするケースに備える）
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                const error = new Error('Database open timed out');
                cleanup();
                try { request.result && request.result.close && request.result.close(); } catch (e) {}
                reject(error);
            }, 15000);
        });
    }

    _createStoreIfNotExists(db, storeName, options) {
        if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, options);
            console.log(`📦 Created object store: ${storeName}`);
        }
    }

    async ensureConnection() {
        // 🔴 バグ修正: データベースが予期せずクローズされた場合に対応
        if (!this.db || !this.db.objectStoreNames) {
            console.warn('Database connection lost, attempting to reconnect...');
            await this.init();
        }
    }

    // 🔴 バグ修正: データベース容量を監視
    async checkDatabaseSize() {
        if (!navigator.storage || !navigator.storage.estimate) {
            return null;
        }
        
        try {
            const estimate = await navigator.storage.estimate();
            const percentUsed = (estimate.usage / estimate.quota) * 100;
            
            if (percentUsed > 90) {
                console.warn(`⚠️ Database storage is ${percentUsed.toFixed(1)}% full`);
            }
            
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentUsed: percentUsed
            };
        } catch (error) {
            console.error('Failed to estimate storage:', error);
            return null;
        }
    }

    async save(storeName, data) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                
                // 🔴 バグ修正: トランザクションエラーハンドリング
                transaction.onerror = () => {
                    reject(new Error(`Transaction failed: ${transaction.error?.message || 'Unknown error'}`));
                };
                
                transaction.oncomplete = () => {
                    resolve(request.result);
                };

                request.onerror = () => {
                    reject(new Error(`Request failed: ${request.error?.message || 'Unknown error'}`));
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async getAll(storeName) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                
                // 🔴 バグ修正: トランザクションエラーハンドリング
                transaction.onerror = () => {
                    reject(new Error(`Transaction failed: ${transaction.error?.message || 'Unknown error'}`));
                };

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => {
                    reject(new Error(`Request failed: ${request.error?.message || 'Unknown error'}`));
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async get(storeName, key) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                
                // 🔴 バグ修正: トランザクションエラーハンドリング
                transaction.onerror = () => {
                    reject(new Error(`Transaction failed: ${transaction.error?.message || 'Unknown error'}`));
                };

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    reject(new Error(`Request failed: ${request.error?.message || 'Unknown error'}`));
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async delete(storeName, key) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);

                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async clear(storeName) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();

                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async count(storeName) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.count();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    // バッチ保存（パフォーマンス最適化）
    async saveBatch(storeName, items) {
        await this.ensureConnection();
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                
                let completed = 0;
                const errors = [];

                items.forEach((item, index) => {
                    const request = store.put(item);
                    
                    request.onsuccess = () => {
                        completed++;
                        if (completed === items.length) {
                            resolve({ success: true, errors });
                        }
                    };
                    
                    request.onerror = () => {
                        errors.push({ index, error: request.error });
                        completed++;
                        if (completed === items.length) {
                            resolve({ success: errors.length === 0, errors });
                        }
                    };
                });

                transaction.onerror = () => reject(transaction.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    // データベースを完全にクリア（リセット用）
    async clearAll() {
        await this.ensureConnection();
        
        const storeNames = ['tracks', 'playlists', 'settings', 'favorites', 'audioFiles', 'queue', 'lyrics', 'bookmarks', 'playHistory'];
        const promises = storeNames.map(store => this.clear(store).catch(err => {
            console.error(`Failed to clear ${store}:`, err);
        }));
        
        await Promise.all(promises);
        console.log('🗑️ All data cleared');
    }

    // データベースサイズを取得（推定）
    async estimateSize() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentUsed: (estimate.usage / estimate.quota * 100).toFixed(2)
            };
        }
        return null;
    }
}

export const dbManager = new DBManager();
