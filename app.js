// クラスの終わりは既存の destroy() を使用します。
// （重複していたクリーンアップは既存の `destroy()` を使用します）
// (重複していた破棄ロジックは上部の destroy() を使用します)
            // UI初期化
            this.ui = createUIManager(this.state);
            this.ui.init();
            
            // オーディオエンジン初期化
            const audioElement = document.getElementById('audioElement');
            await this.audio.init(audioElement);
            
            // 🎵 バックグラウンド再生マネージャー初期化
            try {
                this.backgroundPlaybackManager = createBackgroundPlaybackManager(
                    this.audio,
                    this.state,
                    this.ui
                );
                await this.backgroundPlaybackManager.init();
                console.log('✅ Background playback manager initialized');
            } catch (bgError) {
                console.warn('⚠️ Background playback manager initialization failed:', bgError);
                // バックグラウンド再生は必須でないため、継続
            }
            
            // 📋 プレイリストマネージャー初期化（完全実装版）
            try {
                this.playlistManager = createPlaylistManager(this.state, this.db);
                console.log('✅ Playlist manager initialized');
            } catch (plError) {
                console.warn('⚠️ Playlist manager initialization failed:', plError);
            }
            
            // データ読み込み
            await this.loadData();
            
            // イベントリスナー設定
            this.setupEventListeners();
            
            // 状態変更の購読
            this.subscribeToState();
            
            // 初期UIレンダリング
            this.renderUI();
            
            // ウィンドウが閉じる時のクリーンアップ
            window.addEventListener('beforeunload', () => this.destroy());
            
            console.log('✅ Harmonia initialized successfully');
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            if (this.ui) {
                this.ui.showNotification('アプリの初期化に失敗しました: ' + error.message, 'error');
            } else {
                alert('Harmoniaの初期化に失敗しました: ' + error.message);
            }
        }
    }

    async _initDatabaseWithRetry(maxRetries = 5) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.db.init();
                return;
            } catch (error) {
                console.warn(`Database initialization attempt ${attempt} failed:`, error);
                if (attempt === maxRetries) {
                    throw error;
                }
                // 指数バックオフ + ジッターでリトライ
                const base = Math.min(30000, Math.pow(2, attempt) * 1000);
                const jitter = Math.floor(Math.random() * 1000);
                const wait = base + jitter;
                console.log(`Waiting ${wait}ms before next DB init attempt`);
                await new Promise(resolve => setTimeout(resolve, wait));
            }
        }
    }

    async loadData() {
        try {
            // 設定を読み込み
            const settings = await this.db.get('settings', 'userSettings');
            if (settings) {
                this.state.updateSettings(settings);
            }

            // トラックを読み込み
            const tracks = await this.db.getAll('audioFiles');
            if (tracks.length > 0) {
                // バッチ処理で負荷を分散
                const batchSize = 100;
                for (let i = 0; i < tracks.length; i += batchSize) {
                    const batch = tracks.slice(i, i + batchSize);
                    batch.forEach(track => {
                        // 既存のBlob URLを解放してメモリリーク防止
                        if (track.url && track.url.startsWith('blob:')) {
                            URL.revokeObjectURL(track.url);
                        }
                        
                        if (track.fileData) {
                            const blob = new Blob([track.fileData], { type: track.fileType });
                            track.url = URL.createObjectURL(blob);
                        }
                    });
                    
                    // UIの更新を待つ
                    if (i + batchSize < tracks.length) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
                this.state.setState({ tracks });
            }

            // お気に入りを読み込み
            const favoritesData = await this.db.getAll('favorites');
            const favorites = new Set(favoritesData.map(f => f.trackId));
            this.state.setState({ favorites });

            // プレイリストを読み込み
            const playlists = await this.db.getAll('playlists');
            this.state.setState({ playlists });

            // キューを読み込み
            const queueData = await this.db.getAll('queue');
            const queue = queueData
                .sort((a, b) => a.index - b.index)
                .map(item => item.trackId);
            this.state.setState({ queue });

            // ブックマークを読み込み
            const bookmarks = await this.db.getAll('bookmarks');
            this.state.setState({ bookmarks });

            // 再生履歴と統計を更新
            await this.updateStatistics();

        } catch (error) {
            errorTracker.track(error, { method: 'loadData' });
            console.error('❌ Data load error:', error);
            this.ui?.showNotification?.(errorTracker.getUserMessage(error), 'error');
        }
    }

    setupEventListeners() {
        const audioElement = document.getElementById('audioElement');
        
        // オーディオイベント
        let lastUpdate = 0;
        const timeupdateHandler = () => {
            const now = Date.now();
            // 250msごとに更新（パフォーマンス最適化）
            if (now - lastUpdate < 250) return;
            lastUpdate = now;
            
            this.state.setState({
                currentTime: audioElement.currentTime,
                duration: audioElement.duration || 0
            });
        };
        audioElement.addEventListener('timeupdate', timeupdateHandler);
        this.audioListeners.push({ element: audioElement, event: 'timeupdate', handler: timeupdateHandler });

        const endedHandler = () => this.handleTrackEnd();
        audioElement.addEventListener('ended', endedHandler);
        this.audioListeners.push({ element: audioElement, event: 'ended', handler: endedHandler });
        
        const playHandler = () => {
            this.state.setState({ isPlaying: true });
            this.startVisualizer();
        };
        audioElement.addEventListener('play', playHandler);
        this.audioListeners.push({ element: audioElement, event: 'play', handler: playHandler });

        const pauseHandler = () => {
            this.state.setState({ isPlaying: false });
            this.stopVisualizer();
        };
        audioElement.addEventListener('pause', pauseHandler);
        this.audioListeners.push({ element: audioElement, event: 'pause', handler: pauseHandler });

        const errorHandler = (e) => {
            console.error('Audio error:', e);
            this.ui.showNotification('再生エラーが発生しました', 'error');
            this.state.setState({ isPlaying: false });
        };
        audioElement.addEventListener('error', errorHandler);
        this.audioListeners.push({ element: audioElement, event: 'error', handler: errorHandler });

        // カスタムイベント - すべてのハンドラを配列に保存
        const listeners = [
            ['harmonia:playTrack', (e) => this.playTrack(e.detail)],
            ['harmonia:togglePlay', () => this.togglePlay()],
            ['harmonia:seek', (e) => this.seek(e.detail)],
            ['harmonia:seekToPercent', (e) => this.seekToPercent(e.detail)],
            ['harmonia:setVolume', (e) => this.setVolume(e.detail)],
            ['harmonia:volumeChange', (e) => this.volumeChange(e.detail)],
            ['harmonia:toggleFavorite', (e) => this.toggleFavorite(e.detail)],
            ['harmonia:addToQueue', (e) => this.state.addToQueue(e.detail)],
            ['harmonia:playNext', (e) => this.state.playNext(e.detail)],
            ['harmonia:removeFromQueue', (e) => this.state.removeFromQueue(e.detail)],
            ['harmonia:reorderQueue', (e) => {
                this.state.reorderQueue(e.detail.fromIndex, e.detail.toIndex);
            }],
            
            // 新機能のイベント
            ['harmonia:createPlaylist', (e) => this.createPlaylist(e.detail.name, e.detail.description)],
            ['harmonia:deletePlaylist', (e) => this.deletePlaylist(e.detail)],
            ['harmonia:addToPlaylist', (e) => this.addTrackToPlaylist(e.detail.playlistId, e.detail.trackId)],
            ['harmonia:removeFromPlaylist', (e) => this.removeTrackFromPlaylist(e.detail.playlistId, e.detail.trackId)],
            ['harmonia:playPlaylist', (e) => this.playPlaylist(e.detail)],
            
            ['harmonia:saveLyrics', (e) => this.saveLyrics(e.detail.trackId, e.detail.lyrics)],
            ['harmonia:deleteLyrics', (e) => this.deleteLyrics(e.detail)],
            
            ['harmonia:addBookmark', (e) => this.addBookmark(e.detail.trackId, e.detail.time, e.detail.label)],
            ['harmonia:deleteBookmark', (e) => this.deleteBookmark(e.detail)],
            ['harmonia:jumpToBookmark', (e) => this.jumpToBookmark(e.detail)],
            
            ['harmonia:setEQBand', (e) => this.setEQBand(e.detail.band, e.detail.gain)],
            ['harmonia:applyEQPreset', (e) => this.applyEQPreset(e.detail)],
            
            ['harmonia:editTrackInfo', (e) => this.editTrackInfo(e.detail.trackId, e.detail.updates)],
            ['harmonia:deleteTrack', (e) => this.deleteTrack(e.detail)],
            ['harmonia:deleteAllData', () => this.deleteAllData()],
            ['harmonia:clearPlayHistory', () => this.clearPlayHistory()],
            
            // スマートプレイリスト
            ['harmonia:createSmartPlaylist', (e) => this.createSmartPlaylist(e.detail.name, e.detail.type, e.detail.params)],
            ['harmonia:updateSmartPlaylist', (e) => this.updateSmartPlaylist(e.detail)],
            
            // LRC歌詞
            ['harmonia:saveLyricsWithLRC', (e) => this.saveLyricsWithLRC(e.detail.trackId, e.detail.lyrics)],
            
            // オーディオエフェクト
            ['harmonia:setReverb', (e) => this.setReverb(e.detail.enabled, e.detail.mix, e.detail.decay)],
            ['harmonia:setDelay', (e) => this.setDelay(e.detail.enabled, e.detail.time, e.detail.feedback, e.detail.mix)],
            ['harmonia:setCompressor', (e) => this.setCompressor(e.detail.enabled, e.detail.settings)],
            ['harmonia:setStereo', (e) => this.setStereo(e.detail.enabled, e.detail.pan, e.detail.width)],
            ['harmonia:applyEffectPreset', (e) => this.applyEffectPreset(e.detail)],
            
            // ビジュアライザー
            ['harmonia:setVisualizerStyle', (e) => this.setVisualizerStyle(e.detail)],
            
            // クラウド連携
            ['harmonia:authenticateCloud', (e) => this.authenticateCloud(e.detail)],
            ['harmonia:backupToCloud', () => this.backupToCloud()],
            ['harmonia:restoreFromCloud', (e) => this.restoreFromCloud(e.detail)],
            
            // エクスポート/インポート
            ['harmonia:exportPlaylists', () => this.exportPlaylists()],
            ['harmonia:exportPlayHistory', () => this.exportPlayHistory()],
            ['harmonia:exportStatistics', () => this.exportStatisticsReport()],
            ['harmonia:exportFullBackup', () => this.exportFullBackup()],
            ['harmonia:importBackup', (e) => this.importBackup(e.detail)],
            
            // 設定
            ['harmonia:updateSetting', (e) => this.updateSetting(e.detail.key, e.detail.value)],
            ['harmonia:updateMultipleSettings', (e) => this.updateMultipleSettings(e.detail)],
            ['harmonia:resetSettings', () => this.resetSettings()],
            
            // 🔴 新規: 初期化機能
            ['harmonia:resetEQ', () => this.resetEQ()],
            ['harmonia:resetVisualizerSettings', () => this.resetVisualizerSettings()],
            ['harmonia:resetAllEffects', () => this.resetAllEffects()],
            ['harmonia:fullSystemReset', async () => await this.fullSystemReset()],
            ['harmonia:initVisualizer', () => this.initVisualizer()],
        ];
        
        // イベントリスナーを登録して保存（要素を記録）
        listeners.forEach(([event, handler]) => {
            document.addEventListener(event, handler);
            this.eventListeners.push({ element: document, event, handler });
        });

        // 🎁 イースターエッグ設定
        this.setupEasterEggs();
    }

    // 登録済みイベントリスナーを追跡して追加するユーティリティ
    addTrackedListener(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        this.eventListeners.push({ element, event, handler, options });
    }

    // 🎁 イースターエッグ機能
    setupEasterEggs() {
        // Konami Code (↑↑↓↓←→←→BA)
        const konamiPattern = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        
        const konamiHandler = (e) => {
            this.konamiCode.push(e.key);
            this.konamiCode = this.konamiCode.slice(-10);

            if (JSON.stringify(this.konamiCode) === JSON.stringify(konamiPattern)) {
                this.triggerKonamiEgg();
                this.konamiCode = [];
            }
        };
        this.addTrackedListener(document, 'keydown', konamiHandler);

        // ロゴクリックでクリック数カウント
        const logoEl = document.querySelector('[data-easter-logo]') || document.querySelector('h1');
        if (logoEl) {
            const logoClickHandler = () => {
                this.clickCount++;

                if (this.clickTimer) clearTimeout(this.clickTimer);
                this.clickTimer = setTimeout(() => {
                    this.clickCount = 0;
                }, 1000);

                if (this.clickCount === 7) {
                    this.triggerHiddenMode();
                }
            };
            this.addTrackedListener(logoEl, 'click', logoClickHandler);
        }
    }

    triggerKonamiEgg() {
        if (this.easterEggsTriggered.has('konami')) return;
        this.easterEggsTriggered.add('konami');

        console.log('%c🎮 Konami Code Activated! 🎮', 'font-size: 24px; color: #ff1493; font-weight: bold;');
        console.log('%c秘密のゲームモードが解放されました！', 'font-size: 14px; color: #00ffff;');
        
        this.ui.showNotification('🎮 シークレットモード起動！', 'success');
        
        // 背景エフェクト
        document.body.style.background = 'linear-gradient(45deg, #ff00ff, #00ffff, #ffff00, #ff00ff)';
        document.body.style.backgroundSize = '400% 400%';
        document.body.style.animation = 'gradient 15s ease infinite';
        
        // CSSアニメーション追加
        const style = document.createElement('style');
        style.textContent = `
            @keyframes gradient {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes pulse-neon {
                0%, 100% { text-shadow: 0 0 10px #ff1493; }
                50% { text-shadow: 0 0 20px #00ffff; }
            }
        `;
        document.head.appendChild(style);

        // 復帰ボタン
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '🔄 通常モードに戻す';
        resetBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 24px;
            background: neon lime;
            border: 2px solid #ff1493;
            color: #000;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            z-index: 10000;
        `;
        resetBtn.addEventListener('click', () => {
            location.reload();
        });
        document.body.appendChild(resetBtn);
    }

    triggerHiddenMode() {
        if (this.easterEggsTriggered.has('hidden')) return;
        this.easterEggsTriggered.add('hidden');

        console.log('%c🔓 Hidden Mode Unlocked! 🔓', 'font-size: 20px; color: #ffd700; font-weight: bold;');
        console.log('%c利用可能なコマンド：', 'font-size: 12px; color: #fff;');
        console.log('%cwindow.harmonia.secretPlay() - ランダム再生', 'color: #0ff;');
        console.log('%cwindow.harmonia.secretStats() - 統計情報', 'color: #0ff;');
        console.log('%cwindow.harmonia.secretTheme() - ランダムテーマ', 'color: #0ff;');
        
        this.ui.showNotification('🔓 ヒドゥンモード解放！ Fキーでサプライズ', 'info');

        // Fキーでサプライズ
        const fKeyHandler = (e) => {
            if (e.key === 'f' || e.key === 'F') {
                this.triggerSurprise();
            }
        };
        this.addTrackedListener(document, 'keydown', fKeyHandler);

        // グローバルメソッド追加
        window.harmonia.secretPlay = () => {
            const tracks = this.state.get('tracks');
            if (tracks.length > 0) {
                const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
                this.playTrack(randomTrack.id);
                console.log('🎲 ランダム再生:', randomTrack.title);
            }
        };

        window.harmonia.secretStats = () => {
            const state = this.state.getState();
            const stats = {
                '📊 総トラック数': state.tracks.length,
                '🎵 総プレイリスト': state.playlists?.length || 0,
                '❤️ お気に入り': state.favorites?.length || 0,
                '⏱️ 総再生時間': this.calculateTotalDuration(),
                '🔖 ブックマーク': state.bookmarks?.length || 0
            };
            console.table(stats);
            return stats;
        };

        window.harmonia.secretTheme = () => {
            const themes = ['dark', 'light', 'purple', 'retro'];
            const randomTheme = themes[Math.floor(Math.random() * themes.length)];
            document.body.setAttribute('data-theme', randomTheme);
            this.state.updateSettings({ theme: randomTheme });
            console.log('🎨 テーマ変更:', randomTheme);
        };
    }

    triggerSurprise() {
        const emojis = ['🎵', '🎸', '🎹', '🎤', '🥁', '✨', '🌟', '💫'];
        const surprises = [
            '音楽の力は素晴らしい！',
            'あなたのプレイリストは最高！',
            'クリック連発、やめられない...',
            '隠し機能いっぱい！',
            'Happy Listening!',
            'コアデンプはスゴい！'
        ];

        const msg = surprises[Math.floor(Math.random() * surprises.length)];
        console.log(`%c${emojis[Math.floor(Math.random() * emojis.length)]} ${msg} ${emojis[Math.floor(Math.random() * emojis.length)]}`, 
            'font-size: 16px; color: #ff1493; font-weight: bold;');
    }

    calculateTotalDuration() {
        const tracks = this.state.get('tracks');
        const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }

    subscribeToState() {
        // トラック変更を監視
        this.state.subscribe('tracks', (tracks) => {
            this.ui.renderTracks(
                this.state.get('searchQuery') ? this.state.get('filteredTracks') : tracks,
                this.state.get('currentTrackIndex'),
                this.state.get('favorites')
            );
            this.ui.renderFavorites(
                tracks,
                this.state.get('currentTrackIndex'),
                this.state.get('favorites')
            );
        });

        // 現在のトラック変更を監視
        this.state.subscribe('currentTrackIndex', (index) => {
            const track = this.state.get('tracks')[index];
            this.ui.updateNowPlaying(track);
            this.updateMediaSession(track);
            
            // 次のトラックをプリロード（ギャップレス再生）
            if (this.state.get('settings').gaplessEnabled) {
                const nextIndex = this.getNextTrackIndex();
                if (nextIndex !== -1) {
                    const nextTrack = this.state.get('tracks')[nextIndex];
                    if (nextTrack) {
                        this.audio.preloadNextTrack(nextTrack.url);
                    }
                }
            }
        });

        // 再生状態変更を監視
        this.state.subscribe('isPlaying', (isPlaying) => {
            this.ui.updatePlayButton(isPlaying);
        });

        // 進捗変更を監視
        this.state.subscribe('currentTime', (currentTime) => {
            this.ui.updateProgress(currentTime, this.state.get('duration'));
        });

        // 音量変更を監視
        this.state.subscribe('volume', (volume) => {
            this.ui.updateVolume(volume);
        });

        // お気に入り変更を監視
        this.state.subscribe('favorites', async (favorites) => {
            await this.saveFavorites(favorites);
            this.renderUI();
        });

        // キュー変更を監視
        this.state.subscribe('queue', async (queue) => {
            await this.saveQueue(queue);
            this.ui.renderQueue(queue, this.state.get('tracks'));
        });

        // 設定変更を監視
        this.state.subscribe('settings', async (settings) => {
            try {
                await this.saveSettings(settings);
                
                // 10バンドイコライザー設定を適用
                if (settings.eqEnabled && settings.eq10Band && Array.isArray(settings.eq10Band)) {
                    settings.eq10Band.forEach((gain, index) => {
                        this.audio.setEQBand(index, gain);
                    });
                }
                // 新しい設定項目の反映
                if (settings.themeAccent) {
                    try { document.documentElement.style.setProperty('--theme-accent', settings.themeAccent); } catch (e) {}
                }
                if (settings.colorScheme) {
                    document.body.setAttribute('data-color-scheme', settings.colorScheme);
                }
                if (settings.compactDensity) {
                    document.body.setAttribute('data-density', settings.compactDensity);
                }
                if (settings.miniPlayerPosition) {
                    document.body.setAttribute('data-mini-position', settings.miniPlayerPosition);
                }

                // ビジュアライザー品質の反映
                if (settings.visualizerQuality && this.visualizerEngine && typeof this.visualizerEngine.setQuality === 'function') {
                    try { this.visualizerEngine.setQuality(settings.visualizerQuality); } catch (e) { console.warn('Failed to set visualizer quality', e); }
                }

                // 最大音量制限の反映
                if (typeof settings.maxVolumeLimit === 'number') {
                    const currentVol = this.state.get('volume') || 0.7;
                    if (currentVol > settings.maxVolumeLimit) {
                        this.setVolume(settings.maxVolumeLimit);
                    }
                }
                
                // UI更新
                this.ui.updateShuffleButton(settings.isShuffle);
                this.ui.updateRepeatButton(settings.repeatMode);
            } catch (error) {
                console.error('Failed to save settings:', error);
                this.ui.showNotification('設定の保存に失敗しました', 'error');
            }
        });

        // 検索クエリ変更を監視
        this.state.subscribe('searchQuery', (query) => {
            const tracks = this.state.get('tracks');
            const filtered = this.filterTracks(tracks, query);
            this.state.setState({ filteredTracks: filtered });
            
            this.ui.renderTracks(
                filtered.length > 0 ? filtered : tracks,
                this.state.get('currentTrackIndex'),
                this.state.get('favorites')
            );
        });
    }

    // トラック再生
    async playTrack(index) {
        // 🔴 バグ修正: 非同期処理の競合状態対策
        if (this.isLoadingTrack) {
            console.log('Already loading a track, skipping...');
            return;
        }
        
        const tracks = this.state.get('tracks');
        if (index < 0 || index >= tracks.length) {
            errorTracker.track(new Error(`Invalid track index: ${index}`), { method: 'playTrack' });
            return;
        }

        const track = tracks[index];
        
        this.isLoadingTrack = true;
        
        try {
            await this.audio.loadTrack(track.url);
            await this.audio.play();
            
            this.state.setState({
                currentTrackIndex: index,
                isPlaying: true
            });

            // キューから削除（再生したら）
            const queue = this.state.get('queue');
            const queueIndex = queue.indexOf(track.id);
            if (queueIndex !== -1) {
                this.state.removeFromQueue(queueIndex);
            }

            // 再生履歴を記録
            await this.recordPlayHistory(track.id);

            // 歌詞を読み込み（LRC対応）
            const lyricsData = await this.loadLyricsWithLRC(track.id);
            if (lyricsData) {
                this.state.setState({ 
                    currentLyrics: lyricsData.rawText,
                    currentLyricsData: lyricsData.parsedData
                });
                
                // LRC歌詞の場合は自動スクロールを開始
                if (lyricsData.hasTimestamps) {
                    this.startLyricsAutoScroll();
                } else {
                    this.stopLyricsAutoScroll();
                }
            } else {
                this.state.setState({ 
                    currentLyrics: null,
                    currentLyricsData: null
                });
                this.stopLyricsAutoScroll();
            }

        } catch (error) {
            errorTracker.track(error, { method: 'playTrack', trackIndex: index, trackId: track?.id });
            console.error('❌ Playback error:', error);
            this.ui?.showNotification?.(errorTracker.getUserMessage(error), 'error');
        } finally {
            this.isLoadingTrack = false;
        }
    }

    async togglePlay() {
        const currentIndex = this.state.get('currentTrackIndex');
        const tracks = this.state.get('tracks');

        if (currentIndex === -1 && tracks.length > 0) {
            await this.playTrack(0);
        } else if (this.state.get('isPlaying')) {
            this.audio.pause();
        } else {
            try {
                await this.audio.play();
            } catch (error) {
                console.error('Play error:', error);
            }
        }
    }

    async next() {
        const nextIndex = this.getNextTrackIndex();
        if (nextIndex !== -1) {
            await this.playTrack(nextIndex);
        }
    }

    async previous() {
        const currentTime = this.state.get('currentTime');
        const currentIndex = this.state.get('currentTrackIndex');

        // 3秒以上再生している場合は、最初に戻る
        if (currentTime > 3) {
            this.audio.seek(0);
            return;
        }

        // 前のトラックに移動
        const tracks = this.state.get('tracks');
        const settings = this.state.get('settings');
        
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) {
            if (settings.repeatMode === 'all') {
                prevIndex = tracks.length - 1;
            } else {
                return;
            }
        }

        await this.playTrack(prevIndex);
    }

    async handleTrackEnd() {
        const settings = this.state.get('settings');

        if (settings.repeatMode === 'one') {
            this.audio.seek(0);
            await this.audio.play();
            return;
        }

        const nextIndex = this.getNextTrackIndex();
        if (nextIndex !== -1) {
            await this.playTrack(nextIndex);
        } else {
            this.state.setState({ isPlaying: false });
        }
    }

    getNextTrackIndex() {
        const tracks = this.state.get('tracks');
        const queue = this.state.get('queue');
        const currentIndex = this.state.get('currentTrackIndex');
        const settings = this.state.get('settings');

        // キューが優先
        if (queue.length > 0) {
            const nextTrackId = queue[0];
            return tracks.findIndex(t => t.id === nextTrackId);
        }

        if (settings.repeatMode === 'one') {
            return currentIndex;
        }

        if (settings.isShuffle) {
            let nextIndex;
            do {
                nextIndex = Math.floor(Math.random() * tracks.length);
            } while (nextIndex === currentIndex && tracks.length > 1);
            return nextIndex;
        }

        let nextIndex = currentIndex + 1;
        if (nextIndex >= tracks.length) {
            if (settings.repeatMode === 'all') {
                return 0;
            }
            return -1;
        }

        return nextIndex;
    }

    seek(seconds) {
        const currentTime = this.state.get('currentTime');
        const duration = this.state.get('duration');
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        this.audio.seek(newTime);
    }

    seekToPercent(percent) {
        const duration = this.state.get('duration');
        this.audio.seek(duration * percent);
    }

    setVolume(value) {
        const volume = Math.max(0, Math.min(1, value));
        this.audio.setVolume(volume);
        this.state.setState({ volume });
    }

    volumeChange(delta) {
        const currentVolume = this.state.get('volume');
        this.setVolume(currentVolume + delta);
    }

    toggleFavorite(trackId) {
        this.state.toggleFavorite(trackId);
    }

    filterTracks(tracks, query) {
        if (!query) return tracks;

        const lowerQuery = query.toLowerCase();
        return tracks.filter(track => {
            return (
                (track.title || track.name).toLowerCase().includes(lowerQuery) ||
                (track.artist || '').toLowerCase().includes(lowerQuery) ||
                (track.album || '').toLowerCase().includes(lowerQuery) ||
                (track.genre || '').toLowerCase().includes(lowerQuery) ||
                (track.category || '').toLowerCase().includes(lowerQuery)
            );
        });
    }

    // ファイルアップロード処理
    async handleFileUpload(files) {
        const audioFiles = Array.from(files).filter(file => 
            file.type.startsWith('audio/')
        );

        if (audioFiles.length === 0) {
            this.ui?.showNotification?.('音楽ファイルを選択してください', 'error');
            return;
        }

        for (const file of audioFiles) {
            try {
                // ID3タグを読み取り
                const id3Tags = await id3Reader.readTags(file);
                
                // ファイルデータを保存
                const fileData = await file.arrayBuffer();
                const url = URL.createObjectURL(file);
                
                // メタデータ取得
                const audio = new Audio(url);
                await new Promise((resolve) => {
                    audio.addEventListener('loadedmetadata', resolve, { once: true });
                });

                const track = {
                    id: Date.now() + Math.random(),
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    title: id3Tags?.title || file.name.replace(/\.[^/.]+$/, ''),
                    artist: id3Tags?.artist || 'Unknown Artist',
                    album: id3Tags?.album || 'Unknown Album',
                    genre: id3Tags?.genre || 'Unknown',
                    category: id3Tags?.genre || 'その他',
                    duration: audio.duration,
                    url,
                    artwork: id3Tags?.artwork || null,
                    addedAt: new Date().toISOString(),
                    fileData,
                    fileName: file.name,
                    fileType: file.type
                };

                this.state.addTrack(track);
                await this.db.save('audioFiles', track);

            } catch (error) {
                errorTracker.track(error, { method: 'handleFileUpload', fileName: file.name });
                console.error(`❌ File processing error (${file.name}):`, error);
                this.ui?.showNotification?.(
                    `ファイルエラー （${file.name}）: ${errorTracker.getUserMessage(error)}`,
                    'error'
                );
            }
        }

        this.ui?.showNotification?.(
            `${audioFiles.length}個のトラックを追加しました`,
            'success'
        );
    }

    // ビジュアライザー
    startVisualizer() {
        if (!this.state.get('settings').visualizerEnabled) return;
        // 既存のビジュアライザーを停止（前回のエンジン/インターバルをクリア）
        this.stopVisualizer();

        // ビジュアライザーエンジンの初期化（初回のみ）
        try {
            if (!this.visualizerEngine) {
                const canvas = document.getElementById('visualizerCanvas');
                if (!canvas) {
                    console.warn('🎨 Canvas element not found');
                    return;
                }

                this.visualizerEngine = new VisualizerEngine(canvas, this.audio);
                console.log('🎨 Visualizer engine created');
            }

            // エンジンによる requestAnimationFrame ループで描画を一元化
            this.visualizerEngine.start();
        } catch (error) {
            console.error('🎨 Visualizer initialization error:', error);
            return;
        }
    }

    stopVisualizer() {
        if (this.visualizerInterval) {
            clearInterval(this.visualizerInterval);
            this.visualizerInterval = null;
        }
        
        // ビジュアライザーエンジンの停止
        if (this.visualizerEngine) {
            this.visualizerEngine.stop();
        }
        
        this.ui.stopVisualizer();
    }

    // 🗑️ トラック削除機能（新機能）
    async deleteTrack(trackId) {
        try {
            const tracks = this.state.get('tracks');
            const trackIndex = tracks.findIndex(t => t.id === trackId);

            if (trackIndex === -1) {
                throw new Error('トラックが見つかりません');
            }

            const track = tracks[trackIndex];

            // Blob URL を解放
            if (track.url && track.url.startsWith('blob:')) {
                URL.revokeObjectURL(track.url);
            }

            // 状態から削除
            tracks.splice(trackIndex, 1);
            this.state.setState({ tracks: [...tracks] });

            // DB から削除
            await this.db.delete('audioFiles', trackId);

            // 再生中のトラックが削除された場合は停止
            if (this.state.get('currentTrackIndex') === trackIndex) {
                this.audio?.pause?.();
                this.state.setState({ currentTrackIndex: -1 });
            } else if (this.state.get('currentTrackIndex') > trackIndex) {
                this.state.setState({ 
                    currentTrackIndex: this.state.get('currentTrackIndex') - 1 
                });
            }

            // キューから削除
            const queue = this.state.get('queue');
            const newQueue = queue.filter(id => id !== trackId);
            this.state.setState({ queue: newQueue });

            // お気に入りから削除
            const favorites = this.state.get('favorites');
            if (Array.isArray(favorites) && favorites.includes(trackId)) {
                const newFavorites = favorites.filter(id => id !== trackId);
                this.state.setState({ favorites: newFavorites });
            }

            // プレイリストから削除
            const playlists = this.state.get('playlists') || [];
            const updatedPlaylists = playlists.map(p => ({
                ...p,
                tracks: p.tracks.filter(id => id !== trackId),
                metadata: {
                    ...p.metadata,
                    trackCount: (p.metadata?.trackCount || 0) - 1
                }
            }));
            this.state.setState({ playlists: updatedPlaylists });

            // 複数プレイリストを DB に保存
            for (const playlist of updatedPlaylists) {
                await this.db.save('playlists', playlist);
            }

            this.ui?.showNotification?.(`✅ 「${track.title || 'トラック'}」を削除しました`, 'success');
            this.renderUI();

            return true;
        } catch (error) {
            errorTracker.track(error, { method: 'deleteTrack', trackId });
            console.error('❌ トラック削除失敗:', error);
            this.ui?.showNotification?.(`削除に失敗: ${errorTracker.getUserMessage(error)}`, 'error');
            return false;
        }
    }

    // 🗑️ 複数トラック一括削除
    async deleteMultipleTracks(trackIds) {
        try {
            let successCount = 0;
            for (const trackId of trackIds) {
                const success = await this.deleteTrack(trackId);
                if (success) successCount++;
            }

            this.ui?.showNotification?.(
                `✅ ${successCount}個のトラックを削除しました`,
                'success'
            );
            return successCount;
        } catch (error) {
            errorTracker.track(error, { method: 'deleteMultipleTracks' });
            console.error('❌ 複数削除失敗:', error);
            this.ui?.showNotification?.('削除処理中にエラーが発生しました', 'error');
            return 0;
        }
    }

    // 🔋 省エネモード 設定（新機能）
    setPowerSaveMode(enabled, profile = 'balanced') {
        const settings = this.state.get('settings');
        const newSettings = {
            ...settings,
            powerSaveMode: enabled,
            powerSaveProfile: profile
        };

        this.state.updateSettings(newSettings);

        if (enabled) {
            console.log(`🔋 省エネモード: ${profile} に設定`);

            // プロファイル別の設定
            switch (profile) {
                case 'aggressive':
                    // 最も省エネ
                    newSettings.visualizerEnabled = false;
                    newSettings.animationsEnabled = false;
                    newSettings.hardwareAcceleration = false;
                    newSettings.reduceVisualizerQuality = true;
                    newSettings.cpuUsageLimit = 30;
                    break;
                case 'balanced':
                    // バランス型
                    newSettings.visualizerEnabled = true;
                    newSettings.animationsEnabled = true;
                    newSettings.hardwareAcceleration = true;
                    newSettings.reduceVisualizerQuality = false;
                    newSettings.cpuUsageLimit = 50;
                    break;
                case 'none':
                    // フル機能
                    newSettings.visualizerEnabled = true;
                    newSettings.animationsEnabled = true;
                    newSettings.hardwareAcceleration = true;
                    newSettings.reduceVisualizerQuality = false;
                    newSettings.cpuUsageLimit = 100;
                    break;
            }

            this.state.updateSettings(newSettings);
            this.applyPowerSaveSettings(newSettings);

            this.ui.showNotification(
                `✅ 省エネモードを有効化: ${profile}プロファイル`,
                'success'
            );
        } else {
            console.log('🔋 省エネモード: 無効');
            this.ui.showNotification('🔋 省エネモードを無効化', 'info');
        }
    }

    // 省エネ設定を適用
    applyPowerSaveSettings(settings) {
        if (!settings.powerSaveMode) return;

        // ビジュアライザー品質低下
        if (settings.reduceVisualizerQuality) {
            const canvas = document.getElementById('visualizerCanvas');
            if (canvas) {
                canvas.width = Math.max(canvas.width / 2, 128);
                canvas.height = Math.max(canvas.height / 2, 128);
            }
        }

        // CPU 使用率制限
        const audioElement = document.getElementById('audioElement');
        if (audioElement) {
            // バッファサイズを変更して CPU 負荷調整
            audioElement.buffered; // バッファ状態確認
        }
    }

    // Media Session API
    updateMediaSession(track) {
        if (!('mediaSession' in navigator) || !track) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || track.name,
            artist: track.artist || 'Unknown Artist',
            album: track.album || 'Unknown Album',
            artwork: track.artwork ? [
                { src: track.artwork, sizes: '96x96', type: 'image/jpeg' },
                { src: track.artwork, sizes: '128x128', type: 'image/jpeg' },
                { src: track.artwork, sizes: '192x192', type: 'image/jpeg' },
                { src: track.artwork, sizes: '256x256', type: 'image/jpeg' },
                { src: track.artwork, sizes: '384x384', type: 'image/jpeg' },
                { src: track.artwork, sizes: '512x512', type: 'image/jpeg' }
            ] : []
        });

        navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());

        try {
            navigator.mediaSession.setActionHandler('seekbackward', () => this.seek(-10));
            navigator.mediaSession.setActionHandler('seekforward', () => this.seek(10));
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime !== null) {
                    this.audio.seek(details.seekTime);
                }
            });
        } catch (error) {
            // 一部のブラウザではサポートされていない
        }
    }

    // データ保存
    async saveSettings(settings) {
        try {
            await this.db.save('settings', {
                key: 'userSettings',
                ...settings
            });
        } catch (error) {
            errorTracker.track(error, { method: 'saveSettings' });
            console.error('❌ Save settings error:', error);
            this.ui?.showNotification?.('設定の保存に失敗しました', 'error');
        }
    }

    async saveFavorites(favorites) {
        try {
            await this.db.clear('favorites');
            const batch = Array.from(favorites).map(trackId => ({ trackId }));
            await this.db.saveBatch('favorites', batch);
        } catch (error) {
            errorTracker.track(error, { method: 'saveFavorites' });
            console.error('❌ Save favorites error:', error);
        }
    }

    async saveQueue(queue) {
        try {
            const q = Array.isArray(queue) ? queue : this.state.get('queue');
            await this.db.clear('queue');
            const batch = q.map((trackId, index) => ({ index, trackId }));
            await this.db.saveBatch('queue', batch);
        } catch (error) {
            errorTracker.track(error, { method: 'saveQueue' });
            console.error('❌ Save queue error:', error);
        }
    }

    // UIレンダリング
    renderUI() {
        const state = this.state.getState();
        
        // ✨ ビジュアライザーを初期化
        this.initVisualizer();
        
        this.ui.renderTracks(
            state.searchQuery ? state.filteredTracks : state.tracks,
            state.currentTrackIndex,
            state.favorites
        );
        
        this.ui.renderFavorites(
            state.tracks,
            state.currentTrackIndex,
            state.favorites
        );
        
        this.ui.renderQueue(state.queue, state.tracks);
        
        // プレイリスト表示
        this.renderPlaylists();
    }

    // ビジュアライザーの初期化（エンジン生成と設定の適用）
    initVisualizer() {
        try {
            const canvas = document.getElementById('visualizerCanvas');
            if (!canvas) return;

            if (!this.visualizerEngine) {
                this.visualizerEngine = new VisualizerEngine(canvas, this.audio);
                console.log('🎨 Visualizer engine initialized (initVisualizer)');
            }

            const settings = this.state.get('settings') || {};
            if (settings.visualizerQuality && typeof this.visualizerEngine.setQuality === 'function') {
                try { this.visualizerEngine.setQuality(settings.visualizerQuality); } catch (e) { console.warn('Failed to set visualizer quality', e); }
            }
            if (settings.visualizerStyle) {
                try { this.setVisualizerStyle(settings.visualizerStyle); } catch (e) { /* ignore */ }
            }

            // Ensure canvas sizing is correct
            if (typeof this.visualizerEngine._adjustCanvasResolution === 'function') {
                try { this.visualizerEngine._adjustCanvasResolution(); } catch (e) { /* ignore */ }
            }
        } catch (error) {
            console.warn('initVisualizer error:', error);
        }
    }

    // プレイリスト レンダリング
    renderPlaylists() {
        const playlists = this.state.get('playlists') || [];
        const container = document.getElementById('playlistsContainer');
        
        if (!container) return;
        
        if (playlists.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--theme-text-secondary);">プレイリストがまだ作成されていません</div>';
            return;
        }
        
        container.innerHTML = playlists.map(playlist => `
            <div style="padding: 12px 16px; border-bottom: 1px solid var(--theme-border); cursor: pointer; transition: background 0.2s;" 
                 onmouseover="this.style.background='var(--theme-hover)'" 
                 onmouseout="this.style.background='transparent'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${playlist.color || '#6366f1'};"></div>
                            <div>
                                <div style="font-weight: 600; color: var(--theme-text);">${this._escapeHtml(playlist.name)}</div>
                                <div style="font-size: 12px; color: var(--theme-text-secondary);">
                                    ${playlist.metadata?.trackCount || 0} 曲 • ${this._formatPlaylistDuration(playlist.metadata?.totalDuration || 0)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <button class="playlist-action-trigger" data-playlist-id="${playlist.id}" style="padding: 8px; background: var(--theme-hover); border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">⋮</button>
                </div>
            </div>
        `).join('');
        
        // アクションボタンクリック時の処理
        container.querySelectorAll('.playlist-action-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._currentPlaylistId = btn.dataset.playlistId;
                this.ui.openModal('playlistActionsModal');
            });
        });
    }

    // ユーティリティ: HTMLエスケープ
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ユーティリティ: 再生時間フォーマット
    _formatPlaylistDuration(seconds) {
        if (seconds < 60) return Math.floor(seconds) + '秒';
        if (seconds < 3600) return Math.floor(seconds / 60) + '分';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return hours + '時間' + mins + '分';
    }

    // スリープタイマーを設定
    setSleepTimer(minutes) {
        this.clearSleepTimer();
        
        const milliseconds = minutes * 60 * 1000;
        const startTime = Date.now();
        
        // 🔴 バグ修正: 累積誤差を防ぐため、毎回に経過時間から残り時間を計算
        this.state.setState({
            sleepTimer: setTimeout(() => {
                this.fadeOutAndStop();
            }, milliseconds),
            sleepTimerRemaining: minutes * 60
        });
        
        // 残り時間を毎秒更新（高精度版）
        this.sleepTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.max(0, (minutes * 60) - elapsed);
            this.state.setState({ sleepTimerRemaining: remaining });
            
            if (remaining === 0) {
                clearInterval(this.sleepTimerInterval);
                this.sleepTimerInterval = null;
            }
        }, 1000);
        
        this.ui.showNotification(`スリープタイマーを${minutes}分に設定しました`, 'success');
        console.log(`⏰ Sleep timer set to ${minutes} minutes`);
    }

    // スリープタイマーをクリア
    clearSleepTimer() {
        const timer = this.state.get('sleepTimer');
        if (timer) {
            clearTimeout(timer);
            this.state.setState({ sleepTimer: null, sleepTimerRemaining: 0 });
        }
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.ui.showNotification('スリープタイマーをキャンセルしました', 'info');
    }

    // フェードアウトして停止
    async fadeOutAndStop() {
        const currentVolume = this.state.get('volume');
        const steps = 20;
        const stepDuration = 50; // ms
        
        for (let i = steps; i >= 0; i--) {
            const volume = (currentVolume * i) / steps;
            this.audio.setVolume(volume);
            await new Promise(resolve => setTimeout(resolve, stepDuration));
        }
        
        this.pause();
        this.audio.setVolume(currentVolume); // 音量を元に戻す
        this.ui.showNotification('スリープタイマーで停止しました', 'info');
        console.log('⏰ Stopped by sleep timer');
    }

    // 再生速度を設定
    setPlaybackRate(rate) {
        this.audio.setPlaybackRate(rate);
        this.state.updateSettings({ playbackRate: rate });
    }

    // クリーンアップ（ページ離脱時）
    destroy() {
        console.log('🧹 Cleaning up Harmonia...');
        
        // バックグラウンド再生マネージャーをクリーンアップ
        if (this.backgroundPlaybackManager && this.backgroundPlaybackManager.destroy) {
            this.backgroundPlaybackManager.destroy();
        }
        
        // プレイリストマネージャーをリセット
        this.playlistManager = null;
        this._currentPlaylistId = null;
        
        // オーディオイベントリスナーを削除
        this.audioListeners.forEach(({ element, event, handler }) => {
            if (element) element.removeEventListener(event, handler);
        });
        this.audioListeners = [];
        
        // カスタムイベントリスナーを削除
        this.eventListeners.forEach(({ element, event, handler }) => {
            if (element && event && handler) element.removeEventListener(event, handler);
        });
        this.eventListeners = [];
        
        // タイマーをクリア
        this.clearSleepTimer();
        if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
        if (this.lyricsUpdateInterval) clearInterval(this.lyricsUpdateInterval);
        if (this.progressInterval) clearInterval(this.progressInterval);
        if (this.visualizerInterval) clearInterval(this.visualizerInterval);
        
        // UI Manager のクリーンアップ
        if (this.ui && this.ui.destroy) {
            this.ui.destroy();
        }
        
        // Blob URL を解放
        const tracks = this.state.get('tracks');
        tracks.forEach(track => {
            if (track.url && track.url.startsWith('blob:')) {
                URL.revokeObjectURL(track.url);
            }
        });
        
        // オーディオを停止
        if (this.audio && this.audio.pause) {
            this.audio.pause();
        }
        
        console.log('✅ Harmonia cleaned up');
    }

    // A-Bリピートを設定
    setupABRepeat() {
        const abState = this.abRepeatState || { stage: 'none' };
        const currentTime = this.audio.audioElement.currentTime;
        
        if (abState.stage === 'none') {
            // A点を設定
            abState.stage = 'a-set';
            abState.pointA = currentTime;
            this.ui.showNotification(`A点を設定しました (${this.formatTime(currentTime)})`, 'success');
            document.getElementById('abRepeatBtn').setAttribute('aria-pressed', 'true');
            document.getElementById('abRepeatBtn').style.color = '#10b981';
        } else if (abState.stage === 'a-set') {
            // B点を設定してリピート開始
            if (currentTime > abState.pointA) {
                abState.stage = 'active';
                abState.pointB = currentTime;
                this.audio.setABRepeat(abState.pointA, abState.pointB);
                this.ui.showNotification(
                    `A-Bリピート開始 (${this.formatTime(abState.pointA)} → ${this.formatTime(abState.pointB)})`,
                    'success'
                );
                document.getElementById('abRepeatBtn').style.color = '#f59e0b';
            } else {
                this.ui.showNotification('B点はA点より後に設定してください', 'error');
            }
        } else {
            // リピートをクリア
            abState.stage = 'none';
            this.audio.clearABRepeat();
            this.ui.showNotification('A-Bリピートを解除しました', 'info');
            document.getElementById('abRepeatBtn').setAttribute('aria-pressed', 'false');
            document.getElementById('abRepeatBtn').style.color = '';
        }
        
        this.abRepeatState = abState;
    }

    // 時間をフォーマット
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ===== プレイリスト管理 =====
    async createPlaylist(name, description = '') {
        // Delegate to PlaylistManager when available
        if (this.playlistManager && typeof this.playlistManager.createPlaylist === 'function') {
            const p = await this.playlistManager.createPlaylist(name, description);
            this.ui.showNotification(`プレイリスト「${p.name}」を作成しました`, 'success');
            return p;
        }

        // Fallback (legacy inline implementation)
        const playlist = {
            id: Date.now() + Math.random(),
            name,
            description,
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        const playlists = [...this.state.get('playlists'), playlist];
        this.state.setState({ playlists });
        await this.db.save('playlists', playlist);
        this.ui.showNotification(`プレイリスト「${name}」を作成しました`, 'success');
        return playlist;
    }

    async deletePlaylist(playlistId) {
        if (this.playlistManager && typeof this.playlistManager.deletePlaylist === 'function') {
            await this.playlistManager.deletePlaylist(playlistId);
            this.ui.showNotification('プレイリストを削除しました', 'success');
            return;
        }

        const playlists = this.state.get('playlists').filter(p => p.id !== playlistId);
        this.state.setState({ playlists });
        await this.db.delete('playlists', playlistId);
        this.ui.showNotification('プレイリストを削除しました', 'success');
    }

    async addTrackToPlaylist(playlistId, trackId) {
        if (this.playlistManager && typeof this.playlistManager.addTracksToPlaylist === 'function') {
            await this.playlistManager.addTracksToPlaylist(playlistId, [trackId]);
            this.ui.showNotification('プレイリストに追加しました', 'success');
            return;
        }

        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        
        if (playlist && !playlist.tracks.includes(trackId)) {
            playlist.tracks.push(trackId);
            playlist.updatedAt = new Date().toISOString();
            this.state.setState({ playlists: [...playlists] });
            await this.db.save('playlists', playlist);
            this.ui.showNotification('プレイリストに追加しました', 'success');
        }
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        if (this.playlistManager && typeof this.playlistManager.removeTracksFromPlaylist === 'function') {
            await this.playlistManager.removeTracksFromPlaylist(playlistId, [trackId]);
            this.ui.showNotification('プレイリストから削除しました', 'success');
            return;
        }

        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        
        if (playlist) {
            playlist.tracks = playlist.tracks.filter(id => id !== trackId);
            playlist.updatedAt = new Date().toISOString();
            this.state.setState({ playlists: [...playlists] });
            await this.db.save('playlists', playlist);
            this.ui.showNotification('プレイリストから削除しました', 'success');
        }
    }

    async playPlaylist(playlistId) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        const tracks = this.state.get('tracks');
        
        if (playlist && playlist.tracks.length > 0) {
            const firstTrackId = playlist.tracks[0];
            const trackIndex = tracks.findIndex(t => t.id === firstTrackId);
            
            if (trackIndex !== -1) {
                // 残りをキューに追加
                const queue = playlist.tracks.slice(1);
                this.state.setState({ queue });
                await this.saveQueue();
                
                // 最初のトラックを再生
                await this.playTrack(trackIndex);
            }
        }
    }

    // ソーシャル共有: 現在のトラックを共有
    async shareCurrentTrack() {
        const index = this.state.get('currentTrackIndex');
        const tracks = this.state.get('tracks') || [];
        if (index === -1 || !tracks[index]) {
            if (this.ui) this.ui.showNotification('共有するトラックがありません', 'error');
            return;
        }

        const track = tracks[index];
        const title = track.title || track.name || 'Unknown';
        const artist = track.artist || 'Unknown Artist';
        const repoUrl = 'https://github.com/wado-answer/harmonia';
        const text = `今聴いている曲: ${title} — ${artist}\n${repoUrl}`;
        const url = (track.url && !track.url.startsWith('blob:')) ? track.url : repoUrl;

        if (navigator.share) {
            try {
                await navigator.share({ title, text, url });
                if (this.ui) this.ui.showNotification('共有に成功しました', 'success');
            } catch (e) {
                console.warn('Share failed', e);
            }
            return;
        }

        // フォールバック: Twitter インテントを開き、クリップボードにコピー
        const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}${url ? '&url=' + encodeURIComponent(url) : ''}`;
        try {
            window.open(twitter, 'share', 'width=600,height=400');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(`${text}${url ? ' ' + url : ''}`);
                if (this.ui) this.ui.showNotification('共有テキストをコピーしました', 'success');
            }
        } catch (e) {
            console.error('Share fallback failed', e);
            if (this.ui) this.ui.showNotification('共有に失敗しました', 'error');
        }
    }

    // ソーシャル共有: プレイリストを共有
    async sharePlaylist(playlistId) {
        const playlists = this.state.get('playlists') || [];
        const playlist = playlists.find(p => p.id === playlistId);
        if (!playlist) {
            if (this.ui) this.ui.showNotification('プレイリストが見つかりません', 'error');
            return;
        }

        const tracks = (this.state.get('tracks') || []).filter(t => playlist.tracks.includes(t.id));
        const preview = tracks.slice(0, 5).map(t => `${t.title || t.name} — ${t.artist || ''}`).join(', ');
        const repoUrl = 'https://github.com/wado-answer/harmonia';
        const text = `プレイリスト「${playlist.name}」を共有します: ${preview}${tracks.length > 5 ? ' 他...' : ''}\n${repoUrl}`;

        // Try Web Share with a file if supported
        try {
            const payload = { playlist: { id: playlist.id, name: playlist.name, tracks: playlist.tracks }, tracks };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const file = new File([blob], `${playlist.name.replace(/[^a-z0-9_-]/gi, '_')}.json`, { type: 'application/json' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ title: playlist.name, text, files: [file] });
                if (this.ui) this.ui.showNotification('プレイリストを共有しました', 'success');
                return;
            }
        } catch (e) {
            // ignore and fallback
            console.warn('File share not supported', e);
        }

        // フォールバック: Twitter にテキストを投げる + クリップボード
        try {
            const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
            window.open(twitter, 'share', 'width=600,height=400');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text + ' ' + location.href);
                if (this.ui) this.ui.showNotification('共有テキストをコピーしました', 'success');
            }
        } catch (e) {
            console.error('Share playlist failed', e);
            if (this.ui) this.ui.showNotification('共有に失敗しました', 'error');
        }
    }

    // ===== 歌詞管理 =====
    async saveLyrics(trackId, lyrics) {
        const lyricsData = {
            trackId,
            lyrics,
            updatedAt: new Date().toISOString()
        };
        
        await this.db.save('lyrics', lyricsData);
        
        // 現在再生中のトラックの歌詞なら即座に反映
        const currentIndex = this.state.get('currentTrackIndex');
        const tracks = this.state.get('tracks');
        if (currentIndex !== -1 && tracks[currentIndex].id === trackId) {
            this.state.setState({ currentLyrics: lyrics });
        }
        
        this.ui.showNotification('歌詞を保存しました', 'success');
    }

    async loadLyrics(trackId) {
        const lyricsData = await this.db.get('lyrics', trackId);
        return lyricsData ? lyricsData.lyrics : null;
    }

    async deleteLyrics(trackId) {
        await this.db.delete('lyrics', trackId);
        
        const currentIndex = this.state.get('currentTrackIndex');
        const tracks = this.state.get('tracks');
        if (currentIndex !== -1 && tracks[currentIndex].id === trackId) {
            this.state.setState({ currentLyrics: null });
        }
        
        this.ui.showNotification('歌詞を削除しました', 'success');
    }

    // ===== ブックマーク管理 =====
    async addBookmark(trackId, time, label = '') {
        const tracks = this.state.get('tracks');
        const track = tracks.find(t => t.id === trackId);
        
        const bookmark = {
            id: Date.now() + Math.random(),
            trackId,
            trackName: track ? track.title : 'Unknown',
            time,
            label,
            createdAt: new Date().toISOString()
        };
        
        await this.db.save('bookmarks', bookmark);
        
        const bookmarks = await this.db.getAll('bookmarks');
        this.state.setState({ bookmarks });
        
        this.ui.showNotification('ブックマークを追加しました', 'success');
    }

    async deleteBookmark(bookmarkId) {
        await this.db.delete('bookmarks', bookmarkId);
        
        const bookmarks = await this.db.getAll('bookmarks');
        this.state.setState({ bookmarks });
        
        this.ui.showNotification('ブックマークを削除しました', 'success');
    }

    async jumpToBookmark(bookmark) {
        const tracks = this.state.get('tracks');
        const trackIndex = tracks.findIndex(t => t.id === bookmark.trackId);
        
        if (trackIndex !== -1) {
            await this.playTrack(trackIndex);
            setTimeout(() => {
                this.audio.seek(bookmark.time);
            }, 100);
        }
    }

    // ===== 再生履歴・統計 =====
    async recordPlayHistory(trackId) {
        try {
            const tracks = this.state.get('tracks');
            const track = tracks.find(t => t.id === trackId);
            
            if (!track) return;
            
            const historyEntry = {
                id: Date.now() + Math.random(),
                trackId,
                trackName: track.title,
                artist: track.artist,
                playedAt: new Date().toISOString(),
                duration: track.duration || 0
            };
            
            await this.db.save('playHistory', historyEntry);
            
            // 統計を更新
            await this.updateStatistics();
        } catch (error) {
            errorTracker.track(error, { method: 'recordPlayHistory', trackId });
            console.error('❌ Record play history error:', error);
        }
    }

    async updateStatistics() {
        try {
            const history = await this.db.getAll('playHistory');
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            
            const lastWeekPlays = history.filter(h => 
                new Date(h.playedAt).getTime() > oneWeekAgo
            );
            
            // 最も再生されたトラックを計算
            const playCounts = {};
            history.forEach(h => {
                playCounts[h.trackId] = (playCounts[h.trackId] || 0) + 1;
            });
            
            let mostPlayedTrack = null;
            let maxPlays = 0;
            Object.entries(playCounts).forEach(([trackId, count]) => {
                if (count > maxPlays) {
                    maxPlays = count;
                    const entry = history.find(h => h.trackId === trackId);
                    if (entry) {
                        mostPlayedTrack = {
                            trackId,
                            trackName: entry.trackName,
                            artist: entry.artist,
                            playCount: count
                        };
                    }
                }
            });
            
            // 総再生時間を計算
            const totalListenTime = history.reduce((sum, h) => sum + (h.duration || 0), 0);
            
            const statistics = {
                totalPlays: history.length,
                totalListenTime,
                mostPlayedTrack,
                lastWeekPlays
            };
            
            this.state.setState({ statistics, playHistory: history });
        } catch (error) {
            errorTracker.track(error, { method: 'updateStatistics' });
            console.error('❌ Update statistics error:', error);
        }
    }

    async clearPlayHistory() {
        try {
            await this.db.clear('playHistory');
            this.state.setState({ 
                playHistory: [],
                statistics: {
                    totalPlays: 0,
                    totalListenTime: 0,
                    mostPlayedTrack: null,
                    lastWeekPlays: []
                }
            });
            this.ui?.showNotification?.('再生履歴をクリアしました', 'success');
        } catch (error) {
            errorTracker.track(error, { method: 'clearPlayHistory' });
            console.error('❌ Clear play history error:', error);
            this.ui?.showNotification?.('履歴クリアに失敗しました', 'error');
        }
    }

    // ===== 10バンドイコライザー =====
    setEQBand(bandIndex, gain) {
        this.audio.setEQBand(bandIndex, gain);
        
        const settings = this.state.get('settings');
        const eq10Band = [...settings.eq10Band];
        eq10Band[bandIndex] = gain;
        
        this.state.updateSettings({ eq10Band });
    }

    applyEQPreset(preset) {
        this.audio.applyEQPreset(preset);
        
        const eq10Band = this.audio.getAllEQBands();
        this.state.updateSettings({ eq10Band, eqPreset: preset });
        
        this.ui.showNotification(`プリセット「${preset}」を適用しました`, 'success');
    }

    // ===== トラック情報編集 =====
    async editTrackInfo(trackId, updates) {
        const tracks = this.state.get('tracks');
        const trackIndex = tracks.findIndex(t => t.id === trackId);
        
        if (trackIndex !== -1) {
            const track = { ...tracks[trackIndex], ...updates };
            tracks[trackIndex] = track;
            
            this.state.setState({ tracks: [...tracks] });
            await this.db.save('audioFiles', track);
            
            this.ui.showNotification('トラック情報を更新しました', 'success');
        }
    }

    // ===== 全データ削除 =====
    async deleteAllData() {
        // Blob URLを解放
        const tracks = this.state.get('tracks');
        tracks.forEach(track => {
            if (track.url && track.url.startsWith('blob:')) {
                URL.revokeObjectURL(track.url);
            }
        });
        
        // データベースをクリア
        await this.db.clearAll();
        
        // 状態をリセット
        this.state.setState({
            tracks: [],
            currentTrackIndex: -1,
            filteredTracks: [],
            isPlaying: false,
            playlists: [],
            smartPlaylists: [],
            favorites: new Set(),
            queue: [],
            bookmarks: [],
            playHistory: [],
            currentLyrics: null,
            currentLyricsData: null,
            statistics: {
                totalPlays: 0,
                totalListenTime: 0,
                mostPlayedTrack: null,
                lastWeekPlays: []
            }
        });
        
        // 再生を停止
        this.audio.pause();
        
        this.ui.showNotification('すべてのデータを削除しました', 'success');
    }

    // ===== スマートプレイリスト =====
    async createSmartPlaylist(name, type, params = {}) {
        const tracks = this.state.get('tracks');
        const playHistory = this.state.get('playHistory');
        const favorites = this.state.get('favorites');
        
        let trackIds = [];
        
        switch (type) {
            case 'genre':
                trackIds = smartPlaylistEngine.byGenre(tracks, params.genre, params.limit);
                break;
            case 'artist':
                trackIds = smartPlaylistEngine.byArtist(tracks, params.artist, params.limit);
                break;
            case 'album':
                trackIds = smartPlaylistEngine.byAlbum(tracks, params.album);
                break;
            case 'top-played':
                trackIds = smartPlaylistEngine.topPlayed(tracks, playHistory, params.limit);
                break;
            case 'recently-added':
                trackIds = smartPlaylistEngine.recentlyAdded(tracks, params.days, params.limit);
                break;
            case 'recently-played':
                trackIds = smartPlaylistEngine.recentlyPlayed(tracks, playHistory, params.days, params.limit);
                break;
            case 'favorites':
                trackIds = smartPlaylistEngine.favorites(tracks, favorites);
                break;
            case 'long-tracks':
                trackIds = smartPlaylistEngine.longTracks(tracks, params.minDuration, params.limit);
                break;
            case 'short-tracks':
                trackIds = smartPlaylistEngine.shortTracks(tracks, params.maxDuration, params.limit);
                break;
            case 'random':
                trackIds = smartPlaylistEngine.random(tracks, params.count);
                break;
            case 'never-played':
                trackIds = smartPlaylistEngine.neverPlayed(tracks, playHistory, params.limit);
                break;
            case 'advanced':
                trackIds = smartPlaylistEngine.advanced(tracks, params);
                break;
        }
        
        const smartPlaylist = {
            id: Date.now() + Math.random(),
            name,
            type,
            params,
            tracks: trackIds,
            isSmart: true,
            autoUpdate: params.autoUpdate !== false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        const playlists = [...this.state.get('playlists'), smartPlaylist];
        this.state.setState({ playlists });
        await this.db.save('playlists', smartPlaylist);
        
        this.ui.showNotification(`スマートプレイリスト「${name}」を作成しました (${trackIds.length}曲)`, 'success');
        return smartPlaylist;
    }

    async updateSmartPlaylist(playlistId) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        
        if (!playlist || !playlist.isSmart) return;
        
        // プレイリストを再生成
        const tracks = this.state.get('tracks');
        const playHistory = this.state.get('playHistory');
        const favorites = this.state.get('favorites');
        
        let trackIds = [];
        const { type, params } = playlist;
        
        // typeに応じて再生成（上記と同じロジック）
        switch (type) {
            case 'genre':
                trackIds = smartPlaylistEngine.byGenre(tracks, params.genre, params.limit);
                break;
            case 'artist':
                trackIds = smartPlaylistEngine.byArtist(tracks, params.artist, params.limit);
                break;
            case 'album':
                trackIds = smartPlaylistEngine.byAlbum(tracks, params.album);
                break;
            case 'top-played':
                trackIds = smartPlaylistEngine.topPlayed(tracks, playHistory, params.limit);
                break;
            case 'recently-added':
                trackIds = smartPlaylistEngine.recentlyAdded(tracks, params.days, params.limit);
                break;
            case 'recently-played':
                trackIds = smartPlaylistEngine.recentlyPlayed(tracks, playHistory, params.days, params.limit);
                break;
            case 'favorites':
                trackIds = smartPlaylistEngine.favorites(tracks, favorites);
                break;
            case 'long-tracks':
                trackIds = smartPlaylistEngine.longTracks(tracks, params.minDuration, params.limit);
                break;
            case 'short-tracks':
                trackIds = smartPlaylistEngine.shortTracks(tracks, params.maxDuration, params.limit);
                break;
            case 'random':
                trackIds = smartPlaylistEngine.random(tracks, params.count);
                break;
            case 'never-played':
                trackIds = smartPlaylistEngine.neverPlayed(tracks, playHistory, params.limit);
                break;
            case 'advanced':
                trackIds = smartPlaylistEngine.advanced(tracks, params);
                break;
        }
        
        playlist.tracks = trackIds;
        playlist.updatedAt = new Date().toISOString();
        
        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', playlist);
        
        this.ui.showNotification(`プレイリスト「${playlist.name}」を更新しました (${trackIds.length}曲)`, 'success');
    }

    getSmartPlaylistOptions() {
        const tracks = this.state.get('tracks');
        return {
            genres: smartPlaylistEngine.getAllGenres(tracks),
            artists: smartPlaylistEngine.getAllArtists(tracks),
            albums: smartPlaylistEngine.getAllAlbums(tracks)
        };
    }

    // ===== LRC歌詞機能 =====
    async saveLyricsWithLRC(trackId, lyricsText) {
        // LRC形式かどうかを判定
        const isLRC = lrcParser.isLRC(lyricsText);
        
        let lyricsData;
        if (isLRC) {
            lyricsData = lrcParser.parse(lyricsText);
        } else {
            lyricsData = lrcParser.fromPlainText(lyricsText);
        }
        
        const lyricsEntry = {
            trackId,
            rawText: lyricsText,
            parsedData: lyricsData,
            hasTimestamps: lyricsData.hasTimestamps,
            updatedAt: new Date().toISOString()
        };
        
        await this.db.save('lyrics', lyricsEntry);
        
        // 現在再生中のトラックの歌詞なら即座に反映
        const currentIndex = this.state.get('currentTrackIndex');
        const tracks = this.state.get('tracks');
        if (currentIndex !== -1 && tracks[currentIndex].id === trackId) {
            this.state.setState({ 
                currentLyrics: lyricsText,
                currentLyricsData: lyricsData
            });
            
            // LRC歌詞の場合は自動スクロールを開始
            if (lyricsData.hasTimestamps) {
                this.startLyricsAutoScroll();
            }
        }
        
        this.ui.showNotification(
            isLRC ? '時間同期型歌詞を保存しました' : '歌詞を保存しました',
            'success'
        );
    }

    startLyricsAutoScroll() {
        if (this.lyricsUpdateInterval) {
            clearInterval(this.lyricsUpdateInterval);
        }
        
        const settings = this.state.get('settings');
        if (!settings.lyricsAutoScroll) return;
        
        this.lyricsUpdateInterval = setInterval(() => {
            const currentTime = this.state.get('currentTime');
            const lyricsData = this.state.get('currentLyricsData');
            
            if (lyricsData && lyricsData.hasTimestamps) {
                const currentLine = lrcParser.getCurrentLine(
                    lyricsData.lines,
                    currentTime,
                    0.5
                );
                
                // UIに現在の歌詞行を通知
                if (this.ui && this.ui.updateCurrentLyricsLine) {
                    this.ui.updateCurrentLyricsLine(currentLine);
                }
            }
        }, 250); // 🔴 バグ修正: 100msから250msに変更（パフォーマンス改善）
    }

    stopLyricsAutoScroll() {
        if (this.lyricsUpdateInterval) {
            clearInterval(this.lyricsUpdateInterval);
            this.lyricsUpdateInterval = null;
        }
    }

    async loadLyricsWithLRC(trackId) {
        const lyricsEntry = await this.db.get('lyrics', trackId);
        if (!lyricsEntry) return null;
        
        return {
            rawText: lyricsEntry.rawText,
            parsedData: lyricsEntry.parsedData,
            hasTimestamps: lyricsEntry.hasTimestamps
        };
    }

    // ===== オーディオエフェクト =====
    setReverb(enabled, mix, decay) {
        this.audio.setReverb(enabled, mix, decay);
        this.state.updateSettings({
            reverbEnabled: enabled,
            reverbMix: mix,
            reverbDecay: decay
        });
    }

    setDelay(enabled, time, feedback, mix) {
        this.audio.setDelay(enabled, time, feedback, mix);
        this.state.updateSettings({
            delayEnabled: enabled,
            delayTime: time,
            delayFeedback: feedback,
            delayMix: mix
        });
    }

    setCompressor(enabled, settings) {
        this.audio.setCompressor(enabled, settings);
        this.state.updateSettings({
            compressorEnabled: enabled,
            compressorThreshold: settings.threshold,
            compressorRatio: settings.ratio
        });
    }

    setStereo(enabled, pan, width) {
        this.audio.setStereo(enabled, pan, width);
        this.state.updateSettings({
            stereoEnabled: enabled,
            stereoPan: pan,
            stereoWidth: width
        });
    }

    applyEffectPreset(preset) {
        this.audio.applyEffectPreset(preset);
        this.state.updateSettings({ effectPreset: preset });
        this.ui.showNotification(`エフェクトプリセット「${preset}」を適用しました`, 'success');
    }

    // ===== ビジュアライザー拡張 =====
    setVisualizerStyle(style) {
        if (this.visualizerEngine) {
            this.visualizerEngine.setStyle(style);
            this.state.updateSettings({ visualizerStyle: style });
        }
    }

    setVisualizerColors(primary, secondary, accent) {
        if (this.visualizerEngine) {
            this.visualizerEngine.setColors(primary, secondary, accent);
        }
    }

    // ===== クラウド連携 =====
    async authenticateCloud(provider) {
        try {
            const result = await this.cloudStorage.authenticate(provider);
            if (result.success) {
                const cloudStatus = this.state.get('cloudStatus');
                cloudStatus[provider] = true;
                this.state.setState({ cloudStatus: { ...cloudStatus } });
                this.ui.showNotification(`${provider}に接続しました`, 'success');
            } else {
                this.ui.showNotification(`${provider}の接続に失敗しました`, 'error');
            }
            return result;
        } catch (error) {
            console.error('Cloud authentication error:', error);
            this.ui.showNotification('クラウド接続エラー', 'error');
            return { success: false, message: error.message };
        }
    }

    async backupToCloud() {
        const playlists = this.state.get('playlists');
        try {
            await this.cloudStorage.backupPlaylists(playlists);
            this.ui.showNotification('クラウドにバックアップしました', 'success');
        } catch (error) {
            console.error('Backup error:', error);
            this.ui.showNotification('バックアップに失敗しました', 'error');
        }
    }

    async restoreFromCloud(fileId) {
        try {
            const playlists = await this.cloudStorage.restorePlaylists(fileId);
            if (playlists) {
                this.state.setState({ playlists });
                // データベースに保存
                for (const playlist of playlists) {
                    await this.db.save('playlists', playlist);
                }
                this.ui.showNotification('クラウドから復元しました', 'success');
            }
        } catch (error) {
            console.error('Restore error:', error);
            this.ui.showNotification('復元に失敗しました', 'error');
        }
    }

    // ===== エクスポート/インポート =====
    exportPlaylists() {
        const playlists = this.state.get('playlists');
        dataExporter.exportPlaylists(playlists);
    }

    exportPlayHistory() {
        const playHistory = this.state.get('playHistory');
        dataExporter.exportPlayHistory(playHistory);
    }

    exportStatisticsReport() {
        const statistics = this.state.get('statistics');
        const tracks = this.state.get('tracks');
        dataExporter.exportStatisticsReport(statistics, tracks);
    }

    async exportFullBackup() {
        const data = {
            playlists: this.state.get('playlists'),
            favorites: this.state.get('favorites'),
            settings: this.state.get('settings'),
            bookmarks: this.state.get('bookmarks'),
            tracks: this.state.get('tracks')
        };
        dataExporter.exportFullBackup(data);
    }

    async importBackup(file) {
        try {
            const backup = await dataExporter.importBackup(file);
            
            // データを復元
            this.state.setState({
                playlists: backup.playlists,
                favorites: backup.favorites,
                bookmarks: backup.bookmarks
            });
            
            this.state.updateSettings(backup.settings);
            
            // データベースに保存
            for (const playlist of backup.playlists) {
                await this.db.save('playlists', playlist);
            }
            
            for (const trackId of Array.from(backup.favorites)) {
                await this.db.save('favorites', { trackId });
            }
            
            for (const bookmark of backup.bookmarks) {
                await this.db.save('bookmarks', bookmark);
            }
            
            this.ui.showNotification('バックアップを復元しました', 'success');
        } catch (error) {
            console.error('Import error:', error);
            this.ui.showNotification('インポートに失敗しました', 'error');
        }
    }

    // ===== 設定管理 =====
    async updateSetting(key, value) {
        this.state.updateSettings({ [key]: value });
        await this.saveSettings(this.state.get('settings'));
        
        // 設定に応じた処理を実行
        this.applySettingChange(key, value);
    }

    async updateMultipleSettings(updates) {
        this.state.updateSettings(updates);
        await this.saveSettings(this.state.get('settings'));
        
        // 各設定に応じた処理を実行
        for (const [key, value] of Object.entries(updates)) {
            this.applySettingChange(key, value);
        }
    }

    applySettingChange(key, value) {
        switch (key) {
            case 'visualizerEnabled':
                if (value && this.state.get('isPlaying')) {
                    this.startVisualizer();
                } else {
                    this.stopVisualizer();
                }
                break;
            case 'visualizerStyle':
                this.setVisualizerStyle(value);
                break;
            case 'visualizerQuality':
                if (this.visualizerEngine && typeof this.visualizerEngine.setQuality === 'function') {
                    this.visualizerEngine.setQuality(value);
                }
                document.body.setAttribute('data-visualizer-quality', value);
                break;
            case 'compactDensity':
                document.body.setAttribute('data-density', value);
                break;
            case 'miniPlayerPosition':
                document.body.setAttribute('data-mini-position', value);
                break;
            case 'themeAccent':
                try { document.documentElement.style.setProperty('--theme-accent', value); } catch (e) {}
                break;
            case 'maxVolumeLimit':
                if (this.state.get('volume') > value) this.setVolume(value);
                break;
            case 'lyricsAutoScroll':
                if (value) {
                    this.startLyricsAutoScroll();
                } else {
                    this.stopLyricsAutoScroll();
                }
                break;
            case 'playbackRate':
                this.audio.setPlaybackRate(value);
                break;
            case 'volume':
                this.audio.setVolume(value);
                break;
            // 他の設定項目も同様に処理
        }
    }

    async resetSettings() {
        const defaultSettings = {
            // 基本設定
            theme: 'default',
            language: 'ja',
            
            // 再生設定
            volume: 0.7,
            playbackRate: 1.0,
            isShuffle: false,
            repeatMode: 'none',
            crossfadeEnabled: false,
            crossfadeDuration: 3,
            gaplessEnabled: true,
            backgroundPlayEnabled: true,
            autoPlay: false,
            resumeOnStart: true,
            
            // ビジュアライザー設定
            visualizerEnabled: true,
            visualizerStyle: 'bars',
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
            autoBackupInterval: 7,
            
            // 高度な設定
            audioBufferSize: 2048,
            preloadNext: true,
            hardwareAcceleration: true,
            experimentalFeatures: false,
            
            // 省エネモード設定
            powerSaveMode: false,
            powerSaveProfile: 'balanced',
            reduceCPUWhenInactive: true,
            reduceVisualizerQuality: true,
            singleThreadAudio: false,
            cpuUsageLimit: 50,
        };
        
        this.state.setState({ settings: defaultSettings });
        await this.saveSettings(defaultSettings);
        this.ui.showNotification('✅ すべての設定をリセットしました', 'success');
        console.log('🔧 Settings reset to defaults');
    }

    // 🔴 新規: イコライザーをリセット
    resetEQ() {
        try {
            const defaultEQ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            const settings = this.state.get('settings');
            const newSettings = {
                ...settings,
                eq10Band: [...defaultEQ],
                eqEnabled: false,
                eqPreset: 'flat'
            };
            
            this.state.setState({ settings: newSettings });
            this.audio.applyEQPreset('flat'); // オーディオエンジンにも反映
            this.saveSettings(newSettings);
            this.ui.showNotification('✅ イコライザーをリセットしました', 'success');
            console.log('🎚️ EQ reset to flat');
            return true;
        } catch (error) {
            console.error('❌ EQ reset failed:', error);
            this.ui.showNotification('⚠️ EQ リセットに失敗しました', 'error');
            return false;
        }
    }

    // 🔴 新規: ビジュアライザー設定をリセット
    resetVisualizerSettings() {
        try {
            const settings = this.state.get('settings');
            const newSettings = {
                ...settings,
                visualizerEnabled: true,
                visualizerStyle: 'bars',
                visualizerColor: 'gradient',
                visualizerSensitivity: 1.0,
                visualizerSmoothing: 0.8,
            };
            
            this.state.setState({ settings: newSettings });
            
            // ビジュアライザーを再開始
            this.stopVisualizer();
            if (this.state.get('isPlaying')) {
                this.startVisualizer();
            }
            this.setVisualizerStyle('bars');
            
            this.saveSettings(newSettings);
            this.ui.showNotification('✅ ビジュアライザーをリセットしました', 'success');
            console.log('🎨 Visualizer settings reset to defaults');
            return true;
        } catch (error) {
            console.error('❌ Visualizer reset failed:', error);
            this.ui.showNotification('⚠️ ビジュアライザー リセットに失敗しました', 'error');
            return false;
        }
    }

    // 🔴 新規: すべてのエフェクトをリセット
    resetAllEffects() {
        try {
            const settings = this.state.get('settings');
            const newSettings = {
                ...settings,
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
            };
            
            this.state.setState({ settings: newSettings });
            this.audio.applyEffectPreset('none'); // オーディオエンジンにも反映
            this.saveSettings(newSettings);
            this.ui.showNotification('✅ エフェクトをリセットしました', 'success');
            console.log('🔊 All effects reset to defaults');
            return true;
        } catch (error) {
            console.error('❌ Effects reset failed:', error);
            this.ui.showNotification('⚠️ エフェクト リセットに失敗しました', 'error');
            return false;
        }
    }

    // 🔴 新規: システム完全初期化（すべてを出荷時状態に）
    async fullSystemReset() {
        try {
            console.log('🔄 Starting full system reset...');
            
            // 再生を停止
            this.pause();
            this.stopVisualizer();
            this.clearSleepTimer();
            
            // すべてのリセットを実行
            await this.resetSettings();
            this.resetEQ();
            this.resetVisualizerSettings();
            this.resetAllEffects();
            
            // 状態をリセット
            this.state.setState({
                isShuffle: false,
                repeatMode: 'none',
                currentTrackIndex: -1,
                currentTime: 0,
                volume: 0.7
            });
            
            // AudioEngineもリセット
            this.audio.setVolume(0.7);
            this.audio.clearABRepeat();
            
            this.ui.showNotification('✅ システムを完全にリセットしました', 'success');
            console.log('✅ System fully reset');
            return true;
        } catch (error) {
            console.error('❌ Full system reset failed:', error);
            this.ui.showNotification('⚠️ システム リセットに失敗しました', 'error');
            return false;
        }
    }

    // 🔴 新規: ビジュアライザーの詳細初期化
    initVisualizer() {
        try {
            // ビジュアライザーエンジンが未初期化の場合は初期化
            if (!this.visualizerEngine) {
                const canvas = document.getElementById('visualizerCanvas');
                if (!canvas) {
                    console.warn('⚠️ Canvas element not found');
                    return false;
                }
                
                this.visualizerEngine = new VisualizerEngine(canvas, this.audio);
                console.log('✅ Visualizer engine created');
            }
            
            const settings = this.state.get('settings');
            
            // ビジュアライザー設定を初期化
            this.visualizerEngine.setStyle(settings.visualizerStyle || 'bars');
            
            // 色を初期化（デフォルト）
            this.visualizerEngine.setColors('#3b82f6', '#8b5cf6', '#ec4899');
            
            console.log('✅ Visualizer initialized with defaults');
            return true;
        } catch (error) {
            console.error('❌ Visualizer initialization failed:', error);
            return false;
        }
    }

    // （重複していたクリーンアップは上部の destroy() を使用します）

}

