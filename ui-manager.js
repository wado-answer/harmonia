// UI管理モジュール
export class UIManager {
    constructor(stateManager) {
        this.state = stateManager;
        this.elements = {};
        this.renderedItems = new Map(); // 差分レンダリング用キャッシュ
        this.animationFrameId = null;
        
        // 🔴 バグ修正: イベントリスナーのメモリリーク対策
        this.eventListeners = [];
    }

    init() {
        this._cacheElements();
        this._setupEventListeners();
        console.log('🎨 UI Manager initialized');
    }

    _cacheElements() {
        // 要素をキャッシュ（頻繁にアクセスする要素）
        this.elements = {
            // ビュー
            libraryView: document.getElementById('libraryView'),
            favoritesView: document.getElementById('favoritesView'),
            playlistsView: document.getElementById('playlistsView'),
            queueView: document.getElementById('queueView'),
            
            // リスト
            trackList: document.getElementById('trackList'),
            favoritesList: document.getElementById('favoritesList'),
            queueList: document.getElementById('queueList'),
            playlistsContainer: document.getElementById('playlistsContainer'),
            
            // プレイヤー
            nowPlayingArtwork: document.getElementById('nowPlayingArtwork'),
            nowPlayingTitle: document.getElementById('nowPlayingTitle'),
            nowPlayingArtist: document.getElementById('nowPlayingArtist'),
            playBtn: document.getElementById('playBtn'),
            progressBar: document.getElementById('progressBar'),
            currentTime: document.getElementById('currentTime'),
            duration: document.getElementById('duration'),
            volumeFill: document.getElementById('volumeFill'),
            volumeIcon: document.getElementById('volumeIcon'),
            
            // コントロール
            shuffleBtn: document.getElementById('shuffleBtn'),
            repeatBtn: document.getElementById('repeatBtn'),
            
            // ビジュアライザー
            visualizerCanvas: document.getElementById('visualizerCanvas'),
            
            // 検索
            searchInput: document.getElementById('searchInput'),
            
            // モーダル
            uploadModal: document.getElementById('uploadModal'),
            settingsModal: document.getElementById('settingsModal')
        };
    }

    _setupEventListeners() {
        // グローバルキーボードショートカット
        const keyboardHandler = (e) => this._handleKeyboard(e);
        document.addEventListener('keydown', keyboardHandler);
        this.eventListeners.push({ element: document, event: 'keydown', handler: keyboardHandler });
        
        // プログレスバーのシーク
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            const seekHandler = (e) => this._handleSeek(e);
            progressContainer.addEventListener('click', seekHandler);
            this.eventListeners.push({ element: progressContainer, event: 'click', handler: seekHandler });
        }
        
