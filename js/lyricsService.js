// ==========================================================================
// Real-time Automated Synced Lyrics Service (LRCLIB Integration)
// 유튜브 및 전 세계 음악의 밀리초(0.01초) 단위 실시간 정밀 싱크 가사 자동 로더
// ==========================================================================

export class LyricsService {
  constructor() {
    this.cache = new Map();
  }

  // 곡 제목 및 아티스트 지능형 추출 (따옴표 제목, 불필요한 MV/가사 태그 제거)
  extractCandidates(rawTitle, rawArtist) {
    const title = rawTitle || '';
    const artist = rawArtist || '';

    // 따옴표로 감싸진 실제 곡명 추출 (예: PLAVE 'Pump Up The Volume!' M/V -> Pump Up The Volume!)
    const quoteMatch = title.match(/['"「『]([^'"」』]{2,40})['"」』]/);
    const extractedTitle = quoteMatch ? quoteMatch[1].trim() : '';

    // 제목 정제
    let cleanTitle = title
      .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Performance|Teaser).*?\]/gi, '')
      .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Performance|Teaser).*?\)/gi, '')
      .replace(/【.*?】/g, '')
      .replace(/feat\..*$/i, '')
      .replace(/\(feat\..*?\)/i, '')
      .replace(/M\/V|MV|Official|Music Video/gi, '')
      .replace(/['"「『』」]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 아티스트 정제
    let cleanArtist = artist
      .replace(/ - Topic/gi, '')
      .replace(/ Official/gi, '')
      .replace(/ Channel/gi, '')
      .split(',')[0]
      .split('&')[0]
      .split('(')[0]
      .trim();

    return {
      cleanTitle,
      extractedTitle,
      cleanArtist
    };
  }

  // 트랙에 대한 실시간 싱크 가사 가져오기
  async getLyrics(track) {
    if (!track) return [];

    const cacheKey = `lyrics_${track.id || track.videoId}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 로컬 스토리지 캐시 확인
    try {
      const stored = localStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.set(cacheKey, parsed);
          return parsed;
        }
      }
    } catch (e) {}

    const { cleanTitle, extractedTitle, cleanArtist } = this.extractCandidates(track.title, track.artist);

    // 검색 후보군 쿼리 구성 (정밀 -> 광범위)
    const queries = [];
    if (extractedTitle && cleanArtist) queries.push(`${extractedTitle} ${cleanArtist}`);
    if (cleanTitle && cleanArtist) queries.push(`${cleanTitle} ${cleanArtist}`);
    if (extractedTitle) queries.push(extractedTitle);
    if (cleanTitle) queries.push(cleanTitle);

    try {
      let data = null;

      // 1. LRCLIB 정밀 매칭 (track_name & artist_name)
      const targetTitle = extractedTitle || cleanTitle;
      if (targetTitle && cleanArtist) {
        try {
          const q = new URLSearchParams({
            track_name: targetTitle,
            artist_name: cleanArtist
          });
          if (track.duration) {
            q.append('duration', Math.round(track.duration));
          }
          const res = await fetch(`https://lrclib.net/api/get?${q.toString()}`, {
            headers: { 'User-Agent': 'Streamvance/1.0 (https://streamvance.pages.dev)' }
          });
          if (res.ok) {
            data = await res.json();
          }
        } catch (e) {}
      }

      // 2. 정밀 매칭 실패 시 후보 쿼리들로 검색 API 탐색
      if (!data || !data.syncedLyrics) {
        for (const queryStr of queries) {
          try {
            const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(queryStr)}`, {
              headers: { 'User-Agent': 'Streamvance/1.0' }
            });
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              if (Array.isArray(searchData) && searchData.length > 0) {
                const foundWithSync = searchData.find(item => item.syncedLyrics);
                if (foundWithSync) {
                  data = foundWithSync;
                  break;
                } else if (!data) {
                  data = searchData[0];
                }
              }
            }
          } catch (e) {}
        }
      }

      if (data && data.syncedLyrics) {
        const parsedLyrics = this.parseLRC(data.syncedLyrics);
        if (parsedLyrics.length > 0) {
          this.cache.set(cacheKey, parsedLyrics);
          try {
            localStorage.setItem(cacheKey, JSON.stringify(parsedLyrics));
          } catch (e) {}
          return parsedLyrics;
        }
      }

      // 일반 줄 가사만 있는 경우
      if (data && data.plainLyrics) {
        const lines = data.plainLyrics.split('\n').filter(l => l.trim().length > 0);
        const interval = track.duration ? (track.duration / Math.max(lines.length, 1)) : 5;
        const plainSync = lines.map((text, idx) => ({
          time: Math.round(idx * interval),
          text: text.trim()
        }));
        this.cache.set(cacheKey, plainSync);
        return plainSync;
      }
    } catch (err) {
      console.warn("Failed to fetch real-time lyrics from LRCLIB:", err);
    }

    // 3. 더미 가사가 아닌 실제 유효 가사만 폴백
    if (track.lyrics && track.lyrics.length > 0) {
      const isDummy = track.lyrics.some(l => l.text && (l.text.includes('재생 중') || l.text.includes('스트리밍')));
      if (!isDummy) {
        return track.lyrics;
      }
    }

    return [];
  }

  // LRC 형식 ([01:23.45] 가사 내용)을 밀리초 정확도의 { time, text, isInstrumental } 객체 배열로 파싱
  parseLRC(lrcText) {
    if (!lrcText) return [];
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const rawLine of lines) {
      const match = timeRegex.exec(rawLine);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const ms = parseFloat('0.' + match[3]);
        const time = min * 60 + sec + ms;
        const text = rawLine.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();

        // 메타태그나 빈 줄 무시
        if (text && !text.startsWith('ti:') && !text.startsWith('ar:') && !text.startsWith('al:') && !text.startsWith('by:')) {
          result.push({
            time: Math.round(time * 100) / 100, // 소수점 둘째 자리까지 정밀 계산
            text: text,
            isInstrumental: false
          });
        }
      }
    }

    result.sort((a, b) => a.time - b.time);

    // [전주 연주 중] 처리: 첫 번째 가사가 3초 이상 뒤에 시작된다면 0초에 전주 안내 표시
    if (result.length > 0 && result[0].time > 3.0) {
      result.unshift({
        time: 0,
        text: "🎵 [전주 연주 중...]",
        isInstrumental: true
      });
    }

    // [간주 중] 처리: 가사와 가사 사이가 15초 이상 비어있는 경우 간주 표시 삽입
    const withInstrumentals = [];
    for (let i = 0; i < result.length; i++) {
      withInstrumentals.push(result[i]);
      if (i < result.length - 1) {
        const gap = result[i + 1].time - result[i].time;
        if (gap > 15.0 && !result[i].isInstrumental) {
          withInstrumentals.push({
            time: Math.round((result[i].time + 3.0) * 100) / 100,
            text: "🎵 [간주 중...]",
            isInstrumental: true
          });
        }
      }
    }

    return withInstrumentals;
  }
}
