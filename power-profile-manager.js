/**
 * 🔌 Power Profile Manager
 * 省電力プロファイル管理システム
 * 
 * 3つのプリセット + カスタム設定
 * - Eco: 低消費電力（-70%）
 * - Balance: バランス型（-30%）
 * - Performance: 高性能（±0%）
 */

export class PowerProfileManager {
    constructor(audioEngine, stateManager, backgroundPlaybackManager) {
        this.audio = audioEngine;
        this.state = stateManager;
        this.backgroundPlayback = backgroundPlaybackManager;
        
        this.activeProfile = 'balance'; // デフォルト
        
        // プロファイル定義
        this.profiles = {
            eco: {
                name: 'エコモード',
                description: '最大70%の消費電力削減',
                settings: {
                    visualizerEnabled: false,
                    visualizerUpdateRate: 1,
                    eqEnabled: false,
                    compressorEnabled: false,
                    reverbEnabled: false,
                    delayEnabled: false,
                    crossfadeEnabled: false,
                    crossfadeDuration: 0,
                    backgroundPlayEnabled: true,
                    cpuReducedMode: true,
                    lowBitrateMode: true,
                    animationsEnabled: false,
                    cacheEnabled: true,
                    cacheSize: 50 // MB
                },
                batteryWarning: 20,
                autoActivate: true
            },
            balance: {
                name: 'バランスモード',
                description: 'パフォーマンス と 省電力 のバランス',
                settings: {
                    visualizerEnabled: true,
                    visualizerUpdateRate: 30,
                    eqEnabled: true,
                    compressorEnabled: true,
                    reverbEnabled: false,
                    delayEnabled: false,
                    crossfadeEnabled: true,
                    crossfadeDuration: 1500,
                    backgroundPlayEnabled: true,
                    cpuReducedMode: false,
                    lowBitrateMode: false,
                    animationsEnabled: true,
                    cacheEnabled: true,
                    cacheSize: 200 // MB
                },
                batteryWarning: 10,
                autoActivate: false
            },
            performance: {
                name: 'パフォーマンスモード',
                description: '最高品質での再生',
                settings: {
                    visualizerEnabled: true,
                    visualizerUpdateRate: 60,
                    eqEnabled: true,
                    compressorEnabled: true,
                    reverbEnabled: true,
                    delayEnabled: true,
                    crossfadeEnabled: true,
                    crossfadeDuration: 2000,
                    backgroundPlayEnabled: true,
                    cpuReducedMode: false,
                    lowBitrateMode: false,
                    animationsEnabled: true,
                    cacheEnabled: true,
                    cacheSize: 500 // MB
                },
                batteryWarning: 5,
                autoActivate: false
            }
        };
        
        // カスタムプロファイル
        this.customProfiles = new Map();
        
        // アクティブ設定
        this.activeSettings = { ...this.profiles.balance.settings };
    }

    /**
     * プロファイルを適用
     */
    async applyProfile(profileName) {
        let profileConfig = this.profiles[profileName];
        
        // カスタムプロファイルの場合
        if (!profileConfig && this.customProfiles.has(profileName)) {
            profileConfig = this.customProfiles.get(profileName);
        }
        
        if (!profileConfig) {
            console.error(`❌ Profile not found: ${profileName}`);
            return false;
        }
        
        try {
            console.log(`🔌 Applying profile: ${profileConfig.name}`);
            
            this.activeProfile = profileName;
            this.activeSettings = { ...profileConfig.settings };
            
            // 設定を適用
            await this.applySettings(profileConfig.settings);
            
            // ローカルストレージに保存
            localStorage.setItem('harmonia_active_profile', profileName);
            
            return true;
        } catch (error) {
            console.error('Failed to apply profile:', error);
            return false;
        }
    }

    /**
     * 設定を実装に反映
     */
    async applySettings(settings) {
        // ビジュアライザー設定
        if (settings.visualizerEnabled !== undefined) {
            this.state.updateSettings({ visualizerEnabled: settings.visualizerEnabled });
        }
        
        // イコライザー設定
        if (settings.eqEnabled !== undefined) {
            this.state.updateSettings({ eqEnabled: settings.eqEnabled });
        }
        
        // エフェクト設定
        if (settings.compressorEnabled !== undefined) {
            if (settings.compressorEnabled) {
                document.dispatchEvent(new CustomEvent('harmonia:setCompressor', {
                    detail: { enabled: true, settings: { threshold: -24, knee: 30, ratio: 12 } }
                }));
            } else {
                document.dispatchEvent(new CustomEvent('harmonia:setCompressor', {
                    detail: { enabled: false }
                }));
            }
        }

        if (settings.reverbEnabled !== undefined) {
            document.dispatchEvent(new CustomEvent('harmonia:setReverb', {
                detail: { enabled: settings.reverbEnabled, mix: 0.3, decay: 2.0 }
            }));
        }

        if (settings.delayEnabled !== undefined) {
            document.dispatchEvent(new CustomEvent('harmonia:setDelay', {
                detail: { enabled: settings.delayEnabled, time: 0.5, feedback: 0.3, mix: 0.3 }
            }));
        }

        // クロスフェード設定
        if (settings.crossfadeEnabled !== undefined) {
            this.state.updateSettings({
                crossfadeEnabled: settings.crossfadeEnabled,
                crossfadeDuration: settings.crossfadeDuration || 1500
            });
        }

        // CPU削減モード
        if (settings.cpuReducedMode !== undefined) {
            if (this.backgroundPlayback) {
                if (settings.cpuReducedMode) {
                    this.backgroundPlayback.enableCPUReducedMode();
                } else {
                    this.backgroundPlayback.disableCPUReducedMode();
                }
            }
        }

        // キャッシュ設定
        if (settings.cacheEnabled !== undefined) {
            this.state.updateSettings({
                cacheEnabled: settings.cacheEnabled,
                maxCacheSize: settings.cacheSize || 200
            });
        }

        // アニメーション
        if (settings.animationsEnabled !== undefined) {
            document.body.style.setProperty(
                '--animations-enabled',
                settings.animationsEnabled ? '1' : '0'
            );
        }
    }

