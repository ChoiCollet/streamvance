// ==========================================================================
// High-Speed Real-time YouTube Search Service with Smart Caching & Race Polling
// ==========================================================================

export class YouTubeSearchService {
  constructor() {
    // 1. 메모리 캐시 (동일 검색어 입력 시 0ms 즉시 응답)
    this.cache = new Map();

    // 2. 외부 공공 인스턴스 (병렬 경쟁 호출로 0.8초 이내 응답)
    this.apiInstances = [
      'https://invidious.projectsegfau.lt',
      'https://inv.tux.pizza',
      'https://invidious.perennialte.ch',
      'https://iv.ggtyler.dev',
      'https://invidious.private.coffee'
    ];
  }

  // 유튜브 실시간 라이브 고속 검색
  async searchOnline(query) {
    if (!query || query.trim() === '') return [];
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

    // [1단계] 고속 프록시 API 호출 (Cloudflare Pages 또는 로컬 python server.py)
    // 현재 포트가 3000이 아닌 Live Server(5500 등)인 경우도 자동 감지
    const candidateEndpoints = ['/api/search'];
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      const hostname = window.location.hostname || 'localhost';
      if (port !== '3000') {
        candidateEndpoints.push(`http://${hostname || 'localhost'}:3000/api/search`);
        candidateEndpoints.push('http://127.0.0.1:3000/api/search');
      }
    }

    for (const ep of candidateEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5초 타임아웃
        const res = await fetch(`${ep}?q=${cleanQuery}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          let normalized = null;
          if (Array.isArray(data) && data.length > 0) {
            normalized = { artist: null, tracks: data, songs: data.filter(t => !t.isCompilation), videos: data.filter(t => t.isCompilation) };
          } else if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
            normalized = {
              artist: data.artist || null,
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
        // 로컬/엣지 엔드포인트 실패 시 계속 시도
      }
    }

    // [2단계] 외부 공개 미러 병렬 경쟁 호출 (Promise.any로 가장 빠른 1개 서버가 응답하면 즉시 채택)
    try {
      const fastResult = await this.racePublicInstances(cleanQuery);
      if (fastResult && fastResult.length > 0) {
        const normalized = {
          artist: null,
          tracks: fastResult,
          songs: fastResult,
          videos: []
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
  async racePublicInstances(cleanQuery) {
    const promises = this.apiInstances.map(async (base) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2200); // 2.2초 제한

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
            .map(item => ({
              id: `yt-${item.videoId}`,
              videoId: item.videoId,
              title: this.cleanTitle(item.title),
              artist: item.author || "YouTube Music",
              album: "YouTube Music Stream",
              genre: "pop",
              mood: "all",
              duration: item.lengthSeconds || 210,
              cover: item.videoThumbnails?.find(t => t.quality === 'high')?.url ||
                     `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
              lyrics: [],
              isLiked: false,
              _score: this.calcScore(item.title, item.author, item.lengthSeconds || 210)
            }));
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

  isNonMusic(title, channel) {
    const lt = (title || '').toLowerCase();
    const lc = (channel || '').toLowerCase();

    for (const strictKw of ['reaction', '리액션', 'vlog', '브이로그', '먹방', 'mukbang', '게임', 'gameplay', '뉴스', 'news']) {
      if (lt.includes(strictKw) || lc.includes(strictKw)) return true;
    }

    const nonMusicKeywords = [
      'review', '리뷰', 'unboxing', '언박싱', '사용기',
      'game', '게임', 'walkthrough', 'playthrough', '공략', '롤', '배그',
      'ytn', '기자', '정치', '시사', '속보',
      'lecture', '강의', '설교', '공부', 'study with me',
      '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
      '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
      '하이라이트', 'highlight', '선공개', '예고편'
    ];

    for (const kw of nonMusicKeywords) {
      if (lt.includes(kw) || lc.includes(kw)) {
        const musicGuards = ['official mv', 'm/v', 'official audio', '가사', 'lyrics', '- topic', '노래'];
        if (!musicGuards.some(mg => lt.includes(mg) || lc.includes(mg))) {
          return true;
        }
      }
    }
    return false;
  }

  calcScore(title, channel, durationSec) {
    let score = 0;
    const lt = (title || '').toLowerCase();
    const lc = (channel || '').toLowerCase();
    if (lc.includes('- topic')) score += 10;
    if (/official|record|entertainment|music|음악|1thek|stone music|smtown|jyp|hybe|bighit|yg|dingo/i.test(lc)) score += 6;
    if (/m\/v|mv|official mv|official audio|음원|가사|lyrics|노래|live clip/i.test(lt)) score += 5;
    if (durationSec >= 110 && durationSec <= 330) score += 3;
    return score;
  }

  // 곡 제목의 불필요한 태그([Official MV], (Audio) 등) 정리
  cleanTitle(title) {
    if (!title) return '';
    return title
      .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\]/gi, '')
      .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\)/gi, '')
      .replace(/【.*?】/g, '')
      .trim();
  }
}
