// ==========================================================================
// Google Takeout YouTube History Importer & Smart Algorithm Recommender
// 구글 테이크아웃(시청기록/검색기록 파일) 브라우저 100% 로컬 즉시 분석 및 취향 알고리즘 반영
// ==========================================================================

export class TakeoutService {
  constructor(authManager, uiManager) {
    this.auth = authManager;
    this.ui = uiManager;
  }

  // 파일 파싱 메인 진입점 (JSON 또는 HTML 자동 판별)
  async importFile(file) {
    if (!file) throw new Error('파일이 선택되지 않았습니다.');

    const fileName = file.name.toLowerCase();
    const text = await file.text();

    if (fileName.endsWith('.json') || text.trim().startsWith('[')) {
      return this.parseJsonHistory(text);
    } else if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
      return this.parseHtmlHistory(text);
    } else {
      // 텍스트 기반 시도
      try {
        return this.parseJsonHistory(text);
      } catch (e) {
        return this.parseHtmlHistory(text);
      }
    }
  }

  // 1. JSON 포맷 파싱 (watch-history.json / search-history.json)
  parseJsonHistory(jsonText) {
    let rawItems = [];
    try {
      rawItems = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('유효한 JSON 파일 형식이 아닙니다.');
    }

    if (!Array.isArray(rawItems)) {
      throw new Error('YouTube 기록 배열을 찾을 수 없습니다.');
    }

    const musicHistory = [];
    const artistCount = new Map();
    const trackCount = new Map();

    for (const item of rawItems) {
      if (!item.title) continue;

      let title = item.title;
      // "Watched ..." 또는 "시청한 동영상: ..." 접두사 제거
      title = title.replace(/^(Watched|시청한\s*동영상\s*:?|조회한\s*동영상\s*:?)\s*/i, '').trim();

      // 채널/아티스트 추출
      let artist = '';
      if (item.subtitles && item.subtitles.length > 0) {
        artist = item.subtitles[0].name || '';
      }
      artist = artist.replace(/ - Topic$/i, '').trim();

      // YouTube Video ID 추출
      let videoId = '';
      const url = item.titleUrl || '';
      const vMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (vMatch) {
        videoId = vMatch[1];
      }

      // 비디오 ID가 있고 유효한 제목이면 음악 기록으로 정규화
      if (videoId && title) {
        const trackObj = {
          id: `yt-${videoId}`,
          videoId: videoId,
          title: title,
          artist: artist || 'YouTube Music',
          album: item.header === 'YouTube Music' ? 'YouTube Music' : 'YouTube 시청 기록',
          duration: 210,
          cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          timeStr: item.time || '',
          timestamp: item.time ? new Date(item.time).getTime() : Date.now()
        };

        musicHistory.push(trackObj);

        // 아티스트 빈도수
        if (artist && artist !== 'YouTube Music') {
          artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
        }

        // 트랙 빈도수
        const trackKey = `${title}__${artist}`;
        if (!trackCount.has(trackKey)) {
          trackCount.set(trackKey, { track: trackObj, count: 0 });
        }
        trackCount.get(trackKey).count += 1;
      }
    }

    return this.processExtractedData(musicHistory, artistCount, trackCount);
  }

  // 2. HTML 포맷 파싱 (watch-history.html)
  parseHtmlHistory(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const cells = doc.querySelectorAll('.content-cell, .mdl-typography--body-1');

    const musicHistory = [];
    const artistCount = new Map();
    const trackCount = new Map();

    cells.forEach(cell => {
      const links = cell.querySelectorAll('a');
      if (links.length === 0) return;

      const titleLink = links[0];
      let title = titleLink.textContent.trim();
      title = title.replace(/^(Watched|시청한\s*동영상\s*:?|조회한\s*동영상\s*:?)\s*/i, '').trim();

      const href = titleLink.getAttribute('href') || '';
      const vMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      const videoId = vMatch ? vMatch[1] : '';

      let artist = '';
      if (links.length > 1) {
        artist = links[1].textContent.trim().replace(/ - Topic$/i, '');
      }

      if (videoId && title) {
        const trackObj = {
          id: `yt-${videoId}`,
          videoId: videoId,
          title: title,
          artist: artist || 'YouTube Music',
          album: 'YouTube 시청 기록',
          duration: 210,
          cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          timestamp: Date.now()
        };

        musicHistory.push(trackObj);

        if (artist && artist !== 'YouTube Music') {
          artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
        }

        const trackKey = `${title}__${artist}`;
        if (!trackCount.has(trackKey)) {
          trackCount.set(trackKey, { track: trackObj, count: 0 });
        }
        trackCount.get(trackKey).count += 1;
      }
    });

    return this.processExtractedData(musicHistory, artistCount, trackCount);
  }

  // 3. 추출된 데이터를 가공하여 사이트 전역 알고리즘에 즉각 반영
  processExtractedData(musicHistory, artistCount, trackCount) {
    if (musicHistory.length === 0) {
      throw new Error('파일에서 유효한 YouTube 시청 기록을 찾을 수 없습니다.');
    }

    // 최다 감상 트랙 순위 정렬
    const topTracks = Array.from(trackCount.values())
      .sort((a, b) => b.count - a.count)
      .map(item => ({ ...item.track, playCount: item.count }));

    // 최다 감상 아티스트 순위 정렬
    const topArtists = Array.from(artistCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([artist, count]) => ({ artist, count }));

    return {
      totalCount: musicHistory.length,
      recentHistory: musicHistory.slice(0, 100),
      topTracks: topTracks.slice(0, 30),
      topArtists: topArtists.slice(0, 10)
    };
  }

  // 4. 분석 결과를 사이트 로컬 스토리지 및 UI에 실시간 주입
  applyToApp(result, allTracksRef) {
    const { recentHistory, topTracks, topArtists, totalCount } = result;

    // 1) 보관함 히스토리에 최근 시청 기록 주입
    if (this.ui) {
      const mergedHistory = [...recentHistory];
      if (Array.isArray(this.ui.playHistory)) {
        this.ui.playHistory.forEach(old => {
          if (!mergedHistory.find(m => m.id === old.id || m.videoId === old.videoId)) {
            mergedHistory.push(old);
          }
        });
      }
      this.ui.playHistory = mergedHistory.slice(0, 150);
      try {
        localStorage.setItem('streamvance_history', JSON.stringify(this.ui.playHistory));
      } catch (e) {}
    }

    // 2) 전역 트랙 풀(`allTracks`)에 인기 상위곡들 우선 등록
    if (Array.isArray(allTracksRef)) {
      topTracks.forEach(t => {
        if (!allTracksRef.find(item => item.id === t.id || item.videoId === t.videoId)) {
          allTracksRef.unshift(t);
        }
      });
    }

    // 3) 사용자 취향 데이터 로컬 스토리지 저장 (게스트 사용자에게도 즉시 영구 저장)
    try {
      localStorage.setItem('streamvance_takeout_top_artists', JSON.stringify(topArtists));
      localStorage.setItem('streamvance_takeout_top_tracks', JSON.stringify(topTracks));
      localStorage.setItem('streamvance_takeout_synced_at', Date.now());
    } catch (e) {}

    // 4) UI 토스트 알림
    this.ui.showToast(`YouTube 시청기록 ${totalCount.toLocaleString()}건 분석 완료! 맞춤 추천에 반영되었습니다.`);

    return {
      topArtists,
      topTracks
    };
  }
}
