// スマートプレイリスト生成エンジン
export class SmartPlaylistEngine {
    /**
     * ジャンルベースのプレイリスト生成
     * @param {Array} tracks - 全トラック
     * @param {string} genre - ジャンル
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static byGenre(tracks, genre, limit = 50) {
        return tracks
            .filter(track => {
                const trackGenre = (track.genre || '').toLowerCase();
                const targetGenre = genre.toLowerCase();
                return trackGenre.includes(targetGenre) || targetGenre.includes(trackGenre);
            })
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * アーティストベースのプレイリスト生成
     * @param {Array} tracks - 全トラック
     * @param {string} artist - アーティスト名
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static byArtist(tracks, artist, limit = 50) {
        return tracks
            .filter(track => {
                const trackArtist = (track.artist || '').toLowerCase();
                const targetArtist = artist.toLowerCase();
                return trackArtist.includes(targetArtist) || targetArtist.includes(trackArtist);
            })
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * アルバムベースのプレイリスト生成
     * @param {Array} tracks - 全トラック
     * @param {string} album - アルバム名
     * @returns {Array} トラックIDの配列
     */
    static byAlbum(tracks, album) {
        return tracks
            .filter(track => {
                const trackAlbum = (track.album || '').toLowerCase();
                const targetAlbum = album.toLowerCase();
                return trackAlbum === targetAlbum || trackAlbum.includes(targetAlbum);
            })
            .map(track => track.id);
    }

    /**
     * 再生回数ベースのトップ曲プレイリスト
     * @param {Array} tracks - 全トラック
     * @param {Array} playHistory - 再生履歴
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static topPlayed(tracks, playHistory, limit = 50) {
        // 再生回数をカウント
        const playCounts = {};
        playHistory.forEach(entry => {
            playCounts[entry.trackId] = (playCounts[entry.trackId] || 0) + 1;
        });

        // トラックに再生回数を追加してソート
        return tracks
            .map(track => ({
                id: track.id,
                playCount: playCounts[track.id] || 0
            }))
            .filter(track => track.playCount > 0)
            .sort((a, b) => b.playCount - a.playCount)
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * 最近追加された曲のプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {number} days - 過去N日間
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static recentlyAdded(tracks, days = 7, limit = 50) {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        
        return tracks
            .filter(track => {
                if (!track.addedAt) return false;
                return new Date(track.addedAt).getTime() > cutoffDate;
            })
            .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * 最近再生された曲のプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {Array} playHistory - 再生履歴
     * @param {number} days - 過去N日間
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static recentlyPlayed(tracks, playHistory, days = 7, limit = 50) {
        const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
        
        const recentPlays = playHistory
            .filter(entry => new Date(entry.playedAt).getTime() > cutoffDate)
            .sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));

        // 重複を除外しつつトラックIDを収集
        const uniqueTrackIds = [];
        const seen = new Set();

        for (const entry of recentPlays) {
            if (!seen.has(entry.trackId)) {
                uniqueTrackIds.push(entry.trackId);
                seen.add(entry.trackId);
            }
            if (uniqueTrackIds.length >= limit) break;
        }

        return uniqueTrackIds;
    }

    /**
     * お気に入りのプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {Set} favorites - お気に入りSet
     * @returns {Array} トラックIDの配列
     */
    static favorites(tracks, favorites) {
        return tracks
            .filter(track => favorites.has(track.id))
            .map(track => track.id);
    }

    /**
     * 長い曲のプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {number} minDuration - 最小時間（秒）
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static longTracks(tracks, minDuration = 300, limit = 50) {
        return tracks
            .filter(track => track.duration && track.duration >= minDuration)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * 短い曲のプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {number} maxDuration - 最大時間（秒）
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static shortTracks(tracks, maxDuration = 180, limit = 50) {
        return tracks
            .filter(track => track.duration && track.duration <= maxDuration)
            .sort((a, b) => a.duration - b.duration)
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * ランダムプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {number} count - 曲数
     * @returns {Array} トラックIDの配列
     */
    static random(tracks, count = 25) {
        // 🔴 バグ修正: Fisher-Yatesシャッフルを使用
        const shuffled = [...tracks];
        
        // Fisher-Yatesシャッフル
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        return shuffled.slice(0, count).map(track => track.id);
    }

    /**
     * 未再生の曲のプレイリスト
     * @param {Array} tracks - 全トラック
     * @param {Array} playHistory - 再生履歴
     * @param {number} limit - 最大曲数
     * @returns {Array} トラックIDの配列
     */
    static neverPlayed(tracks, playHistory, limit = 50) {
        const playedTrackIds = new Set(playHistory.map(entry => entry.trackId));
        
        return tracks
            .filter(track => !playedTrackIds.has(track.id))
            .slice(0, limit)
            .map(track => track.id);
    }