        // 音量スライダー
        const volumeSlider = document.querySelector('.volume-slider');
        if (volumeSlider) {
            const volumeHandler = (e) => this._handleVolumeChange(e);
            volumeSlider.addEventListener('click', volumeHandler);
            this.eventListeners.push({ element: volumeSlider, event: 'click', handler: volumeHandler });
        }
    }

    _handleKeyboard(e) {
        // 入力フィールド内では無視
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        const callbacks = {
            ' ': () => this._emit('togglePlay'),
            'ArrowLeft': () => this._emit('seek', -10),
            'ArrowRight': () => this._emit('seek', 10),
            'ArrowUp': () => this._emit('volumeChange', 0.1),
            'ArrowDown': () => this._emit('volumeChange', -0.1)
        };

        const callback = callbacks[e.key];
        if (callback) {
            e.preventDefault();
            callback();
        }
    }

    _handleSeek(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this._emit('seekToPercent', percent);
    }

    _handleVolumeChange(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this._emit('setVolume', percent);
    }

    // イベントエミッター
    _emit(event, data) {
        const customEvent = new CustomEvent(`harmonia:${event}`, { detail: data });
        document.dispatchEvent(customEvent);
    }

    // トラックリストのレンダリング（差分レンダリング対応）
    renderTracks(tracks, currentTrackIndex, favorites) {
        if (!this.elements.trackList) return;

        if (tracks.length === 0) {
            this._renderEmptyState(this.elements.trackList, {
                icon: '🎵',
                message: 'トラックがありません',
                hint: 'ファイルをアップロードしてください'
            });
            return;
        }

        // 仮想DOMのような差分レンダリング
        const fragment = document.createDocumentFragment();
        const newRenderedItems = new Map();

        tracks.forEach((track, index) => {
            const actualIndex = this.state.get('tracks').indexOf(track);
            const key = `track-${track.id}`;
            
            let element = this.renderedItems.get(key);
            
            // 既存の要素があり、状態が変わっていなければ再利用
            if (element && 
                element.dataset.playing === (actualIndex === currentTrackIndex).toString() &&
                element.dataset.favorite === favorites.has(track.id).toString()) {
                newRenderedItems.set(key, element);
                fragment.appendChild(element);
                return;
            }

            // 新しい要素を作成
            element = this._createTrackElement(track, actualIndex, currentTrackIndex, favorites);
            element.dataset.trackId = track.id;
            element.dataset.playing = (actualIndex === currentTrackIndex).toString();
            element.dataset.favorite = favorites.has(track.id).toString();
            
            newRenderedItems.set(key, element);
            fragment.appendChild(element);
        });

        this.renderedItems = newRenderedItems;
        
        // 一度にDOMを更新（リフロー最小化）
        this.elements.trackList.textContent = '';
        this.elements.trackList.appendChild(fragment);
    }

    _createTrackElement(track, actualIndex, currentTrackIndex, favorites) {
        const isPlaying = actualIndex === currentTrackIndex;
        const isFavorite = favorites.has(track.id);

        const button = document.createElement('button');
        button.className = 'track-item';
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', `再生: ${track.title || track.name}`);
        
        if (isPlaying) {
            button.classList.add('playing');
            button.setAttribute('aria-current', 'true');
        }

        // アートワークまたはアイコン
        const coverDiv = document.createElement('div');
        if (track.artwork) {
            const img = document.createElement('img');
            img.src = track.artwork;
            img.alt = 'アートワーク';
            img.className = 'track-cover-img';
            img.loading = 'lazy'; // 遅延読み込み
            coverDiv.appendChild(img);
        } else {
            coverDiv.className = 'track-cover';
            coverDiv.textContent = this._getCategoryIcon(track.category);
        }

        // トラック情報
        const infoDiv = document.createElement('div');
        infoDiv.className = 'track-info';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'track-name';
        nameDiv.textContent = track.title || track.name; // XSS対策でtextContent使用
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'track-meta';
        metaDiv.textContent = `${track.artist || track.category} • ${this._formatTime(track.duration)}`;
        
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);

        // アクション
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'track-actions';
        
        // お気に入りボタン
        const favoriteBtn = this._createIconButton(
            isFavorite ? '❤️' : '🤍',
            isFavorite ? 'お気に入りから削除' : 'お気に入りに追加',
            () => this._emit('toggleFavorite', track.id)
        );
        if (isFavorite) favoriteBtn.classList.add('active');
        
        // キューに追加ボタン
        const queueBtn = this._createIconButton(
            '➕',
            'キューに追加',
            () => this._emit('addToQueue', track.id)
        );
        
        // 次に再生ボタン
        const nextBtn = this._createIconButton(
            '⏭',
            '次に再生',
            () => this._emit('playNext', track.id)
        );
        
        // 🗑️ 削除ボタン（新機能）
        const deleteBtn = this._createIconButton(
            '🗑️',
            'トラック削除',
            () => {
                if (confirm(`「${track.title || 'トラック'}」を削除してもよろしいですか？`)) {
                    this._emit('deleteTrack', track.id);
                }
            }
        );
        deleteBtn.style.color = '#ef4444';
        
        actionsDiv.appendChild(favoriteBtn);
        actionsDiv.appendChild(queueBtn);
        actionsDiv.appendChild(nextBtn);
        actionsDiv.appendChild(deleteBtn);

        button.appendChild(coverDiv);
        button.appendChild(infoDiv);
        button.appendChild(actionsDiv);

        // クリックイベント（アクション以外）
        button.addEventListener('click', (e) => {
            if (!e.target.closest('.track-actions')) {
                this._emit('playTrack', actualIndex);
            }
        });

        return button;
    }

    _createIconButton(icon, label, onClick) {
        const button = document.createElement('button');
        button.className = 'icon-btn';
        button.textContent = icon;
        button.setAttribute('aria-label', label);
        button.setAttribute('type', 'button');
        
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        
        return button;
    }

    // キューのレンダリング
    renderQueue(queue, tracks) {
        if (!this.elements.queueList) return;

        if (queue.length === 0) {
            this._renderEmptyState(this.elements.queueList, {
                icon: '🎵',
                message: 'キューは空です',
                hint: 'トラックを右クリックして「キューに追加」を選択'
            });
            return;
        }

        const fragment = document.createDocumentFragment();

        queue.forEach((trackId, index) => {
            const track = tracks.find(t => t.id === trackId);
            if (!track) return;

            const element = this._createQueueElement(track, index);
            fragment.appendChild(element);
        });

        this.elements.queueList.textContent = '';
        this.elements.queueList.appendChild(fragment);

        // ドラッグ&ドロップを設定
        this._setupQueueDragDrop();
    }

    _createQueueElement(track, index) {
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.draggable = true;
        div.dataset.index = index;

        const dragHandle = document.createElement('div');
        dragHandle.className = 'queue-drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.setAttribute('aria-label', 'ドラッグして並び替え');

        const coverDiv = document.createElement('div');
        if (track.artwork) {
            const img = document.createElement('img');
            img.src = track.artwork;
            img.alt = 'アートワーク';
            img.className = 'track-cover-img';
            img.loading = 'lazy';
            coverDiv.appendChild(img);
        } else {
            coverDiv.className = 'track-cover';
            coverDiv.textContent = this._getCategoryIcon(track.category);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'track-info';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'track-name';
        nameDiv.textContent = track.title || track.name;
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'track-meta';
        metaDiv.textContent = `${track.artist || track.category} • ${this._formatTime(track.duration)}`;
        
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);

        const removeBtn = this._createIconButton(
            '✕',
            'キューから削除',
            () => this._emit('removeFromQueue', index)
        );

        div.appendChild(dragHandle);
        div.appendChild(coverDiv);
        div.appendChild(infoDiv);
        div.appendChild(removeBtn);

        return div;
    }

    _setupQueueDragDrop() {
        const items = this.elements.queueList.querySelectorAll('.queue-item');
        let draggedElement = null;
        let draggedIndex = null;

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedElement = item;
                draggedIndex = parseInt(item.dataset.index);
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedElement = null;
                draggedIndex = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (draggedElement && draggedElement !== item) {
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    if (e.clientY < midpoint) {
                        item.parentNode.insertBefore(draggedElement, item);
                    } else {
                        item.parentNode.insertBefore(draggedElement, item.nextSibling);
                    }
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedIndex !== null) {
                    const items = Array.from(this.elements.queueList.querySelectorAll('.queue-item'));
                    const newIndex = items.indexOf(draggedElement);
                    
                    if (newIndex !== -1 && newIndex !== draggedIndex) {
                        this._emit('reorderQueue', { fromIndex: draggedIndex, toIndex: newIndex });
                    }
                }
            });
        });
    }

    // お気に入りのレンダリング
    renderFavorites(tracks, currentTrackIndex, favorites) {
        if (!this.elements.favoritesList) return;

        const favoriteTracks = tracks.filter(t => favorites.has(t.id));

        if (favoriteTracks.length === 0) {
            this._renderEmptyState(this.elements.favoritesList, {
                icon: '❤️',
                message: 'お気に入りがありません',
                hint: 'トラックをお気に入りに追加してください'
            });
            return;
        }

        const fragment = document.createDocumentFragment();

        favoriteTracks.forEach(track => {
            const actualIndex = tracks.indexOf(track);
            const element = this._createTrackElement(track, actualIndex, currentTrackIndex, favorites);
            fragment.appendChild(element);
        });

        this.elements.favoritesList.textContent = '';
        this.elements.favoritesList.appendChild(fragment);
    }

    // プレイヤーUIの更新
    updateNowPlaying(track) {
        if (!track) {
            if (this.elements.nowPlayingTitle) {
                this.elements.nowPlayingTitle.textContent = 'トラックが選択されていません';
            }
            if (this.elements.nowPlayingArtist) {
                this.elements.nowPlayingArtist.textContent = 'アーティスト';
            }
            if (this.elements.nowPlayingArtwork) {
                this.elements.nowPlayingArtwork.textContent = '🎵';
            }
            return;
        }

        if (this.elements.nowPlayingTitle) {
            this.elements.nowPlayingTitle.textContent = track.title || track.name;
        }
        
        if (this.elements.nowPlayingArtist) {
            this.elements.nowPlayingArtist.textContent = track.artist || track.category;
        }
        
        if (this.elements.nowPlayingArtwork) {
            if (track.artwork) {
                const img = document.createElement('img');
                img.src = track.artwork;
                img.alt = track.title || track.name;
                this.elements.nowPlayingArtwork.textContent = '';
                this.elements.nowPlayingArtwork.appendChild(img);
            } else {
                this.elements.nowPlayingArtwork.textContent = this._getCategoryIcon(track.category);
            }
        }
    }

    updatePlayButton(isPlaying) {
        if (this.elements.playBtn) {
            this.elements.playBtn.textContent = isPlaying ? '⏸' : '▶';
            this.elements.playBtn.setAttribute('aria-label', isPlaying ? '一時停止' : '再生');
        }
    }

    updateProgress(currentTime, duration) {
        if (this.elements.progressBar) {
            const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
            this.elements.progressBar.style.width = `${percent}%`;
        }
        
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this._formatTime(currentTime);
        }
        
        if (this.elements.duration) {
            this.elements.duration.textContent = this._formatTime(duration);
        }
    }

    updateVolume(volume) {
        if (this.elements.volumeFill) {
            this.elements.volumeFill.style.width = `${volume * 100}%`;
        }
        
        if (this.elements.volumeIcon) {
            this.elements.volumeIcon.textContent = volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊';
        }
    }

    updateShuffleButton(isShuffle) {
        if (this.elements.shuffleBtn) {
            this.elements.shuffleBtn.classList.toggle('active', isShuffle);
            this.elements.shuffleBtn.setAttribute('aria-pressed', isShuffle);
        }
    }

    updateRepeatButton(repeatMode) {
        if (this.elements.repeatBtn) {
            const isActive = repeatMode !== 'none';
            this.elements.repeatBtn.classList.toggle('active', isActive);
            this.elements.repeatBtn.setAttribute('aria-pressed', isActive);
            
            // アイコンを変更
            if (repeatMode === 'one') {
                this.elements.repeatBtn.textContent = '🔂';
            } else {
                this.elements.repeatBtn.textContent = '🔁';
            }
        }
    }

    // ビジュアライザーのレンダリング
    renderVisualizer(data) {
        const canvas = this.elements.visualizerCanvas;
        if (!canvas || !data) return;

        // requestAnimationFrameで最適化
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        this.animationFrameId = requestAnimationFrame(() => {
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;

            // クリア
            ctx.fillStyle = getComputedStyle(canvas).backgroundColor || '#334155';
            ctx.fillRect(0, 0, width, height);

            // バーの描画
            const barWidth = (width / data.length) * 2.5;
            let x = 0;

            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            const primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--theme-primary').trim();
            const secondaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--theme-secondary').trim();
            const accentColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--theme-accent').trim();

            gradient.addColorStop(0, primaryColor);
            gradient.addColorStop(0.5, secondaryColor);
            gradient.addColorStop(1, accentColor);

            for (let i = 0; i < data.length; i++) {
                const barHeight = (data[i] / 255) * height;
                
                ctx.fillStyle = gradient;
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);
                
                x += barWidth + 1;
            }
        });
    }

    stopVisualizer() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // キャンバスをクリア
        const canvas = this.elements.visualizerCanvas;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // 通知表示
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'polite');

        const content = document.createElement('div');
        content.className = 'notification-content';
        
        const text = document.createElement('p');
        text.textContent = message; // XSS対策
        
        content.appendChild(text);
        notification.appendChild(content);
        document.body.appendChild(notification);

        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // 空状態のレンダリング
    _renderEmptyState(container, { icon, message, hint }) {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.setAttribute('role', 'status');

        const iconDiv = document.createElement('div');
        iconDiv.className = 'empty-state-icon';
        iconDiv.textContent = icon;

        const messageP = document.createElement('p');
        messageP.textContent = message;

        const hintSmall = document.createElement('small');
        hintSmall.textContent = hint;

        div.appendChild(iconDiv);
        div.appendChild(messageP);
        div.appendChild(hintSmall);

        container.textContent = '';
        container.appendChild(div);
    }

    // モーダル操作
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            
            // フォーカストラップ
            const focusableElements = modal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusableElements.length > 0) {
                focusableElements[0].focus();
            }
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    // ビュー切り替え
    switchView(viewName) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.add('active');
        }

        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-current', 'false');
        });

        const activeItem = document.querySelector(`.sidebar-item[data-view="${viewName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
            activeItem.setAttribute('aria-current', 'page');
        }
    }

    // ユーティリティ
    _formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    _getCategoryIcon(category) {
        const lower = (category || '').toLowerCase();
        const icons = {
            'classical': '🎻', 'クラシック': '🎻',
            'jazz': '🎷', 'ジャズ': '🎷',
            'rock': '🎸', 'ロック': '🎸',
            'pop': '🎤', 'ポップ': '🎤',
            'electronic': '🎹', 'エレクトロニック': '🎹',
            'ambient': '🌊', 'アンビエント': '🌊'
        };

        for (const [key, icon] of Object.entries(icons)) {
            if (lower.includes(key)) return icon;
        }
        
        return '🎵';
    }

    // クリーンアップ
    destroy() {
        // 🔴 バグ修正: イベントリスナーを削除
        this.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners = [];
        
        this.stopVisualizer();
        this.renderedItems.clear();
        console.log('🧹 UI Manager cleaned up');
    }
}

export const createUIManager = (stateManager) => new UIManager(stateManager);