// ===== 🔴 新規: グローバルエラーハンドリングシステム =====

/**
 * エラートラッキング・ロギング管理
 * すべてのエラーを一元管理し、ユーザーフレンドリーなメッセージを表示
 */
class ErrorTracker {
    constructor() {
        this.errors = [];
        this.maxErrors = 50; // 最大保持エラー数
        this.errorMap = new Map(); // エラーコードのマッピング
        this.initErrorMap();
    }

    initErrorMap() {
        // エラーメッセージのマッピング（エラーキーワード → ユーザーメッセージ）
        this.errorMap.set('NotAllowedError', 'ブラウザの設定により操作が拒否されました');
        this.errorMap.set('NotSupportedError', 'このブラウザでは非対応の機能です');
        this.errorMap.set('NotFoundError', '要素またはリソースが見つかりません');
        this.errorMap.set('AbortError', '操作がキャンセルされました');
        this.errorMap.set('TimeoutError', 'タイムアウト: 処理が長すぎます');
        this.errorMap.set('QuotaExceededError', 'ストレージ容量が満杯です');
        this.errorMap.set('NetworkError', 'ネットワーク接続エラーです');
        this.errorMap.set('DataCloneError', 'データ複製エラーが発生しました');
        this.errorMap.set('TypeError', '型エラーが発生しました');
        this.errorMap.set('ReferenceError', '参照エラーが発生しました');
        this.errorMap.set('SyntaxError', '構文エラーが発生しました');
    }

