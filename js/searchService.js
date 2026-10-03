// ==========================================================================
// High-Speed Real-time YouTube Search Service with Smart Caching & Race Polling
// ==========================================================================

export class YouTubeSearchService {
  constructor() {
    // 1. 메모리 캐시 (동일 검색어 입력 시 0ms 즉시 응답)
    this.cache = new Map();

    // 2. 외부 공공 인스턴스 (병렬 경쟁 호출)
    this.apiInstances = [
      'https://invidious.projectsegfau.lt',
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://iv.ggtyler.dev',
      'https://invidious.perennialte.ch'
    ];
  }

  // 유튜브 실시간 라이브 고속 검색
  async searchOnline(query) {
    if (!query || query.trim() === '') return { artist: null, tracks: [], songs: [], videos: [] };
    const q = query.trim();
    const cacheKey = q.toLowerCase();

    // [캐시 히트] 이미 검색했던 단어는 0ms 즉시 반환 (인메모리 및 세션스토리지)
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const stored = sessionStorage.getItem(`ytm_search_${cacheKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          this.cache.set(cacheKey, parsed);
          return parsed;
        }
      }
    } catch (e) {}

    const cleanQuery = encodeURIComponent(q);

    // [1단계] 고속 프록시 API 호출 (Cloudflare Pages Functions /api/search 또는 로컬 python server.py)
    const candidateEndpoints = ['/api/search'];
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      const hostname = window.location.hostname || 'localhost';
      if (port !== '3000' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
        candidateEndpoints.push(`http://${hostname}:3000/api/search`);
        candidateEndpoints.push('http://127.0.0.1:3000/api/search');
      }
    }

