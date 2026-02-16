// LRC歌詞パーサー - 時間同期型歌詞対応
export class LRCParser {
    /**
     * LRC形式の歌詞をパース
     * @param {string} lrcText - LRC形式のテキスト
     * @returns {Object} パース済み歌詞データ
     */
    static parse(lrcText) {
        if (!lrcText || typeof lrcText !== 'string') {
            return { metadata: {}, lines: [], hasTimestamps: false };
        }

        const metadata = {};
        const lines = [];
        const lrcLines = lrcText.split('\n');

        // メタデータのパターン
        const metadataPattern = /^\[([a-z]+):(.+)\]$/i;
        // タイムスタンプのパターン [mm:ss.xx] または [mm:ss]
        const timestampPattern = /^\[(\d{1,2}):(\d{2})\.?(\d{0,3})\](.*)$/;

        for (const line of lrcLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // メタデータをチェック
            const metaMatch = trimmed.match(metadataPattern);
            if (metaMatch) {
                metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
                continue;
            }

            // タイムスタンプをチェック
            const timeMatch = trimmed.match(timestampPattern);
            if (timeMatch) {
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                // 修正: ミリ秒の桁数に応じて適切に処理
                const msString = timeMatch[3] || '0';
                const milliseconds = msString.length === 3 
                    ? parseInt(msString) 
                    : parseInt(msString.padEnd(3, '0'));
                const text = timeMatch[4].trim();

                const time = minutes * 60 + seconds + milliseconds / 1000;

                lines.push({
                    time,
                    text,
                    minutes,
                    seconds,
                    milliseconds
                });
            } else {
                // タイムスタンプなしの行（通常の歌詞）
                lines.push({
                    time: null,
                    text: trimmed,
                    minutes: null,
                    seconds: null,
                    milliseconds: null
                });
            }
        }

        // 時間でソート
        lines.sort((a, b) => {
            if (a.time === null) return 1;
            if (b.time === null) return -1;
            return a.time - b.time;
        });

        const hasTimestamps = lines.some(line => line.time !== null);

        return {
            metadata,
            lines,
            hasTimestamps
        };
    }

    /**
     * 現在時刻に対応する歌詞行を取得
     * @param {Array} lines - パース済み歌詞行
     * @param {number} currentTime - 現在の再生時刻（秒）
     * @param {number} lookahead - 先読み時間（秒）
     * @returns {Object} 現在、前、次の歌詞行
     */
    static getCurrentLine(lines, currentTime, lookahead = 0.5) {
        if (!lines || lines.length === 0) {
            return { current: null, previous: null, next: null, currentIndex: -1 };
        }

        // タイムスタンプありの行のみフィルター
        const timedLines = lines.filter(line => line.time !== null);
        if (timedLines.length === 0) {
            return { current: lines[0], previous: null, next: lines[1] || null, currentIndex: 0 };
        }

        // 現在時刻に最も近い行を探す（先読み込み）
        let currentIndex = -1;
        for (let i = 0; i < timedLines.length; i++) {
            if (timedLines[i].time <= currentTime + lookahead) {
                currentIndex = i;
            } else {
                break;
            }
        }

        if (currentIndex === -1) {
            // まだ最初の行に到達していない
            return {
                current: null,
                previous: null,
                next: timedLines[0],
                currentIndex: -1
            };
        }

        return {
            current: timedLines[currentIndex],
            previous: currentIndex > 0 ? timedLines[currentIndex - 1] : null,
            next: currentIndex < timedLines.length - 1 ? timedLines[currentIndex + 1] : null,
            currentIndex
        };
    }

    /**
     * 歌詞をLRC形式にエクスポート
     * @param {Object} lyricsData - 歌詞データ
     * @returns {string} LRC形式のテキスト
     */
    static export(lyricsData) {
        const { metadata, lines } = lyricsData;
        let lrcText = '';

        // メタデータを追加
        if (metadata) {
            for (const [key, value] of Object.entries(metadata)) {
                lrcText += `[${key}:${value}]\n`;
            }
            if (Object.keys(metadata).length > 0) {
                lrcText += '\n';
            }
        }

        // 歌詞行を追加
        for (const line of lines) {
            if (line.time !== null) {
                const minutes = Math.floor(line.time / 60);
                const seconds = Math.floor(line.time % 60);
                const milliseconds = Math.floor((line.time % 1) * 1000);
                lrcText += `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}]${line.text}\n`;
            } else {
                lrcText += `${line.text}\n`;
            }
        }

        return lrcText;
    }

    /**
     * プレーンテキストをLRC形式に変換（タイムスタンプなし）
     * @param {string} plainText - プレーンテキスト
     * @returns {Object} LRC形式のデータ
     */
    static fromPlainText(plainText) {
        const lines = plainText.split('\n').map(text => ({
            time: null,
            text: text.trim(),
            minutes: null,
            seconds: null,
            milliseconds: null
        })).filter(line => line.text);

        return {
            metadata: {},
            lines,
            hasTimestamps: false
        };
    }

    /**
     * LRC形式かどうかを検出
     * @param {string} text - テキスト
     * @returns {boolean} LRC形式ならtrue
     */
    static isLRC(text) {
        if (!text || typeof text !== 'string') return false;
        const timestampPattern = /\[\d{1,2}:\d{2}\.?\d{0,3}\]/;
        return timestampPattern.test(text);
    }

    /**
     * 歌詞の表示範囲を取得（スクロール用）
     * @param {Array} lines - 歌詞行
     * @param {number} currentIndex - 現在の行インデックス
     * @param {number} visibleLines - 表示する行数
     * @returns {Array} 表示する行の配列
     */
    static getVisibleLines(lines, currentIndex, visibleLines = 5) {
        if (!lines || lines.length === 0) return [];

        const before = Math.floor((visibleLines - 1) / 2);
        const after = Math.ceil((visibleLines - 1) / 2);

        let startIndex = Math.max(0, currentIndex - before);
        let endIndex = Math.min(lines.length, currentIndex + after + 1);

        // 表示行数が足りない場合は前後を調整
        if (endIndex - startIndex < visibleLines) {
            if (startIndex === 0) {
                endIndex = Math.min(lines.length, visibleLines);
            } else if (endIndex === lines.length) {
                startIndex = Math.max(0, lines.length - visibleLines);
            }
        }

        return lines.slice(startIndex, endIndex).map((line, idx) => ({
            ...line,
            isActive: startIndex + idx === currentIndex,
            originalIndex: startIndex + idx
        }));
    }
}

export const lrcParser = LRCParser;
