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

    // [캐시 히트] 이미 검색했던 단어는 0ms 즉시 반환
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const cleanQuery = encodeURIComponent(q);

    // [1단계] 고속 프록시 API 호출 (Cloudflare Pages 또는 로컬 python server.py)
    // 현재 포트가 3000이 아닌 Live Server(5500 등)인 경우도 자동 감지
    const candidateEndpoints = ['/api/search'];
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      const hostname = window.location.hostname || 'localhost';
      if (port && port !== '3000' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
        candidateEndpoints.push(`http://${hostname}:3000/api/search`);
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
          if (Array.isArray(data) && data.length > 0) {
            this.cache.set(cacheKey, data);
            return data;
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
        this.cache.set(cacheKey, fastResult);
        return fastResult;
      }
    } catch (err) {
      console.warn('Public instances race failed:', err);
    }

    return [];
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
          return data
            .filter(item => item.type === 'video' && item.videoId)
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
              isLiked: false
            }));
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
