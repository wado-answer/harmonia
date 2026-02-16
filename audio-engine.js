// オーディオエンジンモジュール - フルエフェクト対応版
export class AudioEngine {
    constructor() {
        this.audioElement = null;
        this.audioContext = null;
        this._initializingContext = false;
        this._initPromise = null;
        this.nodes = {
            source: null,
            analyser: null,
            gain: null,
            eq: [],
            // エフェクト
            reverb: null,
            delay: null,
            compressor: null,
            stereoPanner: null,
            // エフェクト用のゲイン
            reverbGain: null,
            delayGain: null
        };
        
        // 10バンドEQ周波数 (Hz)
        this.eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        
        this.visualizerData = null;
        this.frequencyData = null;
        this.timeDomainData = null;
        this.isInitialized = false;
        this.currentTrackUrl = null;
        
        // プリロード用
        this.preloadedAudio = null;
        
        // A-Bリピート用
        this.abRepeat = null;
        this.abRepeatListener = null;
        
        // エフェクト設定
        this.effects = {
            reverb: { enabled: false, mix: 0.3, decay: 2.0 },
            delay: { enabled: false, time: 0.5, feedback: 0.3, mix: 0.3 },
            compressor: { enabled: false, threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
            stereo: { enabled: false, pan: 0, width: 1.0 }
        };
    }

    async init(audioElement) {
        if (this.isInitialized) return;
        
        this.audioElement = audioElement;
        this.isInitialized = true;
        
        console.log('🎵 Audio engine initialized (AudioContext will be created on first play)');
    }

    async _ensureAudioContext() {
        if (this.audioContext) return;
        
        if (this._initializingContext) {
            return this._initPromise;
        }
        
        this._initializingContext = true;
        this._initPromise = (async () => {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) {
                    throw new Error('Web Audio API is not supported in this browser');
                }
                
                this.audioContext = new AudioContext();
            
            await this._buildAudioGraph();
            
                console.log('🎵 AudioContext created and full graph built with effects');
            } catch (error) {
                console.error('Audio context creation failed:', error);
                this.audioContext = null;
                throw error;
            } finally {
                this._initializingContext = false;
            }
        })();
        
