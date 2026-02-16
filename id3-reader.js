// ID3タグ読み取りモジュール
export class ID3Reader {
    static async readTags(file) {
        try {
            const buffer = await file.arrayBuffer();
            const view = new DataView(buffer);
            
            // ファイルサイズチェック
            if (view.byteLength < 10) {
                return null;
            }
            
            // ID3v2ヘッダーチェック
            const header = String.fromCharCode(
                view.getUint8(0),
                view.getUint8(1),
                view.getUint8(2)
            );
            
            if (header !== 'ID3') {
                return null;
            }
            
            const version = view.getUint8(3);
            const flags = view.getUint8(5);
            
            // タグサイズを取得（synchsafe integer）
            const tagSize = this._decodeSynchsafeInt(
                view.getUint8(6),
                view.getUint8(7),
                view.getUint8(8),
                view.getUint8(9)
            );
            
            const tags = {};
            let offset = 10;
            const maxOffset = Math.min(tagSize + 10, view.byteLength);
            
            // フレームを順次読み取り
            while (offset < maxOffset - 10) {
                try {
                    const frame = this._readFrame(view, offset, version, maxOffset);
                    if (!frame) break;
                    
                    Object.assign(tags, frame.tags);
                    offset = frame.nextOffset;
                } catch (error) {
                    console.warn('Frame read error:', error);
                    break;
                }
            }
            
            return Object.keys(tags).length > 0 ? tags : null;
        } catch (error) {
            console.error('ID3 tag read error:', error);
            return null;
        }
    }

    static _readFrame(view, offset, version, maxOffset) {
        // フレームIDを読み取り
        const frameId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
        );
        
        // パディングに到達
        if (frameId === '\0\0\0\0' || frameId.charCodeAt(0) === 0) {
            return null;
        }
        
        // フレームサイズを読み取り
        let frameSize;
        if (version === 4) {
            frameSize = this._decodeSynchsafeInt(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7)
            );
        } else {
            frameSize = view.getUint32(offset + 4);
        }
        
        // サイズ検証
        if (frameSize === 0 || offset + 10 + frameSize > maxOffset) {
            return null;
        }
        
        const frameFlags = view.getUint16(offset + 8);
        const dataOffset = offset + 10;
        
        const tags = {};
        
        // フレームIDに応じて処理
        if (frameId === 'APIC') {
            // アルバムアート
            const artwork = this._extractArtwork(view, dataOffset, frameSize);
            if (artwork) {
                tags.artwork = artwork;
            }
        } else {
            // テキストフレーム
            const text = this._extractText(view, dataOffset, frameSize);
            if (text) {
                const field = this._mapFrameId(frameId);
                if (field) {
                    tags[field] = text;
                }
            }
        }
        
        return {
            tags,
            nextOffset: offset + 10 + frameSize
        };
    }

    static _extractArtwork(view, offset, size) {
        try {
            const encoding = view.getUint8(offset);
            let pos = offset + 1;
            
            // MIMEタイプを取得
            let mimeEnd = pos;
            while (mimeEnd < offset + size && view.getUint8(mimeEnd) !== 0) {
                mimeEnd++;
            }
            
            if (mimeEnd >= offset + size) return null;
            
            const mimeBytes = new Uint8Array(view.buffer, pos, mimeEnd - pos);
            const mimeType = new TextDecoder('ascii').decode(mimeBytes) || 'image/jpeg';
            
            const pictureType = view.getUint8(mimeEnd + 1);
            
            // 説明をスキップ
            let descEnd = mimeEnd + 2;
            while (descEnd < offset + size && view.getUint8(descEnd) !== 0) {
                descEnd++;
            }
            
            if (descEnd >= offset + size) return null;
            
            // 画像データを抽出
            const imageStart = descEnd + 1;
            const imageSize = offset + size - imageStart;
            
            if (imageSize <= 0) return null;
            
            const imageData = new Uint8Array(view.buffer, imageStart, imageSize);
            
            // Base64に変換してdata URLとして返す（永続化可能）
            let binary = '';
            for (let i = 0; i < imageData.byteLength; i++) {
                binary += String.fromCharCode(imageData[i]);
            }
            const base64 = btoa(binary);
            
            return `data:${mimeType};base64,${base64}`;
        } catch (error) {
            console.warn('Artwork extraction error:', error);
            return null;
        }
    }

    static _extractText(view, offset, size) {
        try {
            if (size <= 1) return null;
            
            const encoding = view.getUint8(offset);
            const textBytes = new Uint8Array(view.buffer, offset + 1, size - 1);
            
            let text;
            if (encoding === 0) {
                // ISO-8859-1
                text = new TextDecoder('iso-8859-1').decode(textBytes);
            } else if (encoding === 1 || encoding === 2) {
                // UTF-16
                text = new TextDecoder('utf-16').decode(textBytes);
            } else if (encoding === 3) {
                // UTF-8
                text = new TextDecoder('utf-8').decode(textBytes);
            } else {
                // フォールバック
                text = new TextDecoder('utf-8').decode(textBytes);
            }
            
            // NULL文字を除去
            return text.replace(/\0/g, '').trim();
        } catch (error) {
            console.warn('Text extraction error:', error);
            return null;
        }
    }

    static _mapFrameId(frameId) {
        const mapping = {
            'TIT2': 'title',
            'TPE1': 'artist',
            'TALB': 'album',
            'TYER': 'year',
            'TDRC': 'year', // ID3v2.4
            'TRCK': 'track',
            'TCON': 'genre'
        };
        return mapping[frameId];
    }

    static _decodeSynchsafeInt(...bytes) {
        return bytes.reduce((acc, byte, i) => {
            return acc | (byte << (7 * (bytes.length - 1 - i)));
        }, 0);
    }
}

export const id3Reader = ID3Reader;
