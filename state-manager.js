// 状態管理モジュール - シングルトンパターンで実装
export class StateManager {
    constructor() {
        if (StateManager.instance) {
            return StateManager.instance;
        }

        this.state = {
            // トラック関連
            tracks: [],
            currentTrackIndex: -1,
            filteredTracks: [],
            
            // 再生状態
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            volume: 0.7,
            
            // プレイリスト＆お気に入り
            playlists: [],
            smartPlaylists: [], // 新規: スマートプレイリスト
            favorites: [], // Set ではなく Array を使用（JSON シリアライズ対応）
            
            // キュー
            queue: [],
            queueHistory: [],
            
            // 歌詞とブックマーク
            currentLyrics: null,
            currentLyricsData: null, // 新規: LRCパース済みデータ
            bookmarks: [],
            
            // 再生履歴と統計
            playHistory: [],
            statistics: {
                totalPlays: 0,
                totalListenTime: 0,
                mostPlayedTrack: null,
                lastWeekPlays: []
            },
            
            // クラウド連携
            cloudStatus: {
                'google-drive': false,
                'dropbox': false,
                'onedrive': false
            },
            
            // 設定
            settings: {
                // 基本設定
                theme: 'default',
                language: 'ja',
                
                // 再生設定
                volume: 0.7,
                playbackRate: 1.0,
                isShuffle: false,
                repeatMode: 'none', // 'none', 'all', 'one'
                crossfadeEnabled: false,
                crossfadeDuration: 3,
                gaplessEnabled: true,
                backgroundPlayEnabled: true,
                autoPlay: false,
                resumeOnStart: true,
                
                // ビジュアライザー設定
                visualizerEnabled: true,
                visualizerStyle: 'bars', // 'bars', 'circular', 'waveform', etc.
                visualizerColor: 'gradient',
                visualizerSensitivity: 1.0,
                visualizerSmoothing: 0.8,
                
                // イコライザー設定
                eqEnabled: false,
                eq10Band: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                eqPreset: 'flat',
                
                // エフェクト設定
                reverbEnabled: false,
                reverbMix: 0.3,
                reverbDecay: 2.0,
                delayEnabled: false,
                delayTime: 0.5,
                delayFeedback: 0.3,
                delayMix: 0.3,
                compressorEnabled: false,
                compressorThreshold: -24,
                compressorRatio: 12,
                stereoEnabled: false,
                stereoPan: 0,
                stereoWidth: 1.0,
                effectPreset: 'none',
                
                // 歌詞設定
                lyricsEnabled: true,
                lyricsAutoScroll: true,
                lyricsFontSize: 16,
                lyricsAlignment: 'center',
                lyricsShowTimestamps: false,
                
                // 通知設定
                notificationsEnabled: true,
                notificationDuration: 3000,
                showTrackChangeNotification: true,
                showPlaylistNotification: true,
                
                // UI設定
                showAlbumArt: true,
                showMiniPlayer: false,
                compactMode: false,
                showQueue: true,
                showLyrics: true,
                animationsEnabled: true,
                
                // プライバシー設定
                savePlayHistory: true,
                shareStatistics: false,
                
                // クラウド設定
                cloudProvider: null,
                autoBackup: false,
                autoBackupInterval: 7, // 日数
                
                // 高度な設定
                audioBufferSize: 2048,
                preloadNext: true,
                hardwareAcceleration: true,
                experimentalFeatures: false,
                
                // 🔋 省エネモード設定（新機能）
                powerSaveMode: false, // ON/OFF
                powerSaveProfile: 'balanced', // 'aggressive', 'balanced', 'none'
                reduceCPUWhenInactive: true, // 画面OFF時にCPU削減
                reduceVisualizerQuality: true, // 低品質ビジュアライザー
                singleThreadAudio: false, // シングルスレッド再生
                cpuUsageLimit: 50, // CPU使用率制限 (%)
            },
            
            // UI状態
            currentView: 'library',
            searchQuery: '',
            sidebarCollapsed: false,
            fullscreenMode: false,
            
            // その他
            sleepTimer: null,
            sleepTimerRemaining: 0,
            isLoading: false,
            errors: []
        };

        this.listeners = new Map();
        StateManager.instance = this;
    }

    // 状態の取得（イミュータブル）
    getState() {
        return Object.freeze({ ...this.state });
    }