    /**
     * エラーを記録
     */
    track(error, context = {}) {
        const errorRecord = {
            timestamp: new Date().toISOString(),
            message: error?.message || String(error),
            stack: error?.stack || '',
            name: error?.name || 'Unknown',
            context,
            userAgent: navigator.userAgent,
            url: window.location.href,
            id: Date.now() + Math.random()
        };

        this.errors.push(errorRecord);
        
        // 最大数を超えた場合は古いエラーを削除
        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }

        console.error('🔴 [ErrorTracker]', {
            name: errorRecord.name,
            message: errorRecord.message,
            context: errorRecord.context,
            timestamp: errorRecord.timestamp
        });

        return errorRecord;
    }

    /**
     * ユーザーフレンドリーなメッセージを取得
     */
    getUserMessage(error) {
        if (typeof error === 'string') {
            return this.mapErrorMessage(error);
        }

        const errorName = error?.name || '';
        const errorMessage = error?.message || '';

        // 名前でマッピングを試みる
        if (this.errorMap.has(errorName)) {
            return this.errorMap.get(errorName);
        }

        // メッセージ内のキーワードで検索
        for (const [key, value] of this.errorMap) {
            if (errorMessage.includes(key)) {
                return value;
            }
        }

        // デフォルトメッセージ
        return `エラーが発生しました: ${errorMessage || '詳細不明'}`;
    }

    mapErrorMessage(msg) {
        for (const [key, value] of this.errorMap) {
            if (msg.includes(key)) return value;
        }
        return msg;
    }

    /**
     * エラー統計を取得
     */
    getStatistics() {
        const stats = {
            totalErrors: this.errors.length,
            byName: {},
            recent: this.errors.slice(-10)
        };

        this.errors.forEach(err => {
            stats.byName[err.name] = (stats.byName[err.name] || 0) + 1;
        });

        return stats;
    }

    /**
     * エラーログをダウンロード
     */
    downloadLogs() {
        const data = {
            exportedAt: new Date().toISOString(),
            errors: this.errors,
            statistics: this.getStatistics()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `harmonia-error-logs-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * エラージャーナルをクリア
     */
    clear() {
        this.errors = [];
    }
}

// グローバルエラートラッカーインスタンス
const errorTracker = new ErrorTracker();

/**
 * グローバルエラーハンドラー
 */
window.addEventListener('error', (event) => {
    const error = event.error || new Error(event.message);
    const errorRecord = errorTracker.track(error, {
        source: 'uncaught-exception',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
    });

    // UI通知（app.ui が制御されている場合）
    if (window.harmonia?.ui) {
        const userMsg = errorTracker.getUserMessage(error);
        window.harmonia.ui.showNotification(`⚠️ ${userMsg}`, 'error');
    }

    // エラーの送信を防止（ブラウザのデフォルト処理をスキップ）
    event.preventDefault?.();
});

/**
 * 未処理のPromise拒否ハンドラー
 */
window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason || new Error('Unknown rejection');
    const errorRecord = errorTracker.track(error, {
        source: 'unhandled-promise-rejection',
        promise: event.promise
    });

    // UI通知
    if (window.harmonia?.ui) {
        const userMsg = errorTracker.getUserMessage(error);
        window.harmonia.ui.showNotification(`⚠️ 非同期エラー: ${userMsg}`, 'error');
    }

    // event.preventDefault を呼び出してエラーを処理済みにマーク
    event.preventDefault?.();
});

// ===== アプリケーション起動 =====
const app = new HarmoniaApp();

// 🔴 バグ修正: app を window に割り当てる（ES6モジュール内での グローバルアクセス）
window.harmonia = app;
window.harmonia.errorTracker = errorTracker;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        await app.init();
        console.log('✅ Harmonia initialized successfully');
        console.log('🎵 Background playback manager:', app.backgroundPlaybackManager ? '✅ Active' : '❌ Inactive');
        console.log('🔴 Error tracking system:', '✅ Active');
    } catch (error) {
        const errorRecord = errorTracker.track(error, { source: 'initialization' });
        console.error('❌ Failed to initialize Harmonia:', error);
        window.harmonia?.ui?.showNotification?.(`初期化エラー: ${errorTracker.getUserMessage(error)}`, 'error');
    }
});

export default HarmoniaApp;