    /**
     * 条件を組み合わせた高度なフィルタリング
     * @param {Array} tracks - 全トラック
     * @param {Object} conditions - 条件オブジェクト
     * @returns {Array} トラックIDの配列
     */
    static advanced(tracks, conditions = {}) {
        let filtered = [...tracks];

        // ジャンル
        if (conditions.genre) {
            filtered = filtered.filter(track => {
                const trackGenre = (track.genre || '').toLowerCase();
                return trackGenre.includes(conditions.genre.toLowerCase());
            });
        }

        // アーティスト
        if (conditions.artist) {
            filtered = filtered.filter(track => {
                const trackArtist = (track.artist || '').toLowerCase();
                return trackArtist.includes(conditions.artist.toLowerCase());
            });
        }

        // アルバム
        if (conditions.album) {
            filtered = filtered.filter(track => {
                const trackAlbum = (track.album || '').toLowerCase();
                return trackAlbum.includes(conditions.album.toLowerCase());
            });
        }

        // 時間範囲
        if (conditions.minDuration) {
            filtered = filtered.filter(track => 
                track.duration && track.duration >= conditions.minDuration
            );
        }
        if (conditions.maxDuration) {
            filtered = filtered.filter(track => 
                track.duration && track.duration <= conditions.maxDuration
            );
        }

        // 追加日時
        if (conditions.addedAfter) {
            filtered = filtered.filter(track => {
                if (!track.addedAt) return false;
                return new Date(track.addedAt).getTime() > new Date(conditions.addedAfter).getTime();
            });
        }

        // ソート
        if (conditions.sortBy) {
            switch (conditions.sortBy) {
                case 'title':
                    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                    break;
                case 'artist':
                    filtered.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
                    break;
                case 'album':
                    filtered.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
                    break;
                case 'duration':
                    filtered.sort((a, b) => (b.duration || 0) - (a.duration || 0));
                    break;
                case 'addedAt':
                    filtered.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
                    break;
                case 'random':
                    filtered.sort(() => Math.random() - 0.5);
                    break;
            }
        }

        // リミット
        const limit = conditions.limit || 50;
        return filtered.slice(0, limit).map(track => track.id);
    }

    /**
     * すべての利用可能なジャンルを取得
     * @param {Array} tracks - 全トラック
     * @returns {Array} ジャンルの配列
     */
    static getAllGenres(tracks) {
        const genres = new Set();
        tracks.forEach(track => {
            if (track.genre) {
                genres.add(track.genre);
            }
        });
        return Array.from(genres).sort();
    }

    /**
     * すべての利用可能なアーティストを取得
     * @param {Array} tracks - 全トラック
     * @returns {Array} アーティストの配列
     */
    static getAllArtists(tracks) {
        const artists = new Set();
        tracks.forEach(track => {
            if (track.artist && track.artist !== 'Unknown Artist') {
                artists.add(track.artist);
            }
        });
        return Array.from(artists).sort();
    }

    /**
     * すべての利用可能なアルバムを取得
     * @param {Array} tracks - 全トラック
     * @returns {Array} アルバムの配列
     */
    static getAllAlbums(tracks) {
        const albums = new Set();
        tracks.forEach(track => {
            if (track.album && track.album !== 'Unknown Album') {
                albums.add(track.album);
            }
        });
        return Array.from(albums).sort();
    }

    /**
     * プレイリストのプレビューを生成
     * @param {Array} trackIds - トラックID配列
     * @param {Array} tracks - 全トラック
     * @param {number} previewCount - プレビュー曲数
     * @returns {Object} プレビュー情報
     */
    static getPlaylistPreview(trackIds, tracks, previewCount = 5) {
        const playlistTracks = trackIds
            .map(id => tracks.find(t => t.id === id))
            .filter(Boolean);

        const totalDuration = playlistTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        const previewTracks = playlistTracks.slice(0, previewCount);

        // アーティスト分布
        const artistCounts = {};
        playlistTracks.forEach(track => {
            const artist = track.artist || 'Unknown';
            artistCounts[artist] = (artistCounts[artist] || 0) + 1;
        });

        return {
            totalTracks: playlistTracks.length,
            totalDuration,
            previewTracks: previewTracks.map(t => ({
                id: t.id,
                title: t.title,
                artist: t.artist,
                duration: t.duration
            })),
            topArtists: Object.entries(artistCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([artist, count]) => ({ artist, count }))
        };
    }
}

export const smartPlaylistEngine = SmartPlaylistEngine;