    // 特定のキーの取得
    get(key) {
        return this.state[key];
    }

    // 状態の更新（イミュータブル）
    setState(updates) {
        const prevState = { ...this.state };
        
        // ネストされたオブジェクトの更新をサポート
        this.state = this._deepMerge(this.state, updates);
        
        // 変更されたキーを検出
        const changedKeys = this._getChangedKeys(prevState, this.state);
        
        // リスナーに通知
        changedKeys.forEach(key => {
            this._notify(key, this.state[key], prevState[key]);
        });
    }

    // トラック追加
    addTrack(track) {
        this.setState({
            tracks: [...this.state.tracks, track]
        });
    }

    // トラック削除
    removeTrack(trackId) {
        const track = this.state.tracks.find(t => t.id === trackId);
        
        // Blob URLを解放してメモリリークを防ぐ
        if (track && track.url && track.url.startsWith('blob:')) {
            URL.revokeObjectURL(track.url);
        }
        
        this.setState({
            tracks: this.state.tracks.filter(t => t.id !== trackId)
        });
    }

    // お気に入りトグル
    toggleFavorite(trackId) {
        const favorites = new Set(this.state.favorites);
        if (favorites.has(trackId)) {
            favorites.delete(trackId);
        } else {
            favorites.add(trackId);
        }
        this.setState({ favorites });
    }

    // キューに追加
    addToQueue(trackId) {
        if (!this.state.queue.includes(trackId)) {
            this.setState({
                queue: [...this.state.queue, trackId]
            });
        }
    }

    // 次に再生
    playNext(trackId) {
        const queue = [...this.state.queue];
        
        // キューの先頭に挿入（次に再生されるようにする）
        queue.unshift(trackId);
        
        this.setState({ queue });
    }

    // キューから削除
    removeFromQueue(index) {
        const queue = [...this.state.queue];
        queue.splice(index, 1);
        this.setState({ queue });
    }

    // キューをクリア
    clearQueue() {
        this.setState({ queue: [] });
    }

    // キューを並び替え
    reorderQueue(fromIndex, toIndex) {
        const queue = [...this.state.queue];
        const [removed] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, removed);
        this.setState({ queue });
    }

    // 設定更新
    updateSettings(settings) {
        this.setState({
            settings: { ...this.state.settings, ...settings }
        });
    }

    // 購読（状態変更を監視）
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        // 購読解除関数を返す
        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    // 通知
    _notify(key, newValue, oldValue) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newValue, oldValue);
                } catch (error) {
                    console.error(`Error in listener for ${key}:`, error);
                }
            });
        }

        // 'all'キーで全ての変更を監視可能
        const allCallbacks = this.listeners.get('all');
        if (allCallbacks) {
            allCallbacks.forEach(callback => {
                try {
                    callback(key, newValue, oldValue);
                } catch (error) {
                    console.error('Error in global listener:', error);
                }
            });
        }
    }

    // 深いマージ
    _deepMerge(target, source, seen = new WeakSet()) {
        const output = { ...target };
        
        Object.keys(source).forEach(key => {
            const value = source[key];
            
            // 🔴 バグ修正: 循環参照チェック
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    console.warn('Circular reference detected in deepMerge');
                    return;
                }
                seen.add(value);
            }
            
            // 🔴 バグ修正: 特殊オブジェクトの処理
            if (value instanceof Set || value instanceof Map) {
                output[key] = value;
            } else if (value instanceof Date) {
                output[key] = new Date(value);
            } else if (value instanceof RegExp) {
                output[key] = new RegExp(value);
            } else if (Array.isArray(value)) {
                output[key] = value;
            } else if (value && typeof value === 'object' && value.constructor === Object) {
                output[key] = this._deepMerge(target[key] || {}, value, seen);
            } else {
                output[key] = value;
            }
        });
        
        return output;
    }

    // 変更されたキーを検出
    _getChangedKeys(oldState, newState) {
        const changed = new Set();
        
        const allKeys = new Set([
            ...Object.keys(oldState),
            ...Object.keys(newState)
        ]);
        
        allKeys.forEach(key => {
            if (oldState[key] !== newState[key]) {
                changed.add(key);
            }
        });
        
        return changed;
    }

    // デバッグ用
    logState() {
        console.log('Current State:', this.state);
    }
}

// シングルトンインスタンスをエクスポート
export const stateManager = new StateManager();
