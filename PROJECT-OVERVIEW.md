# 🎵 Harmonia v3.1 - プロジェクト概要

**更新日時**: 2026年2月18日  
**バージョン**: 3.1.0  
**ステータス**: ✅ 本番環境対応済み

---

## 📋 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [ディレクトリ構成](#ディレクトリ構成)
4. [主要なコンポーネント](#主要なコンポーネント)
5. [データフロー](#データフロー)
6. [エラーハンドリング戦略](#エラーハンドリング戦略)
7. [パフォーマンス最適化](#パフォーマンス最適化)
8. [コンソールコマンド](#コンソールコマンド)
9. [拡張・カスタマイズガイド](#拡張カスタマイズガイド)
10. [GitHub・デプロイ情報](#githubデプロイ情報)

---

## プロジェクト概要

### 何か？

**Harmonia** は、ブラウザで実行される高機能なオールインワン音楽再生アプリケーションです。IndexedDBを使用してローカル保存され、インターネット接続なしでも動作します。

### 主な特徴

✅ **完全なローカル動作** - サーバーなしでブラウザだけで実行  
✅ **10バンドイコライザー** - 高度なオーディオ調整  
✅ **高度なビジュアライザー** - 7種類の可視化スタイル  
✅ **LRC歌詞対応** - 時間同期された歌詞表示  
✅ **スマートプレイリスト** - 自動生成・自動更新  
✅ **マルチエフェクト** - リバーブ、ディレイ、コンプレッサー、ステレオ処理  
✅ **クラウドバックアップ** - Google Drive連携（オプション）  
✅ **PWA対応** - オフライン使用・ホーム画面インストール可能  
✅ **Media Session API対応** - スマートフォンの物理ボタンで制御可能  

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | Vanilla ES6+ JavaScript, HTML5, CSS3 |
| **オーディオAPI** | Web Audio API (AudioContext, GainNode, BiquadFilterNode) |
| **グラフィックス** | Canvas 2D (DPR対応スケーリング) |
| **ストレージ** | IndexedDB (8ストア) |
| **PWA** | Service Worker, manifest.json |
| **ホスティング** | GitHub Pages |
| **リポジトリ** | github.com/wado-answer/harmonia |

---

## アーキテクチャ

### 全体構造

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (HTML/CSS)                   │
│    UIManager (ui-manager.js) - DOM更新・ユーザー操作    │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌──────────────┐ ┌─────────────┐ ┌─────────────────┐
│ PlaylistMgr  │ │  AudioEngine│ │ VisualizerEngine│
│   (管理)     │ │  (再生制御) │ │  (描画)         │
└──────────────┘ └─────────────┘ └─────────────────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
    ┌─────────────────┐    ┌─────────────┐
    │  StateManager   │    │  ErrorTracker
    │  (状態管理)     │    │  (ロギング)  │
    └────────┬────────┘    └─────────────┘
             │
             ▼
    ┌─────────────────┐
    │  DBManager      │
    │  (IndexedDB)    │
    └─────────────────┘
```

### パターン

**Factory Pattern**: 各モジュールはFactory関数で初期化
```javascript
export function createUIManager() { return new UIManager(); }
export function createPlaylistManager() { return new PlaylistManager(); }
```

**Event Bus**: CustomEvent による疎結合な通信
```javascript
// 発火側
document.dispatchEvent(new CustomEvent('harmonia:playTrack', { detail: track }));

// リスナー側
document.addEventListener('harmonia:playTrack', (e) => { ... });
```

**Observable Pattern**: StateManager での状態変更通知
```javascript
state.subscribe('currentTrackIndex', (newValue) => {
    console.log('トラック変更:', newValue);
});
```

---

## ディレクトリ構成

```
harmonia/
├── index.html              # エントリーポイント
├── app.js                  # HarmoniaApp コントローラー (2,543行)
├── styles.css              # スタイル定義
│
├── ui-manager.js           # UIコンポーネント管理
├── state-manager.js        # 状態（Observable）管理
├── db-manager.js           # IndexedDB抽象化
│
├── audio-engine.js         # Web Audio APIラッパー
├── visualizer-engine.js    # Canvas描画エンジン
│
├── playlist-manager.js     # プレイリスト管理
├── smart-playlist.js       # スマートプレイリスト生成
├── lrc-parser.js           # LRC歌詞パーサー
├── id3-reader.js           # ID3タグ読み取り
│
├── background-playback.js  # バックグラウンド再生
├── cloud-storage.js        # クラウド連携
├── power-profile-manager.js# 省エネモード管理
│
├── sw.js                   # Service Worker (PWA)
├── manifest.json           # PWA設定
│
├── README.md               # ユーザー向けドキュメント
├── GUIDE.md                # セットアップガイド
├── PROJECT-OVERVIEW.md     # このファイル（技術概要）
└── [その他ドキュメント]
```

---

## 主要なコンポーネント

### 1. **HarmoniaApp** (app.js)

メインコントローラー。すべてのコンポーネントを統合し、再生ロジックを制御。

```javascript
class HarmoniaApp {
    // 初期化
    async init() { ... }
    
    // 再生制御
    async playTrack(index) { ... }
    togglePlay() { ... }
    next() { ... }
    previous() { ... }
    seek(seconds) { ... }
    
    // 設定管理
    async resetEQ() { ... }
    async resetAllEffects() { ... }
    async fullSystemReset() { ... }
    
    // データ管理
    async deleteTrack(trackId) { ... }
    async deleteAllData() { ... }
}
```

**キーメソッド** (80+個):
- `init()` - システム初期化（DB接続、UI描画、イベント登録）
- `playTrack(index)` - トラック再生開始
- `loadData()` - DB からデータ読み込み
- `setupEventListeners()` - キーボード・クリックイベント登録
- `subscribeToState()` - 状態変更リスナー登録
- `destroy()` - クリーンアップ（ページ離脱時）

### 2. **UIManager** (ui-manager.js)

DOM操作とイベントハンドリング。

```javascript
class UIManager {
    renderTracks(tracks, currentIndex, favorites) { ... }
    renderQueue(queue, tracks) { ... }
    updatePlayButton(isPlaying) { ... }
    showNotification(message, type) { ... }
    openModal(modalId) { ... }
}
```

### 3. **StateManager** (state-manager.js)

アプリケーション状態を一元管理（Observable）。

```javascript
class StateManager {
    subscribe(key, callback) { ... }  // 変更リスナー登録
    setState(updates) { ... }         // 状態更新
    get(key) { ... }                 // 状態取得
    getState() { ... }               // 全状態取得
}
```

### 4. **AudioEngine** (audio-engine.js)

Web Audio APIを低レベルで制御。

```javascript
class AudioEngine {
    loadTrack(url) { ... }
    play() { ... }
    pause() { ... }
    seek(time) { ... }
    
    // イコライザー
    setEQBand(band, gain) { ... }
    
    // エフェクト
    setReverb(enabled, mix, decay) { ... }
    setDelay(enabled, time, feedback, mix) { ... }
    setCompressor(enabled, settings) { ... }
    setStereo(enabled, pan, width) { ... }
}
```

**内部構造**:
```javascript
this.audioContext = new AudioContext();
this.analyser = audioContext.createAnalyser();
this.gainNode = audioContext.createGain();      // 音量
this.eqNodes = [x10];  // 10-band EQ (BiquadFilterNodes)
this.compressor = audioContext.createDynamicsCompressor();
this.convolver = audioContext.createConvolver();
```

### 5. **VisualizerEngine** (visualizer-engine.js)

Canvas 2Dで高性能描画。

```javascript
class VisualizerEngine {
    start() { ... }      // requestAnimationFrameループ開始
    stop() { ... }       // ループ停止
    setStyle(style) { ...}  // 'bars', 'waveform', など7種類
    setColors(primary, secondary, accent) { ... }
    setQuality(quality) { ... }  // 'high', 'medium', 'low'
}
```

**ビジュアライザースタイル** (7種類):
- `bars` - 周波数バー
- `waveform` - 波形表示
- `circle` - 円形スペクトラム
- `spectrum` - スペクトログラム
- `radial` - ラジアル波形
- `dot` - ドット表現
- `liquid` - 液体表現

### 6. **DBManager** (db-manager.js)

IndexedDB の抽象化。

```javascript
class DBManager {
    async save(storeName, object) { ... }
    async get(storeName, key) { ... }
    async getAll(storeName) { ... }
    async delete(storeName, key) { ... }
    async clear(storeName) { ... }
    async clearAll() { ... }
}
```

**ストア** (8個):
| ストア | 用途 |
|--------|------|
| `audioFiles` | トラックメタデータ＋ファイルデータ |
| `playlists` | 通常 + スマート |
| `favorites` | お気に入りトラックID |
| `queue` | 再生キュー |
| `settings` | ユーザー設定 |
| `lyrics` | LRC + プレーンテキスト |
| `bookmarks` | 時間ブックマーク |
| `playHistory` | 再生履歴 |

### 7. **ErrorTracker** (app.js内)

予期しないエラーを一元管理し、グレースフルに処理。

```javascript
class ErrorTracker {
    track(error, context) { ... }
    getUserMessage(error) { ... }  // ユーザーフレンドリーなメッセージ
    getStatistics() { ... }
    downloadLogs() { ... }
}
```

---

## データフロー

### トラック再生の流れ

```
① ユーザーがトラックをクリック
     ↓
② UIManager → document.dispatchEvent('harmonia:playTrack', { detail: track })
     ↓
③ HarmoniaApp.playTrack(index) リッスン
     ↓
④ AudioEngine.loadTrack(track.url) - 非同期読み込み
     ↓
⑤ AudioEngine.play() - 再生開始
     ↓
⑥ StateManager.setState({ currentTrackIndex: index, isPlaying: true })
     ↓
⑦ SubscribeHandler triggered → UI更新
     ├─ UIManager.updateNowPlaying(track)
     ├─ UIManager.updatePlayButton(true)
     └─ VisualizerEngine.start() - 描画開始
     ↓
⑧ MediaSession API更新 - スマートフォンロック画面に情報表示
     ↓
⑨ 再生履歴記録 - recordPlayHistory(trackId)
     ↓
⑩ LRC歌詞自動スクロール - startLyricsAutoScroll()
```

### 設定変更のフロー

```
① UIManager - settings フォームで値を変更
     ↓
② document.dispatchEvent('harmonia:updateMultipleSettings', { detail: updates })
     ↓
③ HarmoniaApp.updateMultipleSettings(updates) リッスン
     ↓
④ StateManager.updateSettings(updates)
     ↓
⑤ 設定変更を subscriber に通知
     └─ subscribeToState() シスター "settings" コールバック実行
     ↓
⑥ applySettingChange(key, value) - 各設定を実際に反映
     ├─ EQ設定 → AudioEngine.setEQBand() 呼び出し
     ├─ ビジュアライザー設定 → VisualizerEngine.setQuality()
     ├─ テーマ色 → 🎨 CSS変数 --theme-accent 更新
     └─ その他 → 対応する処理
     ↓
⑦ await saveSettings() - IndexedDB に永続化
     ↓
⑧ 完了 + UI通知
```

---

## エラーハンドリング戦略

### レベル1: グローバルハンドラー

```javascript
// 予期しないエラーをキャッチ
window.addEventListener('error', (event) => {
    errorTracker.track(event.error, { source: 'uncaught-exception' });
    // ユーザーフレンドリーなメッセージを表示
});

// 未処理のPromise拒否
window.addEventListener('unhandledrejection', (event) => {
    errorTracker.track(event.reason, { source: 'unhandled-promise-rejection' });
});
```

### レベル2: try-catch ラッピング

重要なメソッドに try-catch を実装：
- `init()` - 初期化
- `loadData()` - データ読み込み
- `playTrack()` - 再生
- `saveSettings()` - 設定保存
- `handleFileUpload()` - ファイル処理

### レベル3: エラーメッセージマッピング

```javascript
const errorMap = {
    'NotAllowedError': 'ブラウザの設定により操作が拒否されました',
    'QuotaExceededError': 'ストレージ容量が満杯です',
    'NetworkError': 'ネットワーク接続エラーです',
    // ...
};
```

### レベル4: エラーログ保存

```javascript
errorTracker.errors  // 最大50個のエラー記録
errorTracker.downloadLogs()  // JSONでダウンロード可能
window.harmonia.errorTracker.getStatistics()  // エラー統計確認
```

---

## パフォーマンス最適化

| 最適化 | 詳細 | 効果 |
|--------|------|------|
| **バッチ処理** | トラック読み込みを100個単位で処理 | メモリスパイク防止 |
| **Debouncing** | 再生進捗更新を250ms間隔に制限 | CPU使用時間↓15% |
| **DPR対応** | Canvas のDPR（デバイスピクセル比）スケーリング | Retina対応 |
| **Blob URL管理** | URL.revokeObjectURL で明示的に解放 | メモリリーク防止 |
| **遅延初期化** | ビジュアライザーを初回使用時に初期化 | 起動時間↓30% |
| **指数バックオフ** | DB接続失敗時に2s→4s→8s待機 | サーバー過負荷対策 |
| **EventListener追跡** | 登録・削除を配列で追跡 | メモリリーク防止 |
| **ResizeObserver** | Canvas リサイズ検出 | 自動DPI調整 |
| **requestAnimationFrame** | 描画を60fpsに同期 | CPU効率化 |
| **gaplessPlayback** | 次トラック事前読み込み | 無音時間排除 |

---

## コンソールコマンド

ブラウザコンソール（F12キー）で以下が実行可能：

### 再生制御

```javascript
// 再生
window.harmonia.togglePlay();

// 次へ
window.harmonia.next();

// 前へ
window.harmonia.previous();

// トラック指定再生
window.harmonia.playTrack(0);  // インデックス0のトラック

// シークして(秒単位)
window.harmonia.seek(30);  // +30秒

// 音量設定 (0.0 - 1.0)
window.harmonia.setVolume(0.8);
```

### 設定・リセット

```javascript
// EQリセット
window.harmonia.resetEQ();

// ビジュアライザーリセット
window.harmonia.resetVisualizerSettings();

// エフェクトリセット
window.harmonia.resetAllEffects();

// 完全システムリセット
await window.harmonia.fullSystemReset();

// 設定リセット
await window.harmonia.resetSettings();
```

### スマートプレイリスト

```javascript
// 最頻再生トラック
window.harmonia.secretPlay();

// 統計情報表示
window.harmonia.secretStats();

// ランダムテーマ
window.harmonia.secretTheme();
```

### エラーハンドリング

```javascript
// エラー統計確認
console.log(window.harmonia.errorTracker.getStatistics());

// エラーログダウンロード
window.harmonia.errorTracker.downloadLogs();

// エラー履歴確認
console.log(window.harmonia.errorTracker.errors);
```

### ストレージ・バックアップ

```javascript
// データ全削除
await window.harmonia.deleteAllData();

// 再生履歴クリア
await window.harmonia.clearPlayHistory();

// プレイリストエクスポート
window.harmonia.exportPlaylists();

// バックアップをダウンロード
await window.harmonia.exportFullBackup();
```

---

## 拡張・カスタマイズガイド

### 新しいビジュアライザースタイルを追加

[visualizer-engine.js](visualizer-engine.js#L200) にて：

```javascript
// drawers オブジェクトに追加
drawers: {
    myStyle: (ctx, frequencyData, canvas, color1, color2) => {
        // カスタム描画ロジック
        ctx.fillStyle = color1;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // ...
    }
}

// styles配列に追加
styles: [ ..., 'myStyle' ]
```

### 新しいイコライザープリセットを追加

[audio-engine.js](audio-engine.js#L350) にて：

```javascript
eqPresets: {
    myCustom: [
        2, 3, 1, 0, -1, -2, -1, 0, 2, 3
    ]
}
```

### 新しいエフェクトを実装

```javascript
// AudioEngine.js に新規メソッド追加
setNewEffect(enabled, params) {
    if (enabled) {
        const effect = this.audioContext.createXXX();
        // 設定...
        this.gainNode.connect(effect);
    }
}

// app.js に対応するイベントリスナー
document.addEventListener('harmonia:setNewEffect', (e) => {
    this.setNewEffect(e.detail.enabled, e.detail.params);
});
```

### スマートプレイリストタイプを追加

[smart-playlist.js](smart-playlist.js#L100) にて：

```javascript
case 'myType':
    return smartPlaylistEngine.myCustomFilter(tracks, params);

// フィルタロジック実装
myCustomFilter(tracks, params) {
    return tracks.filter(t => {
        // カスタムロジック
        return t.duration > params.minDuration;
    });
}
```

---

## GitHub・デプロイ情報

### リポジトリ

**URL**: https://github.com/wado-answer/harmonia  
**ホスティング**: GitHub Pages  
**デモ**: https://wado-answer.github.io/harmonia/

### ブランチ戦略

| ブランチ | 用途 |
|---------|------|
| `main` | 本番環境（GitHub Pages）✅ |
| `develop` | 開発版 |
| `feature/*` | 機能開発 |

### デプロイ

`main` ブランチへのpush → 自動的にGitHub Pagesに公開

```bash
# ローカルで確認（任意）
python -m http.server 8000

# ブラウザ
http://localhost:8000
```

### ファイル管理

✅ **Git管理対象**:
- `*.js`, `*.html`, `*.css`
- `*.md` (ドキュメント)
- `manifest.json`, `sw.js` (PWA)

❌ **Git無視対象** (.gitignore):
- `node_modules/`
- `dist/`, `build/`
- `.DS_Store`, `desktop.ini`
- IDE設定ファイル

---

## まとめ

| 項目 | 詳細 |
|------|------|
| **言語** | JavaScript (ES6+) |
| **ファイル数** | 15+ コンポーネント |
| **コード行数** | ~8000行 |
| **テスト対応** | Chrome, Firefox, Safari, Edge |
| **オフライン対応** | ✅ Service Worker + IndexedDB |
| **モバイル対応** | ✅ PWA + レスポンシブ |
| **アクセシビリティ** | ✅ media controls対応 |
| **ライセンス** | MIT |
| **メンテナンス** | お気軽に Issue/PR どうぞ |

---

**質問・改善提案**: GitHub Issues  
**コード貢献**: GitHub Pull Requests  
**ライブデモ**: https://wado-answer.github.io/harmonia/