    for (const ep of candidateEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${ep}?q=${cleanQuery}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          let normalized = null;
          if (Array.isArray(data) && data.length > 0) {
            normalized = {
              artist: null,
              tracks: data,
              songs: data.filter(t => !t.isCompilation),
              videos: data.filter(t => t.isCompilation)
            };
          } else if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
            normalized = {
              artist: data.artist || null,
              isPlaylist: !!data.isPlaylist,
              playlist: data.playlist || null,
              tracks: data.tracks,
              songs: data.songs || data.tracks.filter(t => !t.isCompilation),
              videos: data.videos || data.tracks.filter(t => t.isCompilation)
            };
          }
          if (normalized) {
            this.cache.set(cacheKey, normalized);
            try {
              if (typeof window !== 'undefined' && window.sessionStorage) {
                sessionStorage.setItem(`ytm_search_${cacheKey}`, JSON.stringify(normalized));
              }
            } catch (e) {}
            return normalized;
          }
        }
      } catch (e) {
        // 로컬/엣지 엔드포인트 실패 시 다음 시도
      }
    }

    // [2단계] 외부 공개 미러 병렬 경쟁 호출 (Promise.any로 가장 빠른 1개 서버가 응답하면 즉시 채택)
    try {
      const fastResult = await this.racePublicInstances(cleanQuery, q);
      if (fastResult && fastResult.length > 0) {
        const normalized = {
          artist: null,
          tracks: fastResult,
          songs: fastResult.filter(t => !t.isCompilation),
          videos: fastResult.filter(t => t.isCompilation)
        };
        this.cache.set(cacheKey, normalized);
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            sessionStorage.setItem(`ytm_search_${cacheKey}`, JSON.stringify(normalized));
          }
        } catch (e) {}
        return normalized;
      }
    } catch (err) {
      console.warn('Public instances race failed:', err);
    }

    return { artist: null, tracks: [], songs: [], videos: [] };
  }

  // 살아있는 미러 서버들 중 가장 빠른 서버를 낚아채는 병렬 경쟁 로직
  async racePublicInstances(cleanQuery, rawQuery) {
    const promises = this.apiInstances.map(async (base) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      try {
        const res = await fetch(`${base}/api/v1/search?q=${cleanQuery}&type=video`, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          const filtered = data
            .filter(item => item.type === 'video' && item.videoId && !this.isNonMusic(item.title, item.author))
            .map(item => {
              const dur = item.lengthSeconds || 210;
              const isComp = (dur > 600) || /playlist|플레이리스트|노래 모음|전곡 모음/i.test(item.title);
              const isOfficial = this.isArtistOfficialChannel(rawQuery, item.author);
              return {
                id: `yt-${item.videoId}`,
                videoId: item.videoId,
                title: this.cleanTitle(item.title),
                artist: isOfficial ? rawQuery : (item.author || "YouTube Music"),
                channel: item.author || "YouTube Music",
                isOfficialChannel: isOfficial,
                album: "YouTube Music",
                genre: "pop",
                mood: "all",
                duration: dur,
                cover: item.videoThumbnails?.find(t => t.quality === 'high')?.url ||
                       `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                lyrics: [],
                isLiked: false,
                isCompilation: isComp,
                _score: this.calcScore(item.title, item.author, dur, rawQuery)
              };
            });
          filtered.sort((a, b) => b._score - a._score);
          return filtered;
        }
        throw new Error('Empty items');
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    });

    try {
      return await Promise.any(promises);
    } catch {
      return [];
    }
  }

  isArtistOfficialChannel(artistName, channel) {
    if (!artistName || !channel) return false;
    const a = artistName.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    const c = channel.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    if (a && (a.includes(c) || c.includes(a))) return true;
    if (channel.toLowerCase().includes('- topic')) return true;
    const labels = ['hybe', 'smtown', 'jyp', 'yg', '1thek', 'stone music', 'edam', 'starship'];
    return labels.some(lbl => channel.toLowerCase().includes(lbl));
  }

  isNonMusic(title, channel) {
    const lt = (title || '').toLowerCase();
    const lc = (channel || '').toLowerCase();

    const musicGuards = [
      'official mv', 'm/v', 'mv', 'official audio', '가사', 'lyrics', '- topic', '노래',
      'cover', '커버', 'live cover', '우타이테', '발묘', '출항', '스텔라이브', 'song', 'sing'
    ];
    const hasMusicGuard = musicGuards.some(mg => lt.includes(mg) || lc.includes(mg));

    for (const strictKw of ['reaction', '리액션', '먹방', 'mukbang', '뉴스', 'news']) {
      if ((lt.includes(strictKw) || lc.includes(strictKw)) && !hasMusicGuard) return true;
    }

    const nonMusicKeywords = [
      'review', '리뷰', 'unboxing', '언박싱', '사용기',
      'gameplay', 'walkthrough', 'playthrough', '공략', '롤', '배그',
      'ytn', '기자', '정치', '시사',
      'lecture', '강의', '설교', 'study with me',
      '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
      '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
      '하이라이트', 'highlight', '선공개', '예고편'
    ];

    for (const kw of nonMusicKeywords) {
      if (lt.includes(kw) || lc.includes(kw)) {
        if (!hasMusicGuard) return true;
      }
    }
    return false;
  }

  calcScore(title, channel, durationSec, targetArtist = '') {
    let score = 0;
    const lt = (title || '').toLowerCase();
    const lc = (channel || '').toLowerCase();
    if (targetArtist && this.isArtistOfficialChannel(targetArtist, channel)) {
      score += 25;
    }
    if (lc.includes('- topic')) score += 10;
    if (/official|record|entertainment|music|음악|1thek|stone music|smtown|jyp|hybe|bighit|yg|dingo/i.test(lc)) score += 8;
    if (/m\/v|mv|official mv|official audio|음원|가사|lyrics|노래|live clip/i.test(lt)) score += 6;
    if (durationSec >= 110 && durationSec <= 330) score += 3;
    return score;
  }

  cleanTitle(title) {
    if (!title) return '';
    return title
      .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\]/gi, '')
      .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\)/gi, '')
      .replace(/【.*?】/g, '')
      .trim();
  }
}
