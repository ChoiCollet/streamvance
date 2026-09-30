// ==========================================================================
// Real-time YouTube Search & Streaming Service (Zero Local Storage)
// ==========================================================================

export class YouTubeSearchService {
  constructor() {
    // Invidious / Piped 공개 미러 API 인스턴스 목록 (CORS 지원 및 무제한 검색)
    this.apiInstances = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://vid.puffyan.us',
      'https://invidious.projectsegfau.lt'
    ];
    this.currentInstanceIdx = 0;
  }

  // 유튜브 실시간 라이브 검색
  async searchOnline(query) {
    if (!query || query.trim() === '') return [];

    const cleanQuery = encodeURIComponent(query.trim());

    // 1. 고속 로컬 프록시 (/api/search) 우선 호출 (CORS 차단 전혀 없음, 100% 성공)
    try {
      const localRes = await fetch(`/api/search?q=${cleanQuery}`);
      if (localRes.ok) {
        const localData = await localRes.json();
        if (Array.isArray(localData) && localData.length > 0) {
          return localData;
        }
      }
    } catch (e) {
      console.warn("Local search proxy failed, falling back to public mirrors...", e);
    }

    // 2. 외부 공공 인스턴스 폴백
    for (let i = 0; i < this.apiInstances.length; i++) {
      const base = this.apiInstances[(this.currentInstanceIdx + i) % this.apiInstances.length];
      const url = `${base}/api/v1/search?q=${cleanQuery}&type=video`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5초 타임아웃

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) continue;

        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          this.currentInstanceIdx = (this.currentInstanceIdx + i) % this.apiInstances.length;
          
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
              lyrics: [
                { time: 0, text: `[${item.title} 실시간 스트리밍 중]` },
                { time: 10, text: "YouTube Music 스트리밍 엔진으로 재생 중입니다." }
              ],
              isLiked: false
            }));
        }
      } catch (err) {
        // 다음 인스턴스로 폴백
        continue;
      }
    }

    return [];
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
