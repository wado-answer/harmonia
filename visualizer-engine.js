// 拡張ビジュアライザーシステム - 複数スタイル対応
export class VisualizerEngine {
    constructor(canvas, audioEngine) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
        this.audioEngine = audioEngine;
        this.animationId = null;
        this.resizeObserver = null;
        this.currentStyle = 'bars';
        this.colors = {
            primary: '#3b82f6',
            secondary: '#8b5cf6',
            accent: '#ec4899'
        };
    }

    setColors(primary, secondary, accent) {
        this.colors = { primary, secondary, accent };
    }

    setStyle(style) {
        this.currentStyle = style;
    }

    // クオリティ設定: 'low' | 'medium' | 'high'
    setQuality(quality) {
        this.quality = quality || 'high';

        // オーディオアナライザの設定を適用
        try {
            if (this.audioEngine && this.audioEngine.nodes && this.audioEngine.nodes.analyser) {
                const analyser = this.audioEngine.nodes.analyser;
                switch (this.quality) {
                    case 'low':
                        analyser.fftSize = 512;
                        analyser.smoothingTimeConstant = 0.6;
                        break;
                    case 'medium':
                        analyser.fftSize = 1024;
                        analyser.smoothingTimeConstant = 0.75;
                        break;
                    default:
                        analyser.fftSize = 2048;
                        analyser.smoothingTimeConstant = 0.85;
                }

                // 更新されるバッファサイズに基づき内部配列を再確保
                const freqCount = analyser.frequencyBinCount;
                this.audioEngine.visualizerData = new Uint8Array(freqCount);
                this.audioEngine.frequencyData = new Uint8Array(freqCount);
                this.audioEngine.timeDomainData = new Uint8Array(analyser.fftSize);
            }
        } catch (e) {
            console.warn('Visualizer.setQuality: failed to apply analyser settings', e);
        }
    }

    start() {
        if (!this.canvas || !this.ctx || !this.audioEngine) {
            console.warn('Visualizer: Missing required components');
            return;
        }
        
        this.stop();
        
        // キャンバスの解像度を調整（高DPI/Retina対応）
        this._adjustCanvasResolution();
        
        // リサイズ監視を設定
        this._setupResizeObserver();
        
        const render = () => {
            try {
            switch (this.currentStyle) {
                case 'bars':
                    this.renderBars();
                    break;
                case 'circular':
                    this.renderCircular();
                    break;
                case 'waveform':
                    this.renderWaveform();
                    break;
                case 'spectrum':
                    this.renderSpectrum();
                    break;
                case 'particles':
                    this.renderParticles();
                    break;
                case 'radial':
                    this.renderRadial();
                    break;
                case 'mirror':
                    this.renderMirror();
                    break;
                default:
                    this.renderBars();
            }
            
                this.animationId = requestAnimationFrame(render);
            } catch (error) {
                console.error('Visualizer render error:', error);
                this.stop();
            }
        };
        
        render();
        console.log('🎨 Visualizer started');
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // 🔧 バグ修正: キャンバス解像度調整メソッド実装
    _adjustCanvasResolution() {
        if (!this.canvas || !this.ctx) return;

        const parent = this.canvas.parentElement;
        if (!parent) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        
        // コンテナの実際のサイズを取得
        const width = rect.width;
        const height = rect.height;

        // キャンバスの内部解像度（高DPI対応）
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        // CSSのサイズ
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        // キャンバスコンテキストの変換をリセットしてからスケーリング（累積スケーリング防止）
        if (typeof this.ctx.resetTransform === 'function') {
            this.ctx.resetTransform();
        } else {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // CSSピクセルでの描画のために保存
        this.cssWidth = width;
        this.cssHeight = height;
        this.dpr = dpr;
    }

    // ✨ 新機能: リサイズ監視の設定
    _setupResizeObserver() {
        if (!this.canvas || typeof ResizeObserver === 'undefined') return;

        const parent = this.canvas.parentElement;
        if (!parent) return;

        this.resizeObserver = new ResizeObserver(() => {
            this._adjustCanvasResolution();
        });

        this.resizeObserver.observe(parent);
    }

    // スタイル1: 標準バー（改良版）
    renderBars() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);

        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillRect(0, 0, width, height);

        const barCount = 64;
        const barWidth = width / barCount;
        const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, this.colors.primary);
        gradient.addColorStop(0.5, this.colors.secondary);
        gradient.addColorStop(1, this.colors.accent);

        for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor(i * data.length / barCount);
            const barHeight = (data[dataIndex] / 255) * height * 0.8;
            
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(
                i * barWidth + 1,
                height - barHeight,
                barWidth - 2,
                barHeight
            );
        }
    }

    // スタイル2: 円形ビジュアライザー
    renderCircular() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.3;
        
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.fillRect(0, 0, width, height);

        const barCount = 128;
        const angleStep = (Math.PI * 2) / barCount;

        for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor(i * data.length / barCount);
            const value = data[dataIndex] / 255;
            const barHeight = value * radius * 0.8;
            const angle = i * angleStep;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            const hue = (i / barCount) * 360;
            this.ctx.strokeStyle = `hsl(${hue}, 70%, 60%)`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        }
    }

    // スタイル3: 波形表示
    renderWaveform() {
        const data = this.audioEngine.getTimeDomainData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.colors.primary;
        this.ctx.beginPath();

        const sliceWidth = width / data.length;
        let x = 0;

        for (let i = 0; i < data.length; i++) {
            const v = data[i] / 128.0;
            const y = v * height / 2;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        this.ctx.lineTo(width, height / 2);
        this.ctx.stroke();
    }

    // スタイル4: スペクトラムアナライザー
    renderSpectrum() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.fillRect(0, 0, width, height);

        const barCount = 128;
        const barWidth = width / barCount;

        for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor(i * data.length / barCount);
            const value = data[dataIndex] / 255;
            const barHeight = value * height;

            const hue = 200 + (value * 60);
            const saturation = 70 + (value * 30);
            this.ctx.fillStyle = `hsl(${hue}, ${saturation}%, 60%)`;
            
            this.ctx.fillRect(
                i * barWidth,
                height - barHeight,
                barWidth - 1,
                barHeight
            );
        }
    }

    // スタイル5: パーティクル
    renderParticles() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);
        
        // 半透明の背景で軌跡効果
        this.ctx.fillStyle = 'rgba(30, 41, 59, 0.1)';
        this.ctx.fillRect(0, 0, width, height);

        const particleCount = 50;
        
        for (let i = 0; i < particleCount; i++) {
            const dataIndex = Math.floor(i * data.length / particleCount);
            const value = data[dataIndex] / 255;
            
            const x = (i / particleCount) * width;
            const y = height / 2 + (Math.random() - 0.5) * value * height;
            const size = 2 + value * 8;

            const hue = (i / particleCount) * 360;
            this.ctx.fillStyle = `hsla(${hue}, 70%, 60%, ${value})`;
            this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    // スタイル6: 放射状
    renderRadial() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);
        const centerX = width / 2;
        const centerY = height / 2;
        
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.fillRect(0, 0, width, height);

        const rayCount = 32;
        const angleStep = (Math.PI * 2) / rayCount;

        for (let i = 0; i < rayCount; i++) {
            const dataIndex = Math.floor(i * data.length / rayCount);
            const value = data[dataIndex] / 255;
            const rayLength = value * Math.min(width, height) * 0.4;
            const angle = i * angleStep;

            const x = centerX + Math.cos(angle) * rayLength;
            const y = centerY + Math.sin(angle) * rayLength;

            const gradient = this.ctx.createLinearGradient(centerX, centerY, x, y);
            gradient.addColorStop(0, this.colors.primary);
            gradient.addColorStop(1, `${this.colors.accent}00`);

            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = 4;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        }
    }

    // スタイル7: ミラー効果
    renderMirror() {
        const data = this.audioEngine.getFrequencyData();
        if (!data) return;

        const dpr = this.dpr || (window.devicePixelRatio || 1);
        const width = this.cssWidth || (this.canvas.width / dpr);
        const height = this.cssHeight || (this.canvas.height / dpr);
        
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#1e293b';
        this.ctx.fillRect(0, 0, width, height);

        const barCount = 64;
        const barWidth = width / (barCount * 2);
        const centerY = height / 2;
        const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, this.colors.accent);
        gradient.addColorStop(0.5, this.colors.primary);
        gradient.addColorStop(1, this.colors.accent);

        for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor(i * data.length / barCount);
            const barHeight = (data[dataIndex] / 255) * height * 0.4;
            const x = width / 2 + (i - barCount / 2) * barWidth;

            this.ctx.fillStyle = gradient;
            
            // 上半分
            this.ctx.fillRect(
                x,
                centerY - barHeight,
                barWidth - 2,
                barHeight
            );
            
            // 下半分（ミラー）
            this.ctx.fillRect(
                x,
                centerY,
                barWidth - 2,
                barHeight
            );
        }
    }

    // ビジュアライザースタイル一覧を取得
    static getAvailableStyles() {
        return [
            { id: 'bars', name: '標準バー', description: '縦棒グラフスタイル' },
            { id: 'circular', name: '円形', description: '円形に広がる視覚効果' },
            { id: 'waveform', name: '波形', description: 'オーディオ波形を表示' },
            { id: 'spectrum', name: 'スペクトラム', description: '周波数スペクトラム' },
            { id: 'particles', name: 'パーティクル', description: '粒子効果' },
            { id: 'radial', name: '放射状', description: '中心から放射する光線' },
            { id: 'mirror', name: 'ミラー', description: '上下対称の鏡効果' }
        ];
    }
}

export const visualizerEngine = VisualizerEngine;