    /**
     * カスタムプロファイルを作成
     */
    createCustomProfile(name, description, settings) {
        const customProfile = {
            name,
            description,
            settings: { ...this.profiles.balance.settings, ...settings },
            isCustom: true,
            createdAt: new Date().toISOString()
        };
        
        this.customProfiles.set(name, customProfile);
        
        // ローカルストレージに保存
        const saved = JSON.parse(localStorage.getItem('harmonia_custom_profiles') || '{}');
        saved[name] = customProfile;
        localStorage.setItem('harmonia_custom_profiles', JSON.stringify(saved));
        
        console.log(`✅ Custom profile created: ${name}`);
        return customProfile;
    }

    /**
     * カスタムプロファイルを削除
     */
    deleteCustomProfile(name) {
        this.customProfiles.delete(name);
        
        const saved = JSON.parse(localStorage.getItem('harmonia_custom_profiles') || '{}');
        delete saved[name];
        localStorage.setItem('harmonia_custom_profiles', JSON.stringify(saved));
        
        console.log(`✅ Custom profile deleted: ${name}`);
    }

    /**
     * すべてのプロファイルを取得
     */
    getAllProfiles() {
        const all = { ...this.profiles };
        this.customProfiles.forEach((profile, name) => {
            all[name] = profile;
        });
        return all;
    }

    /**
     * 現在のプロファイルを取得
     */
    getActiveProfile() {
        return {
            name: this.activeProfile,
            config: this.profiles[this.activeProfile] || this.customProfiles.get(this.activeProfile),
            settings: this.activeSettings
        };
    }

    /**
     * バッテリーレベルに基づいて自動切り替え
     */
    async autoSwitchProfile(batteryLevel, isCharging) {
        if (isCharging) {
            // 充電中は通常モード
            if (this.activeProfile !== 'balance' && this.activeProfile !== 'performance') {
                await this.applyProfile('balance');
            }
            return;
        }

        // バッテリーレベルに応じた自動切り替え
        if (batteryLevel < 0.2) {
            // 低バッテリー
            if (this.profiles.eco.autoActivate && this.activeProfile !== 'eco') {
                await this.applyProfile('eco');
                console.log('⚠️ Auto-switched to Eco mode (low battery)');
            }
        } else if (batteryLevel < 0.5) {
            // 中程度のバッテリー
            if (this.activeProfile === 'eco') {
                await this.applyProfile('balance');
                console.log('⚠️ Auto-switched to Balance mode');
            }
        } else if (batteryLevel > 0.8) {
            // 充分なバッテリー
            // パフォーマンスモードは手動でのみ
        }
    }

    /**
     * プロファイルの詳細情報を取得
     */
    getProfileInfo(profileName) {
        const profile = this.profiles[profileName] || this.customProfiles.get(profileName);
        
        if (!profile) {
            return null;
        }

        return {
            name: profile.name,
            description: profile.description,
            settings: profile.settings,
            isCustom: profile.isCustom || false,
            estimatedBatteryUsage: this.estimateBatteryUsage(profileName),
            estimatedCPUUsage: this.estimateCPUUsage(profileName)
        };
    }

    /**
     * バッテリー消費量を推定
     */
    estimateBatteryUsage(profileName) {
        const profiles = {
            'eco': 2,      // mAh/h
            'balance': 6,  // mAh/h
            'performance': 12 // mAh/h
        };
        return profiles[profileName] || 6;
    }

    /**
     * CPU使用率を推定
     */
    estimateCPUUsage(profileName) {
        const profiles = {
            'eco': 1,      // %
            'balance': 8,  // %
            'performance': 15 // %
        };
        return profiles[profileName] || 8;
    }

    /**
     * 初期化
     */
    async init() {
        // 保存済みプロファイルを読み込み
        const savedProfile = localStorage.getItem('harmonia_active_profile') || 'balance';
        const customProfiles = JSON.parse(localStorage.getItem('harmonia_custom_profiles') || '{}');
        
        // カスタムプロファイルを復元
        Object.entries(customProfiles).forEach(([name, profile]) => {
            this.customProfiles.set(name, profile);
        });

        // 前回のプロファイルを適用
        await this.applyProfile(savedProfile);
        
        console.log('✅ Power Profile Manager initialized');
    }

    destroy() {
        console.log('🧹 Power Profile Manager cleaned up');
    }
}

export const createPowerProfileManager = (audioEngine, stateManager, backgroundPlaybackManager) =>
    new PowerProfileManager(audioEngine, stateManager, backgroundPlaybackManager);
