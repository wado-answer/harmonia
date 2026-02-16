/**
 * 🎵 Harmonia Background Playback Module
 * バックグラウンド再生完全対応システム
 * 
 * 機能：
 * - MediaSession API統合
 * - オーディオフォーカス管理
 * - Persistent Notification
 * - Visibility API最適化
 * - BatteryManager API対応
 * - マルチプレイヤー対応
 */

export class BackgroundPlaybackManager {
    constructor(audioEngine, stateManager, uiManager) {
        this.audio = audioEngine;
        this.state = stateManager;
        this.ui = uiManager;
        
        // MediaSession
        this.mediaSessionInitialized = false;
        
        // Notification
        this.notificationPermission = 'default';
        this.persistentNotification = null;
        this.notificationUpdateInterval = null;
        
        // Audio Focus
        this.audioFocusContext = null;
        this.isDucking = false;
        this.duckingVolume = 0.3;
        
        // Visibility
        this.isVisible = true;
        this.pausedByVisibility = false;
        this.visualizerDisabledByVisibility = false;
        
        // Battery
        this.batteryManager = null;
        this.isLowBattery = false;
        self.cpuReducedMode = false;
        
        // マルチプレイヤー
        this.secondaryPlayer = null;
        this.crossfadeInProgress = false;
        
        // リモートコマンド
        this.remoteCommandHandlers = {};
    }

    async init() {
        console.log('🎵 Initializing Background Playback Manager...');
        
        try {
            // 権限要求
            await this.requestNotificationPermission();
            
            // MediaSession初期化
            try {
                this.initMediaSession();
            } catch (e) {
                console.warn('⚠️ MediaSession setup failed:', e);
            }
            
            // Visibility API
            try {
                this.setupVisibilityAPI();
            } catch (e) {
                console.warn('⚠️ Visibility API setup failed:', e);
            }
            
            // BatteryManager API
            try {
                this.setupBatteryAPI();
            } catch (e) {
                console.warn('⚠️ Battery API setup failed:', e);
            }
            
            // オーディオフォーカス管理
            try {
                this.setupAudioFocusManagement();
            } catch (e) {
                console.warn('⚠️ Audio focus setup failed:', e);
            }
            
            // キーボードメディアコントロール
            try {
                this.setupMediaKeyboardHandling();
            } catch (e) {
                console.warn('⚠️ Media keyboard handling failed:', e);
            }
            
            console.log('✅ Background Playback Manager initialized');
        } catch (error) {
            console.error('❌ Background Playback Manager init failed:', error);
            throw error;
        }
    }

