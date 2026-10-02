// ==========================================================================
// Real-time Automated Synced Lyrics Service (LRCLIB Integration)
// 유튜브 및 전 세계 음악의 밀리초(0.01초) 단위 실시간 정밀 싱크 가사 자동 로더
// ==========================================================================

export const KNOWN_MV_OFFSETS = {
  // 정국 'Seven (feat. Latto)' Official MV (식당 연인 다툼 대화 인트로 34.5초)
  'QU9c0053UAU': 34.5,
  'yt-QU9c0053UAU': 34.5,
  // 플레이브 'Pump Up The Volume!' Official MV (라디오 부스 오프닝 인트로 16.0초)
  'vCfxuKvh-6w': 16.0,
  'yt-vCfxuKvh-6w': 16.0,
  // 아이유 'Love wins all' Official MV (인트로 폐허 대화 20.0초)
  'm3DZsBw5bnE': 20.0,
  'yt-m3DZsBw5bnE': 20.0,
  // BTS 'Dynamite' Official MV (도입부 대기 7.0초)
  'gdZLi9oWNZg': 7.0,
  'yt-gdZLi9oWNZg': 7.0,
  // BTS 'Butter' Official MV (도입부 3.0초)
  'WMweEpGlu_U': 3.0,
  'yt-WMweEpGlu_U': 3.0,
  // 정국 Seven 음원 및 가사 비디오 (인트로 없음 = 0.0초)
  '1QYBiNRu1ok': 0.0,
  'yt-1QYBiNRu1ok': 0.0,
  'fc7qcKMBrLI': 0.0,
  'yt-fc7qcKMBrLI': 0.0,
};

export class LyricsService {
  constructor() {
    this.rawLrcCache = new Map();
  }