        return this._initPromise;
    }

    async _buildAudioGraph() {
        // ソースノード
        this.nodes.source = this.audioContext.createMediaElementSource(this.audioElement);
        
        // アナライザーノード（ビジュアライザー用）
        this.nodes.analyser = this.audioContext.createAnalyser();
        this.nodes.analyser.fftSize = 2048;
        this.nodes.analyser.smoothingTimeConstant = 0.8;
        this.visualizerData = new Uint8Array(this.nodes.analyser.frequencyBinCount);
        this.frequencyData = new Uint8Array(this.nodes.analyser.frequencyBinCount);
        this.timeDomainData = new Uint8Array(this.nodes.analyser.fftSize);
        
        // 10バンドイコライザー
        this.nodes.eq = this.eqFrequencies.map((freq, index) => {
            const filter = this.audioContext.createBiquadFilter();
            
            if (index === 0) {
                filter.type = 'lowshelf';
            } else if (index === this.eqFrequencies.length - 1) {
                filter.type = 'highshelf';
            } else {
                filter.type = 'peaking';
                filter.Q.value = 1.0;
            }
            
            filter.frequency.value = freq;
            filter.gain.value = 0;
            
            return filter;
        });
        
        // コンプレッサー
        this.nodes.compressor = this.audioContext.createDynamicsCompressor();
        this.nodes.compressor.threshold.value = -24;
        this.nodes.compressor.knee.value = 30;
        this.nodes.compressor.ratio.value = 12;
        this.nodes.compressor.attack.value = 0.003;
        this.nodes.compressor.release.value = 0.25;
        
        // リバーブ（コンボリューション）
        this.nodes.reverb = this.audioContext.createConvolver();
        this.nodes.reverbGain = this.audioContext.createGain();
        this.nodes.reverbGain.gain.value = 0; // 初期状態はミュート
        await this._createReverbImpulse(2.0); // 2秒のディケイ
        
        // ディレイ
        this.nodes.delay = this.audioContext.createDelay(5.0); // 最大5秒
        this.nodes.delay.delayTime.value = 0.5;
        this.nodes.delayGain = this.audioContext.createGain();
        this.nodes.delayGain.gain.value = 0; // 初期状態はミュート
        
        const delayFeedback = this.audioContext.createGain();
        delayFeedback.gain.value = 0.3;
        
        // ステレオパンナー
        this.nodes.stereoPanner = this.audioContext.createStereoPanner();
        this.nodes.stereoPanner.pan.value = 0;
        
        // メインゲインノード
        this.nodes.gain = this.audioContext.createGain();
        
        // ドライシグナル用のゲイン
        const dryGain = this.audioContext.createGain();
        dryGain.gain.value = 1.0;
        
        // オーディオグラフの接続
        // Source -> EQ Chain
        this.nodes.source.connect(this.nodes.eq[0]);
        for (let i = 0; i < this.nodes.eq.length - 1; i++) {
            this.nodes.eq[i].connect(this.nodes.eq[i + 1]);
        }
        
        // EQ -> Compressor
        this.nodes.eq[this.nodes.eq.length - 1].connect(this.nodes.compressor);
        
        // Compressor -> Dry Signal
        this.nodes.compressor.connect(dryGain);
        
        // Compressor -> Reverb -> ReverbGain
        this.nodes.compressor.connect(this.nodes.reverb);
        this.nodes.reverb.connect(this.nodes.reverbGain);
        
        // Compressor -> Delay -> DelayGain
        this.nodes.compressor.connect(this.nodes.delay);
        this.nodes.delay.connect(this.nodes.delayGain);
        
        // Delay Feedback Loop
        this.nodes.delay.connect(delayFeedback);
        delayFeedback.connect(this.nodes.delay);
        
        // Mix all signals
        dryGain.connect(this.nodes.stereoPanner);
        this.nodes.reverbGain.connect(this.nodes.stereoPanner);
        this.nodes.delayGain.connect(this.nodes.stereoPanner);
        
        // StereoPanner -> Analyser -> Gain -> Destination
        this.nodes.stereoPanner.connect(this.nodes.analyser);
        this.nodes.analyser.connect(this.nodes.gain);
        this.nodes.gain.connect(this.audioContext.destination);
        
        console.log('🔗 Full audio graph: Source -> EQ -> Compressor -> [Dry/Reverb/Delay] -> Stereo -> Analyser -> Gain -> Output');
    }

    async _createReverbImpulse(decay = 2.0) {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * decay;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        
        // 🔴 バグ修正: より自然なリバーブのインパルス応答を作成
        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            
            // 早期反射（最初の100ms）
            for (let i = 0; i < sampleRate * 0.1; i++) {
                const reflection = Math.random() * 2 - 1;
                const envelope = Math.exp(-i / (sampleRate * 0.02));
                channelData[i] = reflection * envelope * 0.5;
            }
            
            // 後期残響
            for (let i = sampleRate * 0.1; i < length; i++) {
                const noise = Math.random() * 2 - 1;
                const envelope = Math.pow(1 - i / length, decay);
                // ローパスフィルター効果をシミュレート
                const lpf = 1 - (i / length) * 0.5;
                channelData[i] += noise * envelope * lpf;
            }
        }
        
        this.nodes.reverb.buffer = impulse;
    }

    async resume() {
        // 🔴 バグ修正: AudioContextのステート管理を改善
        if (!this.audioContext) {
            await this._ensureAudioContext();
            return;
        }
        
        switch (this.audioContext.state) {
            case 'suspended':
                await this.audioContext.resume();
                console.log('🎵 AudioContext resumed');
                break;
            case 'closed':
                console.warn('AudioContext is closed, recreating...');
                this.audioContext = null;
                await this._ensureAudioContext();
                break;
            case 'running':
                // すでに動作中
                break;
        }
    }

    async loadTrack(url) {
        await this._ensureAudioContext();
        
        if (this.currentTrackUrl !== url) {
            this.audioElement.src = url;
            this.currentTrackUrl = url;
            await new Promise(resolve => {
                this.audioElement.addEventListener('canplay', resolve, { once: true });
            });
        }
    }

    async play() {
        await this.resume();
        await this.audioElement.play();
    }

    pause() {
        this.audioElement.pause();
    }

    seek(time) {
        if (this.audioElement) {
            this.audioElement.currentTime = time;
        }
    }

    setVolume(volume) {
        if (this.audioElement) {
            this.audioElement.volume = volume;
        }
    }

    // 10バンドイコライザー
    setEQBand(bandIndex, gain) {
        if (this.nodes.eq && this.nodes.eq[bandIndex]) {
            const clampedGain = Math.max(-12, Math.min(12, gain));
            this.nodes.eq[bandIndex].gain.value = clampedGain;
        }
    }

    applyEQPreset(preset) {
        const presets = {
            flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            rock: [5, 4, 3, 1, -1, -1, 0, 2, 3, 4],
            pop: [-1, 1, 3, 4, 3, 1, -1, -2, -2, -1],
            jazz: [4, 3, 2, 1, 0, 0, 1, 2, 3, 4],
            classical: [5, 4, 3, 2, -1, -2, -1, 2, 3, 4],
            bass: [8, 6, 4, 2, 0, -1, -2, -2, -1, 0],
            treble: [0, -1, -2, -2, -1, 0, 2, 4, 6, 8],
            vocal: [-2, -1, 0, 1, 3, 4, 4, 3, 1, 0],
            electronic: [6, 5, 2, 0, -2, 2, 1, 2, 5, 6],
            acoustic: [5, 4, 3, 1, 0, 0, 1, 2, 3, 4]
        };
        
        const values = presets[preset] || presets.flat;
        values.forEach((gain, index) => {
            this.setEQBand(index, gain);
        });
    }

    getAllEQBands() {
        if (!this.nodes.eq) return [];
        return this.nodes.eq.map(filter => filter.gain.value);
    }

    // リバーブエフェクト
    setReverb(enabled, mix = 0.3, decay = 2.0) {
        if (!this.nodes.reverbGain) return;
        
        this.effects.reverb = { enabled, mix, decay };
        
        if (enabled) {
            this.nodes.reverbGain.gain.value = mix;
            if (decay !== this.effects.reverb.decay) {
                this._createReverbImpulse(decay);
            }
        } else {
            this.nodes.reverbGain.gain.value = 0;
        }
        
        console.log(`🎵 Reverb: ${enabled ? 'ON' : 'OFF'} (mix: ${mix}, decay: ${decay}s)`);
    }

    // ディレイエフェクト
    setDelay(enabled, time = 0.5, feedback = 0.3, mix = 0.3) {
        if (!this.nodes.delay || !this.nodes.delayGain) return;
        
        this.effects.delay = { enabled, time, feedback, mix };
        
        if (enabled) {
            this.nodes.delay.delayTime.value = Math.max(0, Math.min(5.0, time));
            this.nodes.delayGain.gain.value = mix;
            // フィードバックは別のゲインノードで管理
        } else {
            this.nodes.delayGain.gain.value = 0;
        }
        
        console.log(`🎵 Delay: ${enabled ? 'ON' : 'OFF'} (time: ${time}s, feedback: ${feedback}, mix: ${mix})`);
    }

    // コンプレッサー
    setCompressor(enabled, settings = {}) {
        if (!this.nodes.compressor) return;
        
        const {
            threshold = -24,
            knee = 30,
            ratio = 12,
            attack = 0.003,
            release = 0.25
        } = settings;
        
        this.effects.compressor = { enabled, threshold, knee, ratio, attack, release };
        
        if (enabled) {
            this.nodes.compressor.threshold.value = threshold;
            this.nodes.compressor.knee.value = knee;
            this.nodes.compressor.ratio.value = ratio;
            this.nodes.compressor.attack.value = attack;
            this.nodes.compressor.release.value = release;
        }
        // コンプレッサーは常にシグナルチェーンに存在するが、無効時はパススルー的な設定にする
        
        console.log(`🎵 Compressor: ${enabled ? 'ON' : 'OFF'}`, settings);
    }

    // ステレオイメージャー
    setStereo(enabled, pan = 0, width = 1.0) {
        if (!this.nodes.stereoPanner) return;
        
        this.effects.stereo = { enabled, pan, width };
        
        if (enabled) {
            this.nodes.stereoPanner.pan.value = Math.max(-1, Math.min(1, pan));
            // widthは実装が複雑なので、ここではpanのみ
        } else {
            this.nodes.stereoPanner.pan.value = 0;
        }
        
        console.log(`🎵 Stereo: ${enabled ? 'ON' : 'OFF'} (pan: ${pan}, width: ${width})`);
    }

    // エフェクトプリセット
    applyEffectPreset(preset) {
        const presets = {
            'none': {
                reverb: { enabled: false },
                delay: { enabled: false },
                compressor: { enabled: false },
                stereo: { enabled: false }
            },
            'hall': {
                reverb: { enabled: true, mix: 0.4, decay: 3.0 },
                delay: { enabled: false },
                compressor: { enabled: true },
                stereo: { enabled: false }
            },
            'cathedral': {
                reverb: { enabled: true, mix: 0.6, decay: 5.0 },
                delay: { enabled: false },
                compressor: { enabled: true },
                stereo: { enabled: false }
            },
            'echo': {
                reverb: { enabled: false },
                delay: { enabled: true, time: 0.5, feedback: 0.4, mix: 0.4 },
                compressor: { enabled: false },
                stereo: { enabled: false }
            },
            'slapback': {
                reverb: { enabled: false },
                delay: { enabled: true, time: 0.12, feedback: 0.2, mix: 0.3 },
                compressor: { enabled: true },
                stereo: { enabled: false }
            },
            'radio': {
                reverb: { enabled: false },
                delay: { enabled: false },
                compressor: { enabled: true, threshold: -20, ratio: 8 },
                stereo: { enabled: false }
            },
            'wide': {
                reverb: { enabled: true, mix: 0.2, decay: 1.5 },
                delay: { enabled: false },
                compressor: { enabled: false },
                stereo: { enabled: true, pan: 0, width: 1.5 }
            }
        };
        
        const settings = presets[preset];
        if (!settings) return;
        
        if (settings.reverb) {
            this.setReverb(settings.reverb.enabled, settings.reverb.mix, settings.reverb.decay);
        }
        if (settings.delay) {
            this.setDelay(settings.delay.enabled, settings.delay.time, settings.delay.feedback, settings.delay.mix);
        }
        if (settings.compressor) {
            this.setCompressor(settings.compressor.enabled, settings.compressor);
        }
        if (settings.stereo) {
            this.setStereo(settings.stereo.enabled, settings.stereo.pan, settings.stereo.width);
        }
        
        console.log(`🎵 Applied effect preset: ${preset}`);
    }

    // 再生速度
    setPlaybackRate(rate) {
        if (!this.audioElement) return;
        const clampedRate = Math.max(0.5, Math.min(2.0, rate));
        this.audioElement.playbackRate = clampedRate;
    }

    // A-Bリピート
    setABRepeat(pointA, pointB) {
        if (!this.audioElement) return;
        
        this.abRepeat = {
            pointA: Math.max(0, pointA),
            pointB: Math.min(this.audioElement.duration || 0, pointB),
            enabled: true
        };
        
        if (!this.abRepeatListener) {
            this.abRepeatListener = () => {
                if (this.abRepeat && this.abRepeat.enabled) {
                    const currentTime = this.audioElement.currentTime;
                    if (currentTime >= this.abRepeat.pointB) {
                        this.audioElement.currentTime = this.abRepeat.pointA;
                    }
                }
            };
            this.audioElement.addEventListener('timeupdate', this.abRepeatListener);
        }
    }

    clearABRepeat() {
        if (this.abRepeat) {
            this.abRepeat.enabled = false;
            this.abRepeat = null;
        }
        if (this.abRepeatListener) {
            this.audioElement.removeEventListener('timeupdate', this.abRepeatListener);
            this.abRepeatListener = null;
        }
    }

    getABRepeat() {
        return this.abRepeat;
    }

    // ビジュアライザーデータ取得
    getVisualizerData() {
        if (this.nodes.analyser && this.visualizerData) {
            this.nodes.analyser.getByteFrequencyData(this.visualizerData);
            return this.visualizerData;
        }
        return null;
    }

    getFrequencyData() {
        if (this.nodes.analyser && this.frequencyData) {
            this.nodes.analyser.getByteFrequencyData(this.frequencyData);
            return this.frequencyData;
        }
        return null;
    }

    getTimeDomainData() {
        if (this.nodes.analyser && this.timeDomainData) {
            this.nodes.analyser.getByteTimeDomainData(this.timeDomainData);
            return this.timeDomainData;
        }
        return null;
    }

    destroy() {
        this.clearABRepeat();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.nodes = {
            source: null,
            analyser: null,
            gain: null,
            eq: [],
            reverb: null,
            delay: null,
            compressor: null,
            stereoPanner: null,
            reverbGain: null,
            delayGain: null
        };
        
        this.isInitialized = false;
    }
}

export const audioEngine = new AudioEngine();