    // ===== Notification Permission =====
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.warn('⚠️ Notifications are not supported in this browser');
            return;
        }
        
        if (Notification.permission === 'granted') {
            this.notificationPermission = 'granted';
        } else if (Notification.permission === 'denied') {
            this.notificationPermission = 'denied';
        } else if (Notification.permission === 'default') {
            try {
                const permission = await Notification.requestPermission();
                this.notificationPermission = permission;
            } catch (error) {
                console.error('Notification permission request failed:', error);
            }
        }
    }

    // ===== Media Session API =====
    initMediaSession() {
        if (!('mediaSession' in navigator)) {
            console.warn('⚠️ MediaSession API is not supported');
            return;
        }

        this.mediaSessionInitialized = true;

        // メタデータ更新
        this.state.subscribe('currentTrackIndex', (index) => {
            const track = this.state.get('tracks')[index];
            if (track) {
                this.updateMediaSessionMetadata(track);
            }
        });

        // 再生時間更新
        this.state.subscribe('currentTime', (time) => {
            this.updateMediaSessionPlaybackState();
        });

        // デフォルトアクションハンドラ
        this.setupMediaSessionActions();
    }

    updateMediaSessionMetadata(track) {
        if (!('mediaSession' in navigator) || !track) return;

        const artwork = track.artwork ? [
            { src: track.artwork, sizes: '96x96', type: 'image/jpeg' },
            { src: track.artwork, sizes: '128x128', type: 'image/jpeg' },
            { src: track.artwork, sizes: '192x192', type: 'image/jpeg' },
            { src: track.artwork, sizes: '256x256', type: 'image/jpeg' },
            { src: track.artwork, sizes: '384x384', type: 'image/jpeg' },
            { src: track.artwork, sizes: '512x512', type: 'image/jpeg' }
        ] : [];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || track.name,
            artist: track.artist || 'Unknown',
            album: track.album || 'Unknown Album',
            artwork: artwork
        });

        console.log('📱 MediaSession metadata updated:', track.title);
    }

    updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;

        const isPlaying = this.state.get('isPlaying');
        const currentTime = this.state.get('currentTime');
        const duration = this.state.get('duration');

        try {
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

            // PlaybackState Details（一部ブラウザのみサポート）
            if (navigator.mediaSession.playbackState) {
                navigator.mediaSession.playbackState = {
                    state: isPlaying ? 'playing' : 'paused',
                    position: currentTime,
                    duration: duration,
                    playbackRate: this.state.get('settings').playbackRate || 1
                };
            }
        } catch (error) {
            // PlaybackState Details非サポート
        }
    }

    setupMediaSessionActions() {
        if (!('mediaSession' in navigator)) return;

        const actions = [
            { action: 'play', handler: () => this.remotePlay() },
            { action: 'pause', handler: () => this.remotePause() },
            { action: 'toggleplay', handler: () => this.remoteTogglePlay() },
            { action: 'nexttrack', handler: () => this.remoteNextTrack() },
            { action: 'previoustrack', handler: () => this.remotePreviousTrack() },
            { action: 'seekbackward', handler: () => this.remoteSeekBackward() },
            { action: 'seekforward', handler: () => this.remoteSeekForward() },
            { action: 'seekto', handler: (details) => this.remoteSeekTo(details) },
            { action: 'stop', handler: () => this.remoteStop() }
        ];

        actions.forEach(({ action, handler }) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
                console.log(`✅ MediaSession action registered: ${action}`);
            } catch (error) {
                console.warn(`⚠️ MediaSession action not supported: ${action}`);
            }
        });
    }

    // リモートコマンドハンドラ
    async remotePlay() {
        const currentIndex = this.state.get('currentTrackIndex');
        if (currentIndex === -1 && this.state.get('tracks').length > 0) {
            // 再生開始
            document.dispatchEvent(new CustomEvent('harmonia:playTrack', { detail: 0 }));
        } else {
            document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
        }
    }

    async remotePause() {
        if (this.state.get('isPlaying')) {
            document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
        }
    }

    async remoteTogglePlay() {
        document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
    }

    async remoteNextTrack() {
        document.dispatchEvent(new CustomEvent('harmonia:nextTrack'));
    }

    async remotePreviousTrack() {
        document.dispatchEvent(new CustomEvent('harmonia:previousTrack'));
    }

    async remoteSeekBackward() {
        document.dispatchEvent(new CustomEvent('harmonia:seek', { detail: -10 }));
    }

    async remoteSeekForward() {
        document.dispatchEvent(new CustomEvent('harmonia:seek', { detail: 10 }));
    }

    async remoteSeekTo(details) {
        if (details.seekTime !== null) {
            document.dispatchEvent(new CustomEvent('harmonia:seekTo', { detail: details.seekTime }));
        }
    }

    async remoteStop() {
        document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
        this.audio.pause();
    }

    // ===== Visibility API =====
    setupVisibilityAPI() {
        document.addEventListener('visibilitychange', () => {
            this.isVisible = !document.hidden;
            
            if (!this.isVisible) {
                // 画面オフ時
                this.onVisibilityHidden();
            } else {
                // 画面オン時
                this.onVisibilityShown();
            }
        });
    }

    onVisibilityHidden() {
        console.log('📱 Screen hidden - optimizing for background');
        
        // ビジュアライザーを停止
        if (this.state.get('settings').visualizerEnabled) {
            this.visualizerDisabledByVisibility = true;
            document.dispatchEvent(new CustomEvent('harmonia:stopVisualizer'));
        }
        
        // CPU削減モードを有効化
        if (this.batteryManager && this.batteryManager.level < 0.2) {
            this.enableCPUReducedMode();
        }
        
        // Persistent Notificationを表示
        this.showPersistentNotification();
    }

    onVisibilityShown() {
        console.log('📱 Screen shown - resuming normal mode');
        
        // ビジュアライザーを再開
        if (this.visualizerDisabledByVisibility && this.state.get('settings').visualizerEnabled) {
            this.visualizerDisabledByVisibility = false;
            if (this.state.get('isPlaying')) {
                document.dispatchEvent(new CustomEvent('harmonia:startVisualizer'));
            }
        }
        
        // CPU削減モードを無効化
        if (this.cpuReducedMode) {
            this.disableCPUReducedMode();
        }
        
        // Notificationを削除
        this.hidePersistentNotification();
    }

    // ===== Persistent Notification =====
    async showPersistentNotification() {
        if (this.notificationPermission !== 'granted') {
            return;
        }

        const track = this.state.get('tracks')[this.state.get('currentTrackIndex')];
        if (!track) return;

        const isPlaying = this.state.get('isPlaying');
        
        try {
            const notification = new Notification(track.title || 'Now Playing', {
                icon: track.artwork || '/icon.png',
                badge: '/badge.png',
                tag: 'harmonia-player',
                requireInteraction: true,
                actions: [
                    { action: 'previous', title: '前へ', icon: '⏮' },
                    { action: 'play-pause', title: isPlaying ? '一時停止' : '再生', icon: isPlaying ? '⏸' : '▶' },
                    { action: 'next', title: '次へ', icon: '⏭' }
                ],
                body: `${track.artist || 'Unknown'} • ${this.formatTime(this.state.get('currentTime'))} / ${this.formatTime(this.state.get('duration'))}`,
                badge: track.artwork || undefined
            });

            // クリックイベント
            notification.onclick = () => {
                window.focus();
            };

            // アクションイベント
            notification.onaction = (event) => {
                if (event.action === 'previous') {
                    document.dispatchEvent(new CustomEvent('harmonia:previousTrack'));
                } else if (event.action === 'play-pause') {
                    document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
                } else if (event.action === 'next') {
                    document.dispatchEvent(new CustomEvent('harmonia:nextTrack'));
                }
            };

            this.persistentNotification = notification;

            // 定期的に更新
            this.notificationUpdateInterval = setInterval(() => {
                this.updatePersistentNotification();
            }, 1000);

            console.log('📬 Persistent notification shown');
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }

    async updatePersistentNotification() {
        if (!this.persistentNotification) return;

        const track = this.state.get('tracks')[this.state.get('currentTrackIndex')];
        if (!track) return;

        const isPlaying = this.state.get('isPlaying');
        
        try {
            // 新しい通知で置き換え
            this.persistentNotification.close();
            
            const notification = new Notification(track.title || 'Now Playing', {
                icon: track.artwork || '/icon.png',
                tag: 'harmonia-player',
                requireInteraction: true,
                actions: [
                    { action: 'previous', title: '前へ', icon: '⏮' },
                    { action: 'play-pause', title: isPlaying ? '一時停止' : '再生', icon: isPlaying ? '⏸' : '▶' },
                    { action: 'next', title: '次へ', icon: '⏭' }
                ],
                body: `${track.artist || 'Unknown'} • ${this.formatTime(this.state.get('currentTime'))} / ${this.formatTime(this.state.get('duration'))}`
            });

            notification.onaction = (event) => {
                if (event.action === 'previous') {
                    document.dispatchEvent(new CustomEvent('harmonia:previousTrack'));
                } else if (event.action === 'play-pause') {
                    document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
                } else if (event.action === 'next') {
                    document.dispatchEvent(new CustomEvent('harmonia:nextTrack'));
                }
            };

            this.persistentNotification = notification;
        } catch (error) {
            console.error('Failed to update notification:', error);
        }
    }

    hidePersistentNotification() {
        if (this.persistentNotification) {
            this.persistentNotification.close();
            this.persistentNotification = null;
        }
        
        if (this.notificationUpdateInterval) {
            clearInterval(this.notificationUpdateInterval);
            this.notificationUpdateInterval = null;
        }
    }

    // ===== Audio Focus Management =====
    setupAudioFocusManagement() {
        // 他のタブがオーディオを再生している可能性を検出
        document.addEventListener('auxclick', (e) => {
            if (e.button === 1) { // 中央クリック
                // 再生制御の可能性
            }
        });

        // Safari iOS: ページが非アクティブになった時は自動一時停止
        window.addEventListener('blur', () => {
            if (this.state.get('settings').pauseOnBlur) {
                if (this.state.get('isPlaying')) {
                    this.pausedByFocus = true;
                    document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
                }
            }
        });

        window.addEventListener('focus', () => {
            if (this.pausedByFocus) {
                this.pausedByFocus = false;
                document.dispatchEvent(new CustomEvent('harmonia:togglePlay'));
            }
        });
    }

    // オーディオダッキング（他のアプリが通知音を再生時に音量低下）
    applyAudioDucking() {
        const currentVolume = this.state.get('volume');
        this.isDucking = true;
        this.state.setState({ volume: currentVolume * this.duckingVolume });
    }

    removeAudioDucking() {
        if (!this.isDucking) return;
        const duckingVolume = this.state.get('volume');
        const originalVolume = duckingVolume / this.duckingVolume;
        this.state.setState({ volume: originalVolume });
        this.isDucking = false;
    }

    // ===== Battery Manager API =====
    setupBatteryAPI() {
        if (!('getBattery' in navigator)) {
            console.warn('⚠️ BatteryManager API is not supported');
            return;
        }

        navigator.getBattery?.().then((batteryManager) => {
            this.batteryManager = batteryManager;

            batteryManager.addEventListener('levelchange', () => {
                this.onBatteryLevelChange();
            });

            batteryManager.addEventListener('chargingchange', () => {
                this.onBatteryChargingChange();
            });

            this.onBatteryLevelChange();
        }).catch(error => {
            console.warn('BatteryManager API error:', error);
        });
    }

    onBatteryLevelChange() {
        if (!this.batteryManager) return;

        const level = this.batteryManager.level;
        this.isLowBattery = level < 0.2;

        if (this.isLowBattery && !document.hidden) {
            console.warn('⚠️ Low battery detected - enabling CPU reduced mode');
            this.enableCPUReducedMode();
            this.ui.showNotification('低バッテリー：CPU削減モードを有効化しました', 'warning');
        } else if (!this.isLowBattery && this.cpuReducedMode && !document.hidden) {
            this.disableCPUReducedMode();
        }
    }

    onBatteryChargingChange() {
        if (!this.batteryManager) return;

        const isCharging = this.batteryManager.charging;
        if (isCharging && this.cpuReducedMode) {
            this.disableCPUReducedMode();
        }
    }

    enableCPUReducedMode() {
        this.cpuReducedMode = true;
        
        // ビジュアライザーの更新レート削減
        document.dispatchEvent(new CustomEvent('harmonia:setCPUReducedMode', { detail: true }));
        
        console.log('⚡ CPU Reduced Mode enabled');
    }

    disableCPUReducedMode() {
        this.cpuReducedMode = false;
        
        // ビジュアライザーの更新レート復帰
        document.dispatchEvent(new CustomEvent('harmonia:setCPUReducedMode', { detail: false }));
        
        console.log('⚡ CPU Reduced Mode disabled');
    }

    // ===== Media Keyboard Handling =====
    setupMediaKeyboardHandling() {
        document.addEventListener('keydown', (event) => {
            // メディアキーのチェック（キーコード）
            switch (event.code) {
                case 'MediaPlayPause': // F8 等
                    event.preventDefault();
                    this.remoteTogglePlay();
                    break;
                case 'MediaPlay':
                    event.preventDefault();
                    this.remotePlay();
                    break;
                case 'MediaPause':
                    event.preventDefault();
                    this.remotePause();
                    break;
                case 'MediaNextTrack':
                    event.preventDefault();
                    this.remoteNextTrack();
                    break;
                case 'MediaPreviousTrack':
                    event.preventDefault();
                    this.remotePreviousTrack();
                    break;
                case 'MediaStop':
                    event.preventDefault();
                    this.remoteStop();
                    break;
            }
        });
    }

    // ===== Dual Player (マルチプレイヤー) =====
    async initSecondaryPlayer() {
        const audioElement = document.createElement('audio');
        audioElement.id = 'secondaryAudioElement';
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
        
        this.secondaryPlayer = audioElement;
        console.log('🎵 Secondary audio player initialized for crossfade');
    }

    async crossfadeToTrack(nextTrackUrl, duration = 2) {
        if (!this.secondaryPlayer) {
            await this.initSecondaryPlayer();
        }

        if (this.crossfadeInProgress) return;
        this.crossfadeInProgress = true;

        const startVolume = this.state.get('volume');
        const steps = 20;
        const stepDuration = (duration * 1000) / steps;

        try {
            // セカンダリプレイヤーに次のトラックを設定
            this.secondaryPlayer.src = nextTrackUrl;
            this.secondaryPlayer.volume = 0;
            await this.secondaryPlayer.play();

            // フェード処理
            for (let i = 0; i <= steps; i++) {
                const primaryVolume = startVolume * (1 - i / steps);
                const secondaryVolume = startVolume * (i / steps);

                this.audio.audioElement.volume = primaryVolume;
                this.secondaryPlayer.volume = secondaryVolume;

                await new Promise(resolve => setTimeout(resolve, stepDuration));
            }

            // プレイヤーを入れ替え
            this.audio.audioElement.pause();
            this.audio.audioElement.src = nextTrackUrl;
            
            this.secondaryPlayer.pause();
            this.secondaryPlayer.volume = 0;

            // 音量を復帰
            this.audio.audioElement.volume = startVolume;

            console.log('✅ Crossfade completed');
        } catch (error) {
            console.error('Crossfade error:', error);
        } finally {
            this.crossfadeInProgress = false;
        }
    }

    // ===== Wakeful Playback (スクリーン点灯継続) =====
    async requestWakeLock() {
        if (!('wakeLock' in navigator)) {
            console.warn('⚠️ WakeLock API is not supported');
            return;
        }

        try {
            const wakeLock = await navigator.wakeLock.request('screen');
            console.log('💡 Wake lock acquired');

            // ページが非表示になったときにロックを解放
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    wakeLock.release();
                    console.log('💡 Wake lock released');
                }
            });

            return wakeLock;
        } catch (error) {
            console.error('Failed to acquire wake lock:', error);
        }
    }

    // ===== Utility Methods =====
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    destroy() {
        console.log('🧹 Cleaning up Background Playback Manager...');
        
        if (this.notificationUpdateInterval) {
            clearInterval(this.notificationUpdateInterval);
        }
        
        this.hidePersistentNotification();
        
        if (this.secondaryPlayer) {
            this.secondaryPlayer.pause();
            this.secondaryPlayer.remove();
        }
        
        console.log('✅ Background Playback Manager cleaned up');
    }
}

export const createBackgroundPlaybackManager = (audioEngine, stateManager, uiManager) => 
    new BackgroundPlaybackManager(audioEngine, stateManager, uiManager);