  // 곡 제목 및 아티스트 지능형 추출 (따옴표 제목, 영/한 이중 표기 아티스트 완벽 분리)
  extractCandidates(rawTitle, rawArtist) {
    const title = (rawTitle || '').trim();
    const artist = (rawArtist || '').trim();

    // 1. 곡 제목 후보군 추출
    const quoteMatch = title.match(/['"「『]([^'"」』]{2,50})['"」』]/);
    const quotedTitle = quoteMatch ? quoteMatch[1].trim() : '';

    let cleanTitle = title
      .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Performance|Teaser|Full Album|Color Coded|Prod\..*?|4K|세로캠|Live|교차편집).*?\]/gi, '')
      .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Performance|Teaser|Full Album|Color Coded|Prod\..*?|4K|세로캠|Live|교차편집).*?\)/gi, '')
      .replace(/【.*?】/g, '')
      .replace(/feat\..*$/i, '')
      .replace(/\(feat\..*?\)/i, '')
      .replace(/M\/V|MV|Official|Music Video/gi, '')
      .replace(/['"「『』」]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // "아티스트 - 곡명" 분리
    let hyphenTitle = '';
    let hyphenArtist = '';
    if (cleanTitle.includes(' - ')) {
      const parts = cleanTitle.split(' - ');
      if (parts.length >= 2) {
        hyphenArtist = parts[0].trim();
        hyphenTitle = parts[1].trim();
      }
    }

    const titleCandidates = [];
    if (quotedTitle) titleCandidates.push(quotedTitle);
    if (hyphenTitle && !titleCandidates.includes(hyphenTitle)) titleCandidates.push(hyphenTitle);
    if (cleanTitle && !titleCandidates.includes(cleanTitle)) titleCandidates.push(cleanTitle);

    // 2. 아티스트 후보군 추출 (PLAVE 플레이브 -> PLAVE, 플레이브 분리)
    let prefixArtist = '';
    if (quoteMatch && quoteMatch.index > 0) {
      prefixArtist = title.substring(0, quoteMatch.index).trim();
    }

    const artistCandidates = [];
    const addArtistCandidate = (name) => {
      if (!name) return;
      const clean = name
        .replace(/ - Topic/gi, '')
        .replace(/ Official/gi, '')
        .replace(/ Channel/gi, '')
        .replace(/ VE/gi, '')
        .replace(/ Ent\./gi, '')
        .replace(/ Entertainment/gi, '')
        .replace(/ 레이블/gi, '')
        .replace(/[\(\)\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!clean) return;

      // 영문 단어 추출 (예: "PLAVE")
      const eng = clean.match(/[a-zA-Z0-9\s&]{2,}/);
      if (eng && eng[0].trim().length >= 2) {
        const engVal = eng[0].trim();
        if (!artistCandidates.includes(engVal)) artistCandidates.push(engVal);
      }

      // 한글 단어 추출 (예: "플레이브")
      const kor = clean.match(/[가-힣\s]{2,}/);
      if (kor && kor[0].trim().length >= 2) {
        const korVal = kor[0].trim();
        if (!artistCandidates.includes(korVal)) artistCandidates.push(korVal);
      }

      if (!artistCandidates.includes(clean)) {
        artistCandidates.push(clean);
      }
    };

    [artist, prefixArtist, hyphenArtist].forEach(addArtistCandidate);

    return {
      titleCandidates,
      artistCandidates: artistCandidates.slice(0, 5)
    };
  }

  // 곡에 대한 맞춤 싱크 오프셋 결정 (사용자 저장값 > 유명 MV 프리셋 > 지능형 시간차 추정)
  getOffsetForTrack(track, lrcData = null) {
    if (!track) return 0;
    const trackKey = track.id || track.videoId || '';

    // 1. 사용자가 직접 조정한 저장값 (최우선 반영)
    if (trackKey) {
      const saved = localStorage.getItem('streamvance_lyric_offset_' + trackKey);
      if (saved !== null && !isNaN(parseFloat(saved))) {
        return parseFloat(saved);
      }
    }
    if (track.title) {
      const savedByTitle = localStorage.getItem('streamvance_lyric_offset_' + encodeURIComponent(track.title.trim()));
      if (savedByTitle !== null && !isNaN(parseFloat(savedByTitle))) {
        return parseFloat(savedByTitle);
      }
    }

    // 2. 검증된 대표 공식 MV 프리셋 테이블
    const rawId = track.videoId || trackKey.replace(/^(yt|chart)-/, '');
    if (KNOWN_MV_OFFSETS[rawId] !== undefined) {
      return KNOWN_MV_OFFSETS[rawId];
    }
    if (KNOWN_MV_OFFSETS[trackKey] !== undefined) {
      return KNOWN_MV_OFFSETS[trackKey];
    }
    if (KNOWN_MV_OFFSETS[`yt-${rawId}`] !== undefined) {
      return KNOWN_MV_OFFSETS[`yt-${rawId}`];
    }

    // 3. 곡 제목 및 아티스트 기반 키워드 매칭
    const tLow = (track.title || '').toLowerCase();
    const aLow = (track.artist || '').toLowerCase();
    const isMv = /m[\/\s]?v|music\s*video|official\s*video/i.test(tLow);

    if (tLow.includes('seven') && (aLow.includes('jung kook') || aLow.includes('정국') || tLow.includes('정국')) && isMv) {
      return 34.5;
    }
    if (tLow.includes('pump up the volume') && (aLow.includes('plave') || aLow.includes('플레이브') || tLow.includes('플레이브'))) {
      return 16.0;
    }

    // 4. 지능형 재생시간 델타 분석 (유튜브 영상 길이 vs LRCLIB 정품 음원 길이)
    // 유튜브 공식 영상/MV는 오프닝 인트로 및 로고 사운드로 인해 정품 음원보다 김
    if (lrcData && lrcData.duration && track.duration) {
      const diff = track.duration - lrcData.duration;
      // 1.5초 ~ 12초 차이: 표준적인 MV 오프닝/인트로 사운드 차이
      if (diff >= 1.5 && diff <= 12.0) {
        return Math.round(diff * 10) / 10;
      }
      // 12초 이상 차이: 드라마 스킷 인트로 + 크레딧 엔딩 (엔딩 5초 제외)
      if (diff > 12.0 && diff <= 40.0) {
        return Math.max(0, Math.round((diff - 5.0) * 10) / 10);
      }
    }

    return 0;
  }

  // 사용자의 싱크 오프셋 저장
  saveCustomOffset(track, offset) {
    if (!track) return;
    const trackKey = track.id || track.videoId || '';
    if (trackKey) {
      localStorage.setItem('streamvance_lyric_offset_' + trackKey, offset);
    }
    if (track.title) {
      localStorage.setItem('streamvance_lyric_offset_' + encodeURIComponent(track.title.trim()), offset);
    }
  }

  // 실시간으로 가사 오프셋 재계산 (네트워크 재요청 없이 밀리초 단위 즉시 업데이트)
  adjustLyricsOffset(lyrics, newOffset) {
    if (!Array.isArray(lyrics)) return lyrics;
    lyrics.forEach(line => {
      const baseTime = (line.originalTime !== undefined) ? line.originalTime : line.time;
      line.originalTime = baseTime;
      line.time = Math.max(0, Math.round((baseTime + newOffset) * 100) / 100);
    });
    return lyrics;
  }

  // 대기열 및 다음 곡 가사 백그라운드 사전 로드 (다음 곡 전환 시 0ms 즉각 가사 출력)
  async prefetchLyrics(track) {
    if (!track) return;
    const trackKey = track.id || track.videoId || track.title;
    if (this.rawLrcCache.has(trackKey)) return;
    try {
      if (localStorage.getItem(`lyrics_raw_v4_${trackKey}`)) return;
    } catch (e) {}

    setTimeout(() => {
      this.getLyrics(track).catch(() => {});
    }, 80);
  }

  // 트랙에 대한 실시간 싱크 가사 가져오기
  async getLyrics(track) {
    if (!track) return [];

    const trackKey = track.id || track.videoId || track.title;
    let rawData = this.rawLrcCache.get(trackKey);

    if (!rawData) {
      // 로컬 스토리지 원본 캐시 확인
      try {
        const stored = localStorage.getItem(`lyrics_raw_v4_${trackKey}`);
        if (stored) {
          rawData = JSON.parse(stored);
        }
      } catch (e) {}
    }

    if (!rawData) {
      const { titleCandidates, artistCandidates } = this.extractCandidates(track.title, track.artist);

      try {
        let data = null;

        // 1. 고속 병렬 질의: 가장 유력한 후보들을 병렬로 동시 요청 (직렬 대기 지연 5배 단축)
        const primaryTitle = titleCandidates[0] || track.title;
        const primaryArtist = artistCandidates[0] || track.artist;

        const parallelFetches = [];

        // A. 정밀 get API 요청
        if (primaryTitle && primaryArtist) {
          const q = new URLSearchParams({ track_name: primaryTitle, artist_name: primaryArtist });
          if (track.duration) q.append('duration', Math.round(track.duration));
          parallelFetches.push(
            fetch(`https://lrclib.net/api/get?${q.toString()}`, {
              headers: { 'User-Agent': 'Streamvance/2.0' }
            }).then(r => r.ok ? r.json() : null).catch(() => null)
          );
        }

        // B. 유연 search API 동시 병렬 요청
        const searchQuery = `${primaryTitle} ${primaryArtist}`.trim();
        if (searchQuery) {
          parallelFetches.push(
            fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`, {
              headers: { 'User-Agent': 'Streamvance/2.0' }
            }).then(r => r.ok ? r.json() : null).catch(() => null)
          );
        }

        // 2순위 후보도 준비되어 있다면 병렬 풀에 추가
        if (titleCandidates[1] || artistCandidates[1]) {
          const altTitle = titleCandidates[1] || primaryTitle;
          const altArtist = artistCandidates[1] || primaryArtist;
          const qAlt = new URLSearchParams({ track_name: altTitle, artist_name: altArtist });
          if (track.duration) qAlt.append('duration', Math.round(track.duration));
          parallelFetches.push(
            fetch(`https://lrclib.net/api/get?${qAlt.toString()}`, {
              headers: { 'User-Agent': 'Streamvance/2.0' }
            }).then(r => r.ok ? r.json() : null).catch(() => null)
          );
        }

        const results = await Promise.allSettled(parallelFetches);
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value) {
            const val = res.value;
            // A형 응답: 단일 객체
            if (val && !Array.isArray(val) && (val.syncedLyrics || val.plainLyrics)) {
              if (val.syncedLyrics) {
                data = val;
                break;
              } else if (!data) {
                data = val;
              }
            }
            // B형 응답: 배열
            else if (Array.isArray(val) && val.length > 0) {
              if (track.duration) {
                val.sort((a, b) => Math.abs((a.duration || 0) - track.duration) - Math.abs((b.duration || 0) - track.duration));
              }
              const bestSynced = val.find(item => item.syncedLyrics);
              if (bestSynced) {
                data = bestSynced;
                break;
              } else if (!data && val[0]) {
                data = val[0];
              }
            }
          }
        }

        if (data) {
          rawData = data;
          this.rawLrcCache.set(trackKey, data);
          try {
            localStorage.setItem(`lyrics_raw_v4_${trackKey}`, JSON.stringify(data));
          } catch (e) {}
        }
      } catch (err) {
        console.warn("Failed to fetch real-time lyrics from LRCLIB:", err);
      }
    }

    // 오프셋 계산 (사용자 설정 > MV 프리셋 > 지능형 시간차)
    const offset = this.getOffsetForTrack(track, rawData);
    track.lyricsOffset = offset;

    if (rawData && rawData.syncedLyrics) {
      const parsedLyrics = this.parseLRC(rawData.syncedLyrics, offset);
      if (parsedLyrics.length > 0) {
        return parsedLyrics;
      }
    }

    // 일반 줄 가사만 있는 경우
    if (rawData && rawData.plainLyrics) {
      const lines = rawData.plainLyrics.split('\n').filter(l => l.trim().length > 0);
      const interval = track.duration ? (track.duration / Math.max(lines.length, 1)) : 5;
      const plainSync = lines.map((text, idx) => {
        const originalTime = idx * interval;
        return {
          originalTime: originalTime,
          time: Math.max(0, Math.round((originalTime + offset) * 100) / 100),
          text: text.trim()
        };
      });
      return plainSync;
    }

    // 3. 더미 가사가 아닌 실제 유효 가사만 폴백
    if (track.lyrics && track.lyrics.length > 0) {
      const isDummy = track.lyrics.some(l => l.text && (l.text.includes('재생 중') || l.text.includes('스트리밍')));
      if (!isDummy) {
        return this.adjustLyricsOffset(track.lyrics, offset);
      }
    }

    return [];
  }

  // LRC 형식 ([01:23.45] 가사 내용)을 밀리초 정확도의 객체 배열로 파싱 및 오프셋 적용
  parseLRC(lrcText, offset = 0) {
    if (!lrcText) return [];

    // 1. LRC 파일 내부의 [offset: ±밀리초] 태그 파싱 (예: [offset:1200] -> +1.2초)
    let internalOffset = 0;
    const offsetTagMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\]/i);
    if (offsetTagMatch) {
      internalOffset = parseFloat(offsetTagMatch[1]) / 1000.0;
    }
    const totalOffset = offset + internalOffset;

    const lines = lrcText.split('\n');
    const result = [];
    const timeGlobalRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

    for (const rawLine of lines) {
      const timeMatches = [...rawLine.matchAll(timeGlobalRegex)];
      if (timeMatches.length > 0) {
        const text = rawLine.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();

        // 메타태그나 빈 줄 무시
        if (text && !text.startsWith('ti:') && !text.startsWith('ar:') && !text.startsWith('al:') && !text.startsWith('by:') && !text.startsWith('offset:')) {
          for (const match of timeMatches) {
            const min = parseInt(match[1], 10);
            const sec = parseInt(match[2], 10);
            const ms = parseFloat('0.' + match[3]);
            const originalTime = min * 60 + sec + ms;
            const adjustedTime = Math.max(0, Math.round((originalTime + totalOffset) * 100) / 100);

            result.push({
              originalTime: Math.round(originalTime * 100) / 100,
              time: adjustedTime,
              text: text,
              isInstrumental: false
            });
          }
        }
      }
    }

    result.sort((a, b) => a.time - b.time);

    // [전주 연주 중] 처리: 첫 번째 가사가 3초 이상 뒤에 시작된다면 0초에 전주 안내 표시
    if (result.length > 0 && result[0].time > 3.0) {
      result.unshift({
        originalTime: 0,
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
          const originalTime = result[i].originalTime + 3.0;
          withInstrumentals.push({
            originalTime: originalTime,
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
