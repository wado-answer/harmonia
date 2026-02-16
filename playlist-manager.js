/**
 * 高度なプレイリスト管理システム
 * 動的プレイリスト、スマートマージ、自動生成機能付き
 */

export class PlaylistManager {
    constructor(stateManager, dbManager) {
        this.state = stateManager;
        this.db = dbManager;
        this.playlistCache = new Map();
        this.autoSaveEnabled = true;
    }

    // ===== プレイリスト CRUD =====
    async createPlaylist(name, description = '', options = {}) {
        const playlist = {
            id: Date.now() + Math.random(),
            name: this._sanitize(name),
            description: this._sanitize(description),
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            color: options.color || '#6366f1',
            isPublic: options.isPublic !== false,
            tags: options.tags || [],
            metadata: {
                totalDuration: 0,
                trackCount: 0,
                lastPlayedAt: null
            }
        };

        const playlists = [...this.state.get('playlists'), playlist];
        this.state.setState({ playlists });
        await this.db.save('playlists', playlist);
        this.playlistCache.set(playlist.id, playlist);

        return playlist;
    }

    async updatePlaylist(playlistId, updates) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) throw new Error('Playlist not found');

        const updated = {
            ...playlist,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const index = playlists.indexOf(playlist);
        playlists[index] = updated;

        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', updated);
        this.playlistCache.set(playlistId, updated);

        return updated;
    }

    async deletePlaylist(playlistId) {
        const playlists = this.state.get('playlists').filter(p => p.id !== playlistId);
        this.state.setState({ playlists });
        await this.db.delete('playlists', playlistId);
        this.playlistCache.delete(playlistId);
    }

    // ===== トラック管理 =====
    async addTracksToPlaylist(playlistId, trackIds) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) throw new Error('Playlist not found');

        const newTracks = trackIds.filter(id => !playlist.tracks.includes(id));
        playlist.tracks.push(...newTracks);
        playlist.updatedAt = new Date().toISOString();

        this._updateMetadata(playlist);

        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', playlist);
        this.playlistCache.set(playlistId, playlist);

        return playlist;
    }

    async removeTracksFromPlaylist(playlistId, trackIds) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) throw new Error('Playlist not found');

        playlist.tracks = playlist.tracks.filter(id => !trackIds.includes(id));
        playlist.updatedAt = new Date().toISOString();

        this._updateMetadata(playlist);

        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', playlist);
        this.playlistCache.set(playlistId, playlist);

        return playlist;
    }

    async reorderTracks(playlistId, fromIndex, toIndex) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);

        if (!playlist) throw new Error('Playlist not found');

        const [track] = playlist.tracks.splice(fromIndex, 1);
        playlist.tracks.splice(toIndex, 0, track);
        playlist.updatedAt = new Date().toISOString();

        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', playlist);

        return playlist;
    }

    // ===== スマート機能 =====
    async duplicatePlaylist(playlistId, newName) {
        const playlists = this.state.get('playlists');
        const original = playlists.find(p => p.id === playlistId);

        if (!original) throw new Error('Playlist not found');

        const duplicate = await this.createPlaylist(
            newName || `${original.name} (コピー)`,
            original.description
        );

        await this.addTracksToPlaylist(duplicate.id, [...original.tracks]);

        return duplicate;
    }

    async mergePlaylistsInto(sourcePlaylistIds, targetPlaylistId) {
        const tracks = new Set();
        const playlists = this.state.get('playlists');

        sourcePlaylistIds.forEach(id => {
            const playlist = playlists.find(p => p.id === id);
            if (playlist) {
                playlist.tracks.forEach(trackId => tracks.add(trackId));
            }
        });

        return await this.addTracksToPlaylist(targetPlaylistId, Array.from(tracks));
    }

    // ===== フィルター・ソート =====
    filterPlaylistTracks(playlistId, options = {}) {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        const tracks = this.state.get('tracks');

        if (!playlist) return [];

        let filtered = playlist.tracks.map(id => tracks.find(t => t.id === id)).filter(Boolean);

        // ジャンル フィルター
        if (options.genre) {
            filtered = filtered.filter(t => t.genre === options.genre);
        }

        // アーティスト フィルター
        if (options.artist) {
            filtered = filtered.filter(t => t.artist === options.artist);
        }

        // 再生時間範囲
        if (options.minDuration || options.maxDuration) {
            filtered = filtered.filter(t => {
                const dur = t.duration;
                if (options.minDuration && dur < options.minDuration) return false;
                if (options.maxDuration && dur > options.maxDuration) return false;
                return true;
            });
        }

        // ソート
        if (options.sortBy) {
            filtered = this._sortTracks(filtered, options.sortBy);
        }

        return filtered;
    }

    _sortTracks(tracks, sortBy) {
        const copy = [...tracks];
        
        switch (sortBy) {
            case 'title':
                return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            case 'artist':
                return copy.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
            case 'duration':
                return copy.sort((a, b) => (a.duration || 0) - (b.duration || 0));
            case 'addedAt':
                return copy.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
            case 'random':
                return copy.sort(() => Math.random() - 0.5);
            default:
                return copy;
        }
    }

    // ===== 自動プレイリスト =====
    async createAutoPlaylist(name, criteria = {}) {
        const playlist = await this.createPlaylist(name, 'スマートプレイリスト');
        const tracks = this._generateTracksForCriteria(criteria);
        
        await this.addTracksToPlaylist(playlist.id, tracks.map(t => t.id));

        playlist.isAuto = true;
        playlist.criteria = criteria;

        const playlists = this.state.get('playlists');
        const index = playlists.findIndex(p => p.id === playlist.id);
        playlists[index] = playlist;
        
        this.state.setState({ playlists: [...playlists] });
        await this.db.save('playlists', playlist);

        return playlist;
    }

    _generateTracksForCriteria(criteria) {
        let tracks = this.state.get('tracks');

        if (criteria.genre) {
            tracks = tracks.filter(t => t.genre === criteria.genre);
        }

        if (criteria.minRating) {
            tracks = tracks.filter(t => (t.rating || 0) >= criteria.minRating);
        }

        if (criteria.maxAge) {
            const cutoff = Date.now() - (criteria.maxAge * 24 * 60 * 60 * 1000);
            tracks = tracks.filter(t => new Date(t.addedAt).getTime() > cutoff);
        }

        if (criteria.limit) {
            tracks = tracks.slice(0, criteria.limit);
        }

        return tracks;
    }

    // ===== ユーティリティ =====
    _sanitize(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _updateMetadata(playlist) {
        const tracks = this.state.get('tracks');
        let totalDuration = 0;

        playlist.tracks.forEach(trackId => {
            const track = tracks.find(t => t.id === trackId);
            if (track) totalDuration += track.duration || 0;
        });

        playlist.metadata = {
            totalDuration,
            trackCount: playlist.tracks.length,
            lastPlayedAt: playlist.metadata?.lastPlayedAt || null
        };
    }

    async exportPlaylist(playlistId, format = 'json') {
        const playlists = this.state.get('playlists');
        const playlist = playlists.find(p => p.id === playlistId);
        const tracks = this.state.get('tracks');

        if (!playlist) throw new Error('Playlist not found');

        const playlistTracks = playlist.tracks
            .map(id => tracks.find(t => t.id === id))
            .filter(Boolean);

        if (format === 'm3u') {
            return this._exportAsM3u(playlist, playlistTracks);
        } else if (format === 'csv') {
            return this._exportAsCsv(playlist, playlistTracks);
        } else {
            return JSON.stringify({ playlist, tracks: playlistTracks }, null, 2);
        }
    }

    _exportAsM3u(playlist, tracks) {
        let m3u = '#EXTM3U\n';
        m3u += `#PLAYLIST: ${playlist.name}\n`;

        tracks.forEach(track => {
            m3u += `#EXTINF:${Math.floor(track.duration || 0)}, ${track.artist || 'Unknown'} - ${track.title || 'Unknown'}\n`;
            m3u += `${track.url || ''}\n`;
        });

        return m3u;
    }

    _exportAsCsv(playlist, tracks) {
        let csv = 'タイトル,アーティスト,アルバム,ジャンル,再生時間\n';

        tracks.forEach(track => {
            csv += `"${track.title || 'Unknown'}",`;
            csv += `"${track.artist || 'Unknown'}",`;
            csv += `"${track.album || 'Unknown'}",`;
            csv += `"${track.genre || 'Unknown'}",`;
            csv += `${this._formatTime(track.duration || 0)}\n`;
        });

        return csv;
    }

    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

export const createPlaylistManager = (stateManager, dbManager) => 
    new PlaylistManager(stateManager, dbManager);
