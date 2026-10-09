// ==========================================================================
// Main Application Entry Point
// ==========================================================================

import { sampleTracks, sampleAlbums, genresData } from './data.js';
import { AudioPlayer } from './audioPlayer.js';
import { UIManager } from './ui.js';
import { YouTubeSearchService } from './searchService.js';
import { AuthManager, DEFAULT_GOOGLE_CLIENT_ID } from './auth.js';
import { LyricsService } from './lyricsService.js';
import { ColorExtractor } from './colorExtractor.js';
import { PiPManager } from './pipManager.js';
import { TakeoutService } from './takeoutService.js';
import { offlineStorage } from './offlineStorage.js';

function initApp() {
  // 1. Initialize Core Engine & UI
  const audioElement = document.getElementById('main-audio');
  const player = new AudioPlayer(audioElement);
  const ui = new UIManager(player);
  const auth = new AuthManager(ui, player);
  const lyricsService = new LyricsService();
  const searchService = new YouTubeSearchService();
  const colorExtractor = new ColorExtractor();
  const pipManager = new PiPManager(player, ui, lyricsService);
  window.pipManager = pipManager;
  const takeoutService = new TakeoutService(auth, ui);

  let allTracks = [...sampleTracks];
  let currentMood = 'all';
  auth.setAllTracks(allTracks);
  window.allTracks = allTracks;
  ui.updateOfflineBadgeCount();

  // 대기열 순서 변경 이벤트 연동
  ui.onQueueReorder = (sourceIndex, targetIndex) => {
    if (sourceIndex >= 0 && sourceIndex < player.queue.length && targetIndex >= 0 && targetIndex < player.queue.length) {
      const [moved] = player.queue.splice(sourceIndex, 1);
      player.queue.splice(targetIndex, 0, moved);
      ui.renderQueue(player.queue, player.currentIndex);
      ui.showToast('대기열 순서가 변경되었습니다.');
    }
  };

  // 2. Setup Audio Player Callbacks
  player.callbacks.onTrackChange = (track, index) => {
    if (track) {
      try {
        localStorage.setItem('streamvance_last_track', JSON.stringify({
          id: track.id,
          videoId: track.videoId,
          title: track.title,
          artist: track.artist,
          album: track.album || '',
          duration: track.duration || 0,
          cover: track.cover,
          genre: track.genre || 'pop',
          mood: track.mood || 'energy',
          audioUrl: track.audioUrl || null
        }));
      } catch (e) {}
    }
    ui.updateCurrentTrackUI(track);
    ui.renderRelated(track, allTracks);
    ui.renderQueue(player.queue, player.currentIndex);
    pipManager.updatePiPContent();

    // 앨범 아트 대표 색상 추출 및 배경 앰비언트 그라데이션 동적 적용 (100% 불투명)
    colorExtractor.extract(track.cover, rgb => {
      colorExtractor.applyToDOM(rgb);
    });

    // 모바일 전용 시크바 및 바텀시트 메타 실시간 갱신
    const mobileDuration = document.getElementById('mobile-duration-time');
    if (mobileDuration && track.duration) {
      mobileDuration.textContent = ui.formatTime(track.duration);
    }
    const sheetCover = document.getElementById('sheet-cover-img');
    const sheetTitle = document.getElementById('sheet-track-title');
    const sheetArtist = document.getElementById('sheet-track-artist');
    if (sheetCover) sheetCover.src = track.cover;
    if (sheetTitle) sheetTitle.textContent = track.title;
    if (sheetArtist) sheetArtist.textContent = `${track.artist} • ${ui.formatTime(track.duration)}`;

    // 실시간 정밀 싱크 가사 자동 로딩 (캐시가 있으면 0ms 즉시 렌더링, 없으면 초고속 로드)
    if (track.lyrics && track.lyrics.length > 0) {
      ui.renderLyrics(track.lyrics, track.lyricsOffset);
    } else {
      ui.setLyricsLoading();
    }

    lyricsService.getLyrics(track).then(liveLyrics => {
      const current = player.getCurrentTrack();
      if (current && (current.id === track.id || current.videoId === track.videoId)) {
        current.lyrics = liveLyrics;
        ui.renderLyrics(liveLyrics, current.lyricsOffset);
      }
    }).catch(err => {
      console.warn("Lyrics fetch error:", err);
    });

    // 다음 대기열 트랙 1~2곡 가사 백그라운드 사전 로드 (다음 곡 전환 시 0ms 즉각 가사 출력)
    const nextTrack1 = player.queue[player.currentIndex + 1];
    const nextTrack2 = player.queue[player.currentIndex + 2];
    if (nextTrack1) lyricsService.prefetchLyrics(nextTrack1);
    if (nextTrack2) lyricsService.prefetchLyrics(nextTrack2);

    // 재생 히스토리 반영하여 빠른 선곡 실시간 갱신
    updatePersonalizedQuickPicks();

    // 실시간 댓글 백그라운드 프리페치 (사용자가 댓글 버튼 클릭 시 0ms 즉각 로드)
    const curVid = track.videoId || (track.id || '').replace(/^yt-/, '');
    if (curVid && curVid.length === 11) {
      setTimeout(() => {
        const cacheKey = `${curVid}_top`;
        if (ui.commentsCache && !ui.commentsCache.has(cacheKey)) {
          fetch(`/api/comments?id=${encodeURIComponent(curVid)}&sort=top`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) ui.commentsCache.set(cacheKey, d); })
            .catch(() => {});
        }
      }, 300);
    }

    // 다음 대기열이 얼마 안 남았으면 유사 음악 자동 큐잉
    if (player.queue.length - player.currentIndex <= 2) {
      autoQueueSimilarTracks(track);
    }
  };

  player.callbacks.onAutoRecommendNext = (cur) => {
    return autoQueueSimilarTracks(cur);
  };

  player.callbacks.onQueueNearEnd = () => {
    const cur = player.getCurrentTrack();
    if (cur) autoQueueSimilarTracks(cur);
  };

  player.callbacks.onPlayStateChange = (isPlaying) => {
    ui.updatePlayStateUI(isPlaying);
    pipManager.updatePiPContent();

    // 모바일 대형 재생 버튼 아이콘 동기화
    const mobilePlayBtn = document.getElementById('btn-mobile-play');
    if (mobilePlayBtn) {
      if (isPlaying) {
        mobilePlayBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"></rect>
            <rect x="14" y="4" width="4" height="16" rx="1"></rect>
          </svg>
        `;
        mobilePlayBtn.setAttribute('title', '일시정지');
      } else {
        mobilePlayBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        `;
        mobilePlayBtn.setAttribute('title', '재생');
      }
    }
  };

  player.callbacks.onTimeUpdate = (current, duration, percent, bufferPercent = 0) => {
    ui.updateProgressUI(current, duration, percent, bufferPercent);

    // 모바일 시크바 및 시간 실시간 동기화
    const mobileCurrent = document.getElementById('mobile-current-time');
    const mobileDuration = document.getElementById('mobile-duration-time');
    const mobileFill = document.getElementById('mobile-seek-bar-fill');
    const mobileInput = document.getElementById('mobile-seek-input');

    if (mobileCurrent) mobileCurrent.textContent = ui.formatTime(current);
    if (mobileDuration && duration > 0) mobileDuration.textContent = ui.formatTime(duration);
    if (mobileFill) mobileFill.style.width = `${percent}%`;
    if (mobileInput && !ui.isSeeking) mobileInput.value = percent;

    // PiP 화면에 현재 가사 및 진행률 실시간 반영
    const activeLyric = document.querySelector('.lyric-line.active');
    const lyricText = activeLyric ? activeLyric.textContent.trim() : '';
    pipManager.syncPiPProgress(current, duration, percent, lyricText);
  };

  player.callbacks.onQueueUpdate = (queue, currentIndex) => {
    ui.renderQueue(queue, currentIndex);
  };

  player.callbacks.onVolumeChange = (volume, isMuted) => {
    if (ui.dom.volumeSlider) ui.dom.volumeSlider.value = isMuted ? 0 : volume;
    const volBtn = document.getElementById('btn-volume-toggle');
    if (volBtn) {
      if (isMuted || volume === 0) {
        volBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="22" y1="9" x2="16" y2="15"></line>
            <line x1="16" y1="9" x2="22" y2="15"></line>
          </svg>
        `;
      } else if (volume < 0.5) {
        volBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        `;
      } else {
        volBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        `;
      }
    }
  };

  // ==========================================================================
  // 비음악(토크/썰/상황극/shorts/잡담) 및 플레이리스트 모음 엄격 감지 필터
  // ==========================================================================
  function isNonMusicTrack(track) {
    if (!track) return false;
    const title = (track.title || '').toLowerCase();
    const artist = (track.artist || '').toLowerCase();
    const album = (track.album || '').toLowerCase();
    const combined = `${title} ${artist} ${album}`;

    const nonMusicKeywords = [
      '사장님도 대답', '대답!', '토크', 'talk', '썰', '상황극', '더빙',
      '쇼츠', 'shorts', '#shorts', '개그', '애니', '만화', '상담',
      '잡담', '라디오', '브이로그', 'vlog', '먹방', 'mukbang', '게임', 'game',
      '플레이', 'playthrough', '하이라이트', 'highlight', '클립', 'clip',
      '리액션', 'reaction', '비하인드', 'behind', '메이킹', 'making',
      '인터뷰', 'interview', '공지', 'notice', '생방송', '라이브 방송',
      '다시보기', 'archive', '풀영상', '후기', '소통', 'q&a', 'qna',
      '월드컵', '이상형', '영도'
    ];
    if (nonMusicKeywords.some(kw => combined.includes(kw))) return true;

    // 스트리머/버튜버/크리에이터 일상 대화 및 썰 영상 감지:
    // 제목에 일상 토크 어휘가 있고 음악 식별자가 전혀 없으면 비음악으로 판정
    const chatterWords = ['ㅋㅋㅋ', 'ㅎㅎㅎ', '?!', '대답', '질문', '고민', '고백', '썰푼', '썰풀기', '참교육', '반응'];
    const musicTokens = ['mv', 'm/v', 'official', 'audio', '음원', '노래', '곡', 'cover', '커버', 'song', 'track', 'feat', 'ost', 'lyrics', '가사', '|', '-'];
    if (chatterWords.some(cw => title.includes(cw)) && !musicTokens.some(mt => title.includes(mt))) {
      return true;
    }

    return false;
  }

  function isCompilationTrack(track) {
    if (!track) return true;
    if (track.isCompilation) return true;
    const title = (track.title || '').toLowerCase();
    const artist = (track.artist || '').toLowerCase();
    const combined = `${title} ${artist}`;

    const compilationKeywords = [
      '차트둥이', '플레이리스트', 'playlist', '노래모음', '모음', '종합차트', '차트 x',
      '1시간', '1hour', 'top 100', 'top100', 'top 50', 'top50', '멜론', 'melon',
      '연속듣기', '인기가요', '주차', '2025년', '2026년', '2024년', 'mix', '연속 재생',
      '광고없는', 'best songs', 'greatest hits', 'hit songs', 'compilation'
    ];
    if (compilationKeywords.some(kw => combined.includes(kw))) return true;
    if (track.duration && (track.duration > 480 || track.duration < 65)) return true;
    return false;
  }

  // ==========================================================================
  // 실시간 사용자 취향 기반 빠른 선곡 (Dynamic Taste-based Quick Picks)
  // ==========================================================================
  function getPersonalizedQuickPicks() {
    // 1) 후보 풀: allTracks + playHistory + likedTracksMap 합치기 (비음악/컴필레이션 원천 배제)
    const poolMap = new Map();
    allTracks.forEach(t => poolMap.set(t.id, t));
    ui.playHistory.forEach(t => poolMap.set(t.id, t));
    ui.likedTracksMap.forEach(t => poolMap.set(t.id, t));
    const rawCandidatePool = Array.from(poolMap.values());
    const candidatePool = rawCandidatePool.filter(t => !isNonMusicTrack(t) && !isCompilationTrack(t));

    const taste = auth.analyzeUserTaste(candidatePool);
    const topGenres = new Set(taste.genres.slice(0, 3).map(g => g.genre));
    const topArtists = new Set(taste.artists.map(a => a.artist.toLowerCase()));
    const recentPlayedArtists = new Set(ui.playHistory.slice(0, 10).map(h => (h.artist || '').toLowerCase()));

    // 최근 검색어 및 삭제된 검색어 반영
    let activeSearches = [];
    let deletedSearches = [];
    try {
      activeSearches = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]').map(s => s.toLowerCase());
      deletedSearches = JSON.parse(localStorage.getItem('streamvance_deleted_searches') || '[]').map(s => s.toLowerCase());
    } catch (e) {}

    // 개인 맞춤 스코어링
    const scored = candidatePool.map((track, idx) => {
      let score = 0;
      const tArtist = (track.artist || '').toLowerCase();
      const tTitle = (track.title || '').toLowerCase();
      
      // 1) 사용자가 삭제한 검색어에 해당하는 아티스트/곡은 알고리즘에서 강력 감점 (추천 배제)
      const isDeletedMatch = deletedSearches.some(ds => ds.length >= 2 && (tArtist.includes(ds) || ds.includes(tArtist) || tTitle.includes(ds)));
      if (isDeletedMatch) {
        score -= 200;
      }

      // 2) 활성 최근 검색어에 해당하는 곡/아티스트는 맞춤 가산
      const isActiveSearchMatch = activeSearches.some(as => as.length >= 2 && (tArtist.includes(as) || as.includes(tArtist) || tTitle.includes(as)));
      if (isActiveSearchMatch) {
        score += 30;
      }

      const histIndex = ui.playHistory.findIndex(h => h.id === track.id || (h.videoId && h.videoId === track.videoId));
      if (histIndex >= 0) {
        score += Math.max(10, 50 - histIndex * 4);
      }
      
      if (recentPlayedArtists.has(tArtist)) score += 35;
      if (ui.likedTrackIds.has(track.id)) score += 25;
      if (topGenres.has(track.genre)) score += 15;
      if (topArtists.has(tArtist)) score += 20;
      if (track.mood === taste.topMood || track.mood === currentMood) score += 12;
      
      score += Math.random() * 5;
      return { track, score };
    });

    scored.sort((a, b) => b.score - a.score);
    let list = scored.map(item => item.track);

    if (currentMood !== 'all') {
      const filtered = list.filter(t => t.mood === currentMood || t.genre === currentMood);
      if (filtered.length >= 4) list = filtered;
    }

    return list.slice(0, 16);
  }

  function updatePersonalizedQuickPicks() {
    const personalized = getPersonalizedQuickPicks();
    ui.renderQuickPicks(personalized);
    if (window.lucide) window.lucide.createIcons();
  }

  // 자동재생 토글 상태 (Screenshot 1: 무제한 재생을 위해 유사한 노래를 추가)
  let isQueueAutoplay = true;
  const queueAutoplayToggle = document.getElementById('queue-autoplay-toggle');
  if (queueAutoplayToggle) {
    queueAutoplayToggle.addEventListener('change', (e) => {
      isQueueAutoplay = e.target.checked;
      ui.showToast(isQueueAutoplay ? '자동재생 켜짐 (유사한 노래 계속 추가)' : '자동재생 꺼짐');
    });
  }

  // 곡 선택 시 연관성 높은 맞춤 대기열 생성 엔진 (아티스트/장르/무드/청취기록 기반)
  function generateSmartQueue(selectedTrack, pool = allTracks) {
    if (!selectedTrack) return [];
    const cleanPool = pool.filter(t => !isNonMusicTrack(t) && !isCompilationTrack(t));
    const artist = (selectedTrack.artist || '').toLowerCase().trim();
    const genre = (selectedTrack.genre || '').toLowerCase().trim();
    const mood = (selectedTrack.mood || '').toLowerCase().trim();

    const queueSet = new Set();
    const result = [selectedTrack];
    queueSet.add(selectedTrack.id);
    if (selectedTrack.videoId) queueSet.add(selectedTrack.videoId);

    // 1. 같은 아티스트 곡 우선 (최대 3곡)
    if (artist && artist.length > 1) {
      const sameArtist = cleanPool.filter(t => 
        !queueSet.has(t.id) && 
        (!t.videoId || !queueSet.has(t.videoId)) &&
        (t.artist || '').toLowerCase().includes(artist)
      );
      for (const t of sameArtist.slice(0, 3)) {
        result.push(t);
        queueSet.add(t.id);
        if (t.videoId) queueSet.add(t.videoId);
      }
    }

    // 2. 같은 장르 / 분위기 곡 (최대 8곡)
    const sameGenreMood = cleanPool.filter(t =>
      !queueSet.has(t.id) &&
      (!t.videoId || !queueSet.has(t.videoId)) &&
      ((genre && (t.genre || '').toLowerCase() === genre) || 
       (mood && (t.mood || '').toLowerCase() === mood))
    );
    for (const t of sameGenreMood.slice(0, 8)) {
      result.push(t);
      queueSet.add(t.id);
      if (t.videoId) queueSet.add(t.videoId);
    }

    // 3. 사용자 취향 곡 및 인기 곡 추가 (총 16곡 내외 정예 큐 구성)
    const userPool = [...(ui.playHistory || []), ...(Array.from(ui.likedTracksMap.values()) || []), ...pool];
    for (const t of userPool) {
      if (t && !queueSet.has(t.id) && (!t.videoId || !queueSet.has(t.videoId)) && result.length < 16) {
        result.push(t);
        queueSet.add(t.id);
        if (t.videoId) queueSet.add(t.videoId);
      }
    }

    return result;
  }

  function playWithSmartQueue(targetTrack) {
    if (!targetTrack) return;
    const smartQ = generateSmartQueue(targetTrack, allTracks);
    player.setQueue(smartQ, 0, true);
  }

  // 유사 트랙 자동 큐잉 (YouTube /api/related 추천 기반 고지능 오토플레이 라디오)
  async function autoQueueSimilarTracks(currentTrack) {
    if (!isQueueAutoplay || !currentTrack) return false;
    const curVid = currentTrack.videoId || (currentTrack.id || '').replace(/^yt-/, '');
    const queueVideoIds = new Set(player.queue.map(t => t.videoId || t.id).filter(Boolean));

    // 1. YouTube 공식 추천 엔드포인트(/api/related) 실시간 비동기 연동
    if (curVid && curVid.length === 11) {
      try {
        const qUrl = `/api/related?id=${encodeURIComponent(curVid)}&artist=${encodeURIComponent(currentTrack.artist || '')}&title=${encodeURIComponent(currentTrack.title || '')}`;
        const res = await fetch(qUrl);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
            const freshTracks = data.tracks.filter(t => !queueVideoIds.has(t.videoId) && !queueVideoIds.has(t.id));
            if (freshTracks.length > 0) {
              freshTracks.slice(0, 5).forEach(t => player.queue.push(t));
              ui.renderQueue(player.queue, player.currentIndex);
              return true;
            }
          }
        }
      } catch (e) {}
    }

    // 2. Fallback: allTracks 내 유사 아티스트 및 장르 정밀 매칭 (무작위 엉뚱한 곡 배제)
    const curArtist = (currentTrack.artist || '').toLowerCase().trim();
    const curGenre = currentTrack.genre || 'pop';
    const curMood = currentTrack.mood || 'energy';
    const candidates = allTracks.filter(t => !queueVideoIds.has(t.videoId) && !queueVideoIds.has(t.id));

    const scored = candidates.map(t => {
      let score = 0;
      const tArt = (t.artist || '').toLowerCase();
      if (curArtist && (tArt.includes(curArtist) || curArtist.includes(tArt))) score += 40;
      if (t.genre === curGenre) score += 20;
      if (t.mood === curMood) score += 15;
      return { track: t, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    const similar = scored.slice(0, 4).map(s => s.track);
    if (similar.length > 0) {
      similar.forEach(t => player.queue.push(t));
      ui.renderQueue(player.queue, player.currentIndex);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // 아티스트 스포트라이트 (< > 아티스트 및 곡 전환 기능)
  // ==========================================================================
  const SPOTLIGHT_ARTISTS = [
    { name: "NewJeans", query: "NewJeans", image: "https://i.ytimg.com/vi/9wUKhEgnllc/hqdefault.jpg" },
    { name: "아이유 (IU)", query: "아이유", image: "https://i.ytimg.com/vi/JleoAppaxi0/hqdefault.jpg" },
    { name: "LE SSERAFIM", query: "LE SSERAFIM", image: "https://i.ytimg.com/vi/hLvWy2b857I/hqdefault.jpg" },
    { name: "IVE (아이브)", query: "IVE", image: "https://i.ytimg.com/vi/6ZUIwj3FgUY/hqdefault.jpg" },
    { name: "aespa (에스파)", query: "aespa", image: "https://i.ytimg.com/vi/phuiiNCxRMg/hqdefault.jpg" },
    { name: "ROSÉ", query: "ROSÉ", image: "https://i.ytimg.com/vi/ekr2nIex040/hqdefault.jpg" },
    { name: "성시경", query: "성시경", image: "https://i.ytimg.com/vi/3_nnLq4D3tc/hqdefault.jpg" },
    { name: "지코 (ZICO)", query: "지코", image: "https://i.ytimg.com/vi/azaZt7eccnc/hqdefault.jpg" }
  ];

  // 범용 아티스트 트랙 동적 로더 및 캐시 (특정 아티스트 하드코딩 완전 탈피 & 전 세계 모든 아티스트 100% 호환)
  const artistTracksCache = new Map();

  let currentSpotlightIndex = 0;

  // 사용자 맞춤 개인화 아티스트 목록 동적 생성 (사용자 요청: 감상 이력 기반 개인화 추천)
  function getPersonalizedSpotlightArtists() {
    const defaultList = [...SPOTLIGHT_ARTISTS];
    const artistScores = new Map();

    // 1) 좋아요한 곡 아티스트 점수
    if (ui.likedTracksMap) {
      ui.likedTracksMap.forEach(t => {
        if (t.artist) {
          const mainArtist = t.artist.split(/[•,&/]/)[0].trim();
          if (mainArtist && mainArtist.length >= 2) {
            artistScores.set(mainArtist, (artistScores.get(mainArtist) || 0) + 5);
          }
        }
      });
    }

    // 2) 최근 감상 기록 아티스트 점수
    if (ui.playHistory) {
      ui.playHistory.forEach(t => {
        if (t.artist) {
          const mainArtist = t.artist.split(/[•,&/]/)[0].trim();
          if (mainArtist && mainArtist.length >= 2) {
            artistScores.set(mainArtist, (artistScores.get(mainArtist) || 0) + 3);
          }
        }
      });
    }

    if (artistScores.size === 0) return defaultList;

    const sortedArtists = Array.from(artistScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    const personalized = [];
    sortedArtists.forEach(name => {
      const match = defaultList.find(a => a.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.name.toLowerCase()));
      if (match) {
        if (!personalized.find(p => p.name === match.name)) personalized.push(match);
      } else {
        const nLower = name.toLowerCase();
        const matched = allTracks.find(t => (t.artist || '').toLowerCase().includes(nLower)) ||
                        Array.from(ui.likedTracksMap.values()).find(t => (t.artist || '').toLowerCase().includes(nLower)) ||
                        (ui.playHistory || []).find(t => (t.artist || '').toLowerCase().includes(nLower));
        const sampleCover = matched?.cover || (defaultList[0] && defaultList[0].image) || 'https://i.ytimg.com/vi/9wUKhEgnllc/hqdefault.jpg';
        personalized.push({ name: name, query: name, image: sampleCover });
      }
    });

    defaultList.forEach(a => {
      if (!personalized.find(p => p.name === a.name)) personalized.push(a);
    });

    return personalized.slice(0, 10);
  }

  // 아티스트 전환 함수: 0ms 즉각 반응 & 오직 선택된 아티스트 노래만 필터링 (개인화 아티스트 반영)
  function switchSpotlightArtist(index) {
    const activeArtists = getPersonalizedSpotlightArtists();
    if (index < 0 || index >= activeArtists.length) return;
    currentSpotlightIndex = index;
    const artist = activeArtists[index];

    // 헤더 업데이트
    const spotlightTitle = document.getElementById('spotlight-artist-name');
    const spotlightImg = document.getElementById('spotlight-artist-img');
    if (spotlightTitle) spotlightTitle.textContent = artist.name;
    if (spotlightImg) {
      if (artist.image) spotlightImg.src = artist.image;
      spotlightImg.alt = artist.name;
      spotlightImg.onerror = function() {
        if (typeof window.handleArtistImgError === 'function') {
          window.handleArtistImgError(this, artist.name);
        }
      };
    }

    // 1) 메모리 캐시 또는 allTracks에서 해당 아티스트 곡 수집
    let artistTracks = artistTracksCache.get(artist.name) || [];
    const qLower = (artist.query || artist.name).toLowerCase().trim();

    if (artistTracks.length === 0) {
      artistTracks = allTracks.filter(t => {
        if (isNonMusicTrack(t) || isCompilationTrack(t)) return false;
        const art = (t.artist || '').toLowerCase();
        return art.includes(qLower) || (artist.name.toLowerCase().includes(art) && art.length >= 2);
      });
    }

    // 2) 0ms 즉시 화면 렌더링
    ui.renderSpotlight(artistTracks);
    ui.renderSpotlightChips(activeArtists, currentSpotlightIndex, (newIdx) => {
      switchSpotlightArtist(newIdx);
    });

    // 3) 스크롤 맨 앞으로 리셋
    const spotlightList = document.getElementById('spotlight-tracks-list');
    if (spotlightList) spotlightList.scrollTo({ left: 0, behavior: 'auto' });

    // 4) 실시간 온라인 정품 음원 동적 연동 (어떤 아티스트든 곡이 부족하면 즉각 고속 보충)
    if (artistTracks.length < 5) {
      searchService.searchOnline(`${artist.query || artist.name} 노래`).then(searchRes => {
        if (currentSpotlightIndex !== index) return;
        const onlineTracks = Array.isArray(searchRes) ? searchRes : (searchRes.tracks || searchRes.songs || []);
        let added = false;
        onlineTracks.forEach(ot => {
          if (isNonMusicTrack(ot) || isCompilationTrack(ot)) return;
          const art = (ot.artist || '').toLowerCase();
          const isTargetArtist = art.includes(qLower) || ot.title.toLowerCase().includes(qLower);
          if (isTargetArtist && !artistTracks.find(t => t.id === ot.id || t.videoId === ot.videoId)) {
            artistTracks.push(ot);
            if (!allTracks.find(t => t.id === ot.id || t.videoId === ot.videoId)) {
              allTracks.push(ot);
            }
            added = true;
          }
        });
        if (added && currentSpotlightIndex === index) {
          artistTracksCache.set(artist.name, artistTracks);
          ui.renderSpotlight(artistTracks);
        }
      }).catch(() => {});
    } else {
      artistTracksCache.set(artist.name, artistTracks);
    }
  }

  // ==========================================================================
  // 실시간 YouTube TOP 차트 로딩 (/api/charts) 및 글로벌 TOP 1 동적 갱신
  // ==========================================================================
  function getDetectedOrSavedCountry() {
    const saved = localStorage.getItem('streamvance_chart_country');
    if (saved) return saved.toUpperCase();

    // 1단계: 브라우저 시간대 기반 국가 감지
    try {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
      if (tz.includes('seoul')) return 'KR';
      if (tz.includes('tokyo')) return 'JP';
      if (tz.includes('london')) return 'GB';
      if (tz.includes('new_york') || tz.includes('los_angeles') || tz.includes('chicago') || tz.includes('america')) return 'US';
    } catch (e) {}

    // 2단계: 브라우저 언어 기반 국가 감지
    try {
      const lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
      if (lang.startsWith('ko')) return 'KR';
      if (lang.startsWith('ja')) return 'JP';
      if (lang.startsWith('en-gb')) return 'GB';
      if (lang.startsWith('en-us') || lang.startsWith('en')) return 'US';
    } catch (e) {}

    return 'KR'; // 한국 기본 추천
  }

  let currentChartCountry = getDetectedOrSavedCountry();

  async function loadLiveTopCharts(targetCountry = currentChartCountry) {
    currentChartCountry = targetCountry;
    localStorage.setItem('streamvance_chart_country', currentChartCountry);

    // 상단 및 계정 국가 선택 셀렉터 동기화
    const chartSelect = document.getElementById('chart-country-select');
    if (chartSelect && chartSelect.value !== currentChartCountry) {
      chartSelect.value = currentChartCountry;
    }
    const accSelect = document.getElementById('account-country-select');
    if (accSelect && accSelect.value !== currentChartCountry) {
      accSelect.value = currentChartCountry;
    }

    const authenticGlobalTop1Fallback = {
      id: "yt-ekr2nIex040",
      videoId: "ekr2nIex040",
      title: "APT.",
      artist: "로제 (ROSÉ), Bruno Mars",
      album: "rosie",
      genre: "k-pop",
      mood: "energy",
      duration: 170,
      cover: "https://i.ytimg.com/vi/ekr2nIex040/maxresdefault.jpg",
      lyrics: [],
      isLiked: false
    };

    try {
      const res = await fetch(`/api/charts?country=${encodeURIComponent(currentChartCountry)}`);
      if (res.ok) {
        const rawTracks = await res.json();
        // 플레이리스트 모음 및 비음악 엄격 배제 (순수 단일 음원만 선별)
        const chartTracks = Array.isArray(rawTracks) ? rawTracks.filter(t => 
          !isCompilationTrack(t) && !isNonMusicTrack(t)
        ) : [];

        if (chartTracks.length > 0) {
          chartTracks.forEach(ct => {
            if (!allTracks.find(t => t.id === ct.id || t.videoId === ct.videoId)) {
              allTracks.push(ct);
            }
          });
          ui.renderTopCharts(chartTracks);

          // 둘러보기 히어로 배너: 선택된 국가의 1위곡으로 동적 연동
          const top1 = chartTracks.find(t => !isCompilationTrack(t) && !isNonMusicTrack(t)) || authenticGlobalTop1Fallback;
          const heroBanner = document.getElementById('explore-hero-banner');
          const heroBadge = document.getElementById('explore-hero-badge');
          const heroTitle = document.getElementById('explore-hero-title');
          const heroDesc = document.getElementById('explore-hero-desc');
          const btnHeroPlay = document.getElementById('btn-hero-play');

          const countryBadgeLabels = {
            'KR': 'KOREA TOP 1',
            'GLOBAL': 'GLOBAL TOP 1',
            'US': 'USA TOP 1',
            'JP': 'JAPAN TOP 1',
            'GB': 'UK TOP 1'
          };
          if (heroBadge) {
            heroBadge.textContent = countryBadgeLabels[currentChartCountry] || `${currentChartCountry} TOP 1`;
          }

          if (top1) {
            if (heroBanner) {
              const bgImg = top1.cover || 'https://i.ytimg.com/vi/ekr2nIex040/maxresdefault.jpg';
              heroBanner.style.background = `linear-gradient(135deg, rgba(239, 68, 68, 0.75) 0%, rgba(20, 15, 25, 0.92) 100%), url('${bgImg}') center/cover`;
            }
            if (heroTitle) {
              const tTitle = (top1.title || '').trim();
              const tArtist = (top1.artist || '').trim();
              if (tArtist && !tTitle.toLowerCase().includes(tArtist.toLowerCase())) {
                heroTitle.textContent = `${tArtist} - ${tTitle}`;
              } else {
                heroTitle.textContent = tTitle;
              }
            }
            if (heroDesc) {
              const countryNames = {
                'KR': '대한민국',
                'GLOBAL': '글로벌',
                'US': '미국',
                'JP': '일본',
                'GB': '영국'
              };
              const cName = countryNames[currentChartCountry] || '실시간';
              heroDesc.textContent = `${cName} 실시간 인기 차트 1위를 질주 중인 '${top1.title}'을 고음질 스트리밍과 실시간 동기화 가사로 즐겨보세요.`;
            }
            if (btnHeroPlay) {
              btnHeroPlay.onclick = () => {
                player.setQueue([top1, ...chartTracks.filter(t => t.id !== top1.id)], 0, true);
                ui.showToast(`1위곡 '${top1.title}' 재생을 시작합니다.`);
              };
            }
          }

          if (window.lucide) window.lucide.createIcons();
          return;
        }
      }
    } catch (e) {
      console.warn("Live charts fetch failed, fallback to default:", e);
    }
    ui.renderTopCharts(allTracks.filter(t => !isCompilationTrack(t) && !isNonMusicTrack(t)));
  }

  // URL 파라미터(?v=... 또는 ?videoId=...)를 통한 공유 음악 즉시 로드 및 자동 재생
  function handleSharedTrackFromUrl() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const shareVideoId = (urlParams.get('v') || urlParams.get('videoId') || urlParams.get('play') || urlParams.get('id') || '').trim();
      if (!shareVideoId) return false;

      // 1. 이미 앱 내 트랙이나 보관함에 존재하는지 확인
      let targetTrack = allTracks.find(t => t.videoId === shareVideoId || t.id === shareVideoId || t.id === `yt_${shareVideoId}`) ||
                        ui.likedTracksMap.get(shareVideoId) ||
                        ui.playHistory.find(t => t.videoId === shareVideoId || t.id === shareVideoId);

      const urlTitle = (urlParams.get('title') || urlParams.get('t') || '').trim();
      const urlArtist = (urlParams.get('artist') || urlParams.get('a') || '').trim();

      if (!targetTrack) {
        targetTrack = {
          id: `yt_${shareVideoId}`,
          videoId: shareVideoId,
          title: urlTitle || '공유된 음악 로딩 중...',
          artist: urlArtist || 'Streamvance',
          cover: `https://i.ytimg.com/vi/${shareVideoId}/hqdefault.jpg`,
          duration: 0
        };
        allTracks.unshift(targetTrack);
      } else {
        if (urlTitle && (!targetTrack.title || targetTrack.title.includes('로딩 중'))) {
          targetTrack.title = urlTitle;
        }
        if (urlArtist && (!targetTrack.artist || targetTrack.artist === 'Streamvance')) {
          targetTrack.artist = urlArtist;
        }
      }

      // 2. 스마트 큐 구성 및 즉시 재생 시작
      playWithSmartQueue(targetTrack);
      ui.updateCurrentTrackUI(targetTrack);
      ui.showToast(`공유된 음악을 재생합니다: '${targetTrack.title}'`);

      // 3. 메타데이터(곡 제목, 아티스트명, 고화질 썸네일) 비동기 정밀 보정 (YouTube oEmbed)
      if (!urlTitle || targetTrack.title.includes('로딩 중')) {
        fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(shareVideoId)}&format=json`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data && data.title) {
              targetTrack.title = data.title;
              targetTrack.artist = data.author_name || targetTrack.artist || '아티스트';
              if (data.thumbnail_url) targetTrack.cover = data.thumbnail_url;

              const cur = player.getCurrentTrack();
              if (cur && (cur.videoId === shareVideoId || cur.id === targetTrack.id)) {
                cur.title = targetTrack.title;
                cur.artist = targetTrack.artist;
                cur.cover = targetTrack.cover;
                ui.updateCurrentTrackUI(cur);
                player.updateMediaSession(cur);
              }
              ui.renderQueue(player.queue, player.currentIndex);
            }
          })
          .catch(() => {});
      }
      return true;
    } catch (e) {
      console.warn("Shared track load failed:", e);
      return false;
    }
  }

  // 3. Initial Queue & Data Setup
  const hasSharedTrack = handleSharedTrackFromUrl();
  if (!hasSharedTrack) {
    // 사용자가 마지막으로 듣고 있었던 노래 복원 시도 (localStorage)
    let restoredTrack = null;
    try {
      const storedLast = localStorage.getItem('streamvance_last_track');
      if (storedLast) {
        restoredTrack = JSON.parse(storedLast);
      } else if (Array.isArray(ui.playHistory) && ui.playHistory.length > 0) {
        restoredTrack = ui.playHistory[0];
      }
    } catch (e) {}

    if (restoredTrack && (restoredTrack.videoId || restoredTrack.audioUrl)) {
      // 마지막 청취 기록이 있는 경우: 해당 곡을 대기열 선두에 배치하여 일시정지 상태로 대기
      const remainingTracks = allTracks.filter(t => t.id !== restoredTrack.id && t.videoId !== restoredTrack.videoId);
      player.setQueue([restoredTrack, ...remainingTracks], 0, false);
    } else {
      // 첫 접속이거나 이전 청취 기록이 없는 경우: 어떤 곡도 강제로 선택하지 않음 (대기열만 구성, currentIndex는 -1)
      player.queue = [...allTracks];
      player.originalQueue = [...allTracks];
      player.currentIndex = -1;
      // UI 플레이어 바 초기 상태 유지 (선택된 곡 없음)
      const playerTitle = document.getElementById('player-title');
      const playerArtist = document.getElementById('player-artist');
      const playerCover = document.getElementById('player-cover-img');
      if (playerTitle) playerTitle.textContent = '곡을 선택해주세요';
      if (playerArtist) playerArtist.textContent = 'YouTube Music';
      if (playerCover) playerCover.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="%23222222"><rect width="24" height="24" rx="4"/></svg>';
    }
  }
  ui.updateLikesCount();

  // 4. Initial Views Render
  updatePersonalizedQuickPicks();
  ui.renderRecommendedAlbums(sampleAlbums, allTracks);
  switchSpotlightArtist(0);
  loadLiveTopCharts();
  ui.renderGenres(genresData);
  ui.renderQueue(player.queue, player.currentIndex);

  // 5. Navigation Tab Switching (Top Header Tabs & Mobile - 스크린샷 기능 일치)
  document.querySelectorAll('[data-nav], .ytm-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const navTarget = btn.getAttribute('data-nav');
      if (navTarget) {
        closeModal();
        syncVideoPosition();
        ui.switchView(navTarget);
        if (navTarget === 'library') {
          const activeTab = document.querySelector('.lib-tab.active');
          const type = activeTab ? activeTab.getAttribute('data-lib') : 'likes';
          ui.renderLibrary(type);
        }
      }
    });
  });

  // 이전/다음 브라우징 화살표 버튼 (플레이어 화면 열려있으면 접고 복귀)
  const btnHistBack = document.getElementById('btn-hist-back');
  if (btnHistBack) {
    btnHistBack.addEventListener('click', () => {
      if (ui.dom.fullModal && ui.dom.fullModal.classList.contains('open')) {
        closeModal();
      } else {
        window.history.back();
      }
    });
  }
  const btnHistForward = document.getElementById('btn-hist-forward');
  if (btnHistForward) {
    btnHistForward.addEventListener('click', () => window.history.forward());
  }

  // 빠른 선곡 좌우 스크롤 화살표 (< >)
  const quickGrid = document.getElementById('quick-picks-list');
  const btnQuickPrev = document.getElementById('btn-quick-prev');
  const btnQuickNext = document.getElementById('btn-quick-next');
  if (btnQuickPrev && quickGrid) {
    btnQuickPrev.addEventListener('click', () => quickGrid.scrollBy({ left: -380, behavior: 'smooth' }));
  }
  if (btnQuickNext && quickGrid) {
    btnQuickNext.addEventListener('click', () => quickGrid.scrollBy({ left: 380, behavior: 'smooth' }));
  }

  // 다시 듣기 앨범 좌우 스크롤 화살표 (< >)
  const albumsList = document.getElementById('recommended-albums-list');
  const btnAlbumsPrev = document.getElementById('btn-albums-prev');
  const btnAlbumsNext = document.getElementById('btn-albums-next');
  if (btnAlbumsPrev && albumsList) {
    btnAlbumsPrev.addEventListener('click', () => albumsList.scrollBy({ left: -320, behavior: 'smooth' }));
  }
  if (btnAlbumsNext && albumsList) {
    btnAlbumsNext.addEventListener('click', () => albumsList.scrollBy({ left: 320, behavior: 'smooth' }));
  }

  // 다시 듣기 더보기 버튼 (보관함 시청 기록으로 이동)
  const btnMoreReplay = document.getElementById('btn-more-replay');
  if (btnMoreReplay) {
    btnMoreReplay.addEventListener('click', () => {
      closeModal();
      ui.switchView('library');
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      const histTab = document.querySelector('.lib-tab[data-lib="history"]');
      if (histTab) histTab.classList.add('active');
      ui.renderLibrary('history', allTracks);
    });
  }

  // 아티스트 스포트라이트 (< > 아티스트 전환 - 사용자 요청)
  const spotlightList = document.getElementById('spotlight-tracks-list');
  const btnSpotlightPrev = document.getElementById('btn-spotlight-prev');
  const btnSpotlightNext = document.getElementById('btn-spotlight-next');
  if (btnSpotlightPrev) {
    btnSpotlightPrev.addEventListener('click', () => {
      currentSpotlightIndex = (currentSpotlightIndex - 1 + SPOTLIGHT_ARTISTS.length) % SPOTLIGHT_ARTISTS.length;
      switchSpotlightArtist(currentSpotlightIndex);
    });
  }
  if (btnSpotlightNext) {
    btnSpotlightNext.addEventListener('click', () => {
      currentSpotlightIndex = (currentSpotlightIndex + 1) % SPOTLIGHT_ARTISTS.length;
      switchSpotlightArtist(currentSpotlightIndex);
    });
  }

  // ==========================================================================
  // 기기 연결 및 블루투스 공유 모달 제어
  // ==========================================================================
  const deviceModal = document.getElementById('device-connect-modal');
  const openDeviceModal = () => {
    const cur = player.getCurrentTrack();
    const coverEl = document.getElementById('device-modal-cover');
    const titleEl = document.getElementById('device-modal-title');
    const artistEl = document.getElementById('device-modal-artist');
    if (cur) {
      if (coverEl) coverEl.src = cur.cover;
      if (titleEl) titleEl.textContent = cur.title;
      if (artistEl) artistEl.textContent = `${cur.artist} • ${ui.formatTime(cur.duration)}`;
    }
    deviceModal?.classList.add('open');
    if (window.lucide) window.lucide.createIcons();
  };

  const closeDeviceModal = () => {
    deviceModal?.classList.remove('open');
  };

  document.getElementById('btn-close-device-modal')?.addEventListener('click', closeDeviceModal);
  document.getElementById('device-modal-backdrop')?.addEventListener('click', closeDeviceModal);

  // 1) 블루투스 오디오 기기 연결 (헤드폰/스피커)
  async function connectBluetoothAudio() {
    // 1-1. 브라우저 오디오 출력 장치 선택 (Chrome/Edge/Android Bluetooth Sink)
    if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
      try {
        ui.showToast('오디오 출력 / 블루투스 기기 선택 창을 엽니다...');
        const device = await navigator.mediaDevices.selectAudioOutput();
        if (player.audio && typeof player.audio.setSinkId === 'function') {
          await player.audio.setSinkId(device.deviceId);
          ui.showToast(`'${device.label || '선택한 오디오 기기'}'(으)로 출력이 전환되었습니다.`);
          closeDeviceModal();
          return;
        }
      } catch (err) {
        if (err.name !== 'NotFoundError' && err.name !== 'AbortError') {
          console.warn('selectAudioOutput error, fallback to Bluetooth:', err);
        } else {
          return;
        }
      }
    }

    // 1-2. Web Bluetooth API 페어링 스캔 (실제 브라우저 Bluetooth 페어링 대화상자)
    if (navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function') {
      try {
        ui.showToast('주변 블루투스 기기를 검색하고 있습니다...');
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['generic_access', 'battery_service']
        });
        if (device) {
          ui.showToast(`블루투스 기기 '${device.name || '알려지지 않은 기기'}'에 성공적으로 연결되었습니다.`);
          closeDeviceModal();
          return;
        }
      } catch (err) {
        if (err.name !== 'NotFoundError') {
          ui.showToast('블루투스 안내: ' + (err.message || '기기 연결이 취소되었습니다.'));
        }
        return;
      }
    }

    ui.showToast('기기 설정의 Bluetooth 메뉴에서 스피커나 이어폰을 연결하면 사운드가 바로 출력됩니다.');
  }

  // Streamvance 전용 음악 공유 URL 생성 함수 (유튜브 외부 링크 대신 우리 사이트 링크로 공유)
  function getTrackShareUrl(track) {
    if (!track) return window.location.href;
    const vid = track.videoId || (typeof track.id === 'string' && track.id.startsWith('yt_') ? track.id.replace('yt_', '') : '');
    if (!vid) return window.location.href;

    try {
      const origin = window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')
        ? window.location.origin
        : 'https://streamvance.pages.dev';
      const pathname = window.location.pathname || '/';
      const url = new URL(pathname, origin);
      url.searchParams.set('v', vid);
      return url.toString();
    } catch (e) {
      return `${window.location.origin || ''}/?v=${encodeURIComponent(vid)}`;
    }
  }

  // 2) 근처 기기로 공유 (Quick Share / 블루투스 공유 / 모바일 시스템 공유)
  async function shareNearbyDevice(trackToShare = null) {
    const cur = trackToShare || currentSheetTrack || player.getCurrentTrack();
    if (!cur) return;
    const shareUrl = getTrackShareUrl(cur);

    // 제목이랑 아티스트 - Streamvance 깔끔한 단일 포맷 (두 번 중복 출력 방지)
    let shareLabel = (cur.title || '음악').trim();
    const artist = (cur.artist || '').trim();
    if (artist && artist !== 'Streamvance' && !shareLabel.toLowerCase().includes(artist.toLowerCase())) {
      shareLabel = `${shareLabel} - ${artist}`;
    }
    const shareText = `${shareLabel} - Streamvance`;

    // Chromium/안드로이드에서 title과 text를 모두 주면 'title - text'로 합쳐져 제목이 2번 반복되므로,
    // text에만 정제된 단일 문구를 전달하여 '제목 - 아티스트 - Streamvance URL' 형태로 깔끔하게 1회만 노출
    const shareData = {
      text: shareText,
      url: shareUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        ui.showToast('공유가 완료되었습니다.');
        closeDeviceModal();
      } catch (err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard?.writeText(`${shareText}\n${shareUrl}`);
          ui.showToast('Streamvance 음악 링크가 클립보드에 복사되었습니다.');
        }
      }
    } else {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).then(() => {
          ui.showToast('Streamvance 음악 링크가 클립보드에 복사되었습니다. (블루투스/Quick Share로 전송 가능)');
        });
      } else {
        ui.showToast(`링크: ${shareUrl}`);
      }
    }
  }

  // 3) 스마트 TV / Cast 전송
  async function connectCastDevice() {
    if (player.audio && player.audio.remote && typeof player.audio.remote.prompt === 'function') {
      try {
        await player.audio.remote.prompt();
        ui.showToast('원격 기기(Cast) 연결 시도 중...');
        closeDeviceModal();
      } catch (e) {
        ui.showToast('Cast 연결 취소 또는 사용 가능한 기기가 없습니다.');
      }
    } else {
      ui.showToast('브라우저 우측 상단 메뉴(⋮) > [전송...]을 통해 스마트 TV 및 Chromecast로 전송할 수 있습니다.');
    }
  }

  // 4) 링크 복사
  function copyMusicLink(trackToCopy = null) {
    const cur = trackToCopy || currentSheetTrack || player.getCurrentTrack();
    if (!cur) return;
    const shareUrl = getTrackShareUrl(cur);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        ui.showToast('Streamvance 재생 링크가 클립보드에 복사되었습니다.');
        closeDeviceModal();
      }).catch(() => {
        ui.showToast(`링크: ${shareUrl}`);
      });
    } else {
      ui.showToast(`링크: ${shareUrl}`);
    }
  }

  document.getElementById('btn-connect-bluetooth')?.addEventListener('click', connectBluetoothAudio);
  document.getElementById('btn-share-nearby')?.addEventListener('click', () => shareNearbyDevice());
  document.getElementById('btn-connect-cast')?.addEventListener('click', connectCastDevice);
  document.getElementById('btn-copy-music-link')?.addEventListener('click', () => copyMusicLink());

  // 캐스트 / 기기 연결 버튼
  const btnCastDevice = document.getElementById('btn-cast-device');
  if (btnCastDevice) {
    btnCastDevice.addEventListener('click', openDeviceModal);
  }

  // 브라우저 뒤로/앞으로가기 히스토리 이벤트 연동
  window.addEventListener('popstate', (e) => {
    const view = e.state?.view || 'home';
    ui.switchView(view, false);
    if (view === 'library') {
      const activeTab = document.querySelector('.lib-tab.active');
      const type = activeTab ? activeTab.getAttribute('data-lib') : 'likes';
      ui.renderLibrary(type, allTracks);
    }
  });

  // 브랜드 로고 클릭 시 홈으로
  const brandHomeLink = document.getElementById('brand-home-link');
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
      ui.switchView('home');
    });
  }

  // 6. Mood Filter Chips (스크린샷 3 100% 매칭: 잠잘 때, 휴식, 에너지 충전, 행복한 기분, 운동, 집중)
  document.querySelectorAll('.mood-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentMood = chip.getAttribute('data-mood');

      // 무드별 온라인 정품 추천곡 확보 (컴필레이션 및 10분 초과 믹스 영상 엄격 제외)
      const moodKeywords = {
        sleep: '잔잔한 피아노 수면 음악 MV',
        chill: '카페 어쿠스틱 감성 인디 노래 MV',
        energy: '신나는 K-POP 댄스곡 MV',
        happy: '기분 좋은 청량 드라이브 팝송 MV',
        workout: '신나는 EDM 헬스 워크아웃 MV',
        focus: 'Lofi chill beats study',
        commute: '출퇴근길 신나는 노래 M/V',
        ballad: '감성 발라드 명곡 M/V'
      };

      if (currentMood !== 'all' && moodKeywords[currentMood]) {
        try {
          const res = await searchService.searchOnline(moodKeywords[currentMood]);
          const rawTracks = Array.isArray(res) ? res : (res.tracks || res.songs || []);
          const moodTracks = rawTracks.filter(t => 
            (!t.duration || t.duration <= 600) &&
            !t.isCompilation &&
            !((t.title || '').includes('플레이리스트') || (t.title || '').includes('노래모음') || (t.title || '').includes('1시간') || (t.title || '').includes('종합차트'))
          );
          moodTracks.forEach(t => {
            t.mood = currentMood;
            if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
              allTracks.push(t);
            }
          });
        } catch (e) {}
      }

      updatePersonalizedQuickPicks();
      ui.showToast(`'${chip.textContent}' 맞춤 음악으로 전환되었습니다.`);
    });
  });

  // 7. Track Interactions (Quick Picks, Top Charts, Albums)
  document.addEventListener('click', (e) => {
    // 트랙 카드 클릭
    const trackCard = e.target.closest('.track-row-card');
    if (trackCard) {
      // 대기열 순서 이동 드래그 핸들 클릭 시 곡 재생 방지
      if (e.target.closest('.queue-drag-handle')) {
        e.stopPropagation();
        return;
      }

      // 액션 버튼(좋아요, 큐 추가, 삭제) 클릭인 경우
      const actionBtn = e.target.closest('button');
      const trackId = trackCard.getAttribute('data-track-id');
      const queueIndex = trackCard.getAttribute('data-queue-index');

      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        if (action === 'like') {
          e.stopPropagation();
          const target = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId) || ui.localFiles?.find(t => t.id === trackId);
          if (target) {
            ui.toggleLike(target);
            updatePersonalizedQuickPicks();
          }
          return;
        } else if (action === 'queue') {
          e.stopPropagation();
          const target = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId) || ui.localFiles?.find(t => t.id === trackId);
          if (target) {
            player.addTrackToQueue(target);
            ui.showToast(`'${target.title}' 대기열에 추가되었습니다.`);
          }
          return;
        } else if (action === 'delete-history') {
          e.stopPropagation();
          const targetId = actionBtn.getAttribute('data-track-id') || trackId;
          ui.deletePlayHistoryItem(targetId);
          updatePersonalizedQuickPicks();
          return;
        } else if (action === 'delete-offline') {
          e.stopPropagation();
          const targetId = actionBtn.getAttribute('data-track-id') || trackId;
          ui.deleteOfflineItem(targetId);
          return;
        } else if (action === 'remove-queue') {
          e.stopPropagation();
          player.removeTrackFromQueue(parseInt(actionBtn.getAttribute('data-index'), 10));
          return;
        }
      }

      // 대기열 목록에서의 클릭
      if (queueIndex !== null && queueIndex !== undefined) {
        player.playTrackAtIndex(parseInt(queueIndex, 10));
        return;
      }

      // 일반 트랙 클릭 시 (스마트 연관 큐 자동 생성 & 재생)
      if (trackId) {
        let targetTrack = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId) || ui.localFiles?.find(t => t.id === trackId);
        if (targetTrack) {
          playWithSmartQueue(targetTrack);
        } else {
          offlineStorage.getTracks().then(offTracks => {
            const offT = offTracks.find(t => t.id === trackId);
            if (offT) playWithSmartQueue(offT);
          }).catch(() => {});
        }
      }
    }

    // 실시간 TOP 차트 아이템 클릭 처리
    const chartItem = e.target.closest('.chart-item');
    if (chartItem) {
      const trackId = chartItem.getAttribute('data-track-id');
      if (trackId) {
        const targetTrack = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
        if (targetTrack) {
          playWithSmartQueue(targetTrack);
        }
      }
      return;
    }

    // 앨범 카드 / 스포트라이트 카드 클릭
    const albumCard = e.target.closest('.music-card');
    if (albumCard) {
      const trackId = albumCard.getAttribute('data-track-id');
      if (trackId) {
        const targetTrack = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
        if (targetTrack) {
          playWithSmartQueue(targetTrack);
        }
        return;
      }

      const albumId = albumCard.getAttribute('data-album-id');
      const album = sampleAlbums.find(a => a.id === albumId);
      if (album) {
        const albumTracks = allTracks.filter(t => album.trackIds.includes(t.id));
        if (albumTracks.length > 0) {
          player.setQueue(albumTracks, 0, true);
        }
      }
      return;
    }

    // 둘러보기 히어로 배너 재생 버튼
    if (e.target.closest('#btn-hero-play')) {
      const track = allTracks[0];
      if (track) {
        player.setQueue([track, ...allTracks.slice(1)], 0, true);
      }
    }

    // 둘러보기 장르 카드 클릭 시 홈으로 튕기지 않고 전용 추천 패널 열기
    const genreCard = e.target.closest('.genre-card');
    if (genreCard) {
      const genreId = genreCard.getAttribute('data-genre-id') || genreCard.getAttribute('data-genre-mood');
      const genreName = genreCard.getAttribute('data-genre-name');
      openGenreDetail(genreId, genreName);
      return;
    }

    // 둘러보기 장르 상세 닫기
    if (e.target.closest('#btn-explore-genre-back')) {
      ui.closeGenreDetail();
      return;
    }

    // 둘러보기 장르 전체 재생 & 셔플
    if (e.target.closest('#btn-genre-play-all')) {
      if (currentGenreTracks.length > 0) {
        player.setQueue(currentGenreTracks, 0, true);
        ui.showToast('장르 맞춤 음악 재생을 시작합니다.');
      }
      return;
    }

    if (e.target.closest('#btn-genre-shuffle')) {
      if (currentGenreTracks.length > 0) {
        const shuffled = [...currentGenreTracks].sort(() => Math.random() - 0.5);
        player.setQueue(shuffled, 0, true);
        ui.showToast('장르 맞춤 음악을 셔플 재생합니다.');
      }
      return;
    }

    // 아티스트 상위 검색결과 셔플 & 뮤직 스테이션
    if (e.target.closest('#btn-search-artist-shuffle')) {
      const card = document.getElementById('artist-top-card');
      const artistName = card?.getAttribute('data-artist') || '';
      const artistTracks = allTracks.filter(t => (t.artist || '').toLowerCase().includes(artistName.toLowerCase()));
      if (artistTracks.length > 0) {
        const shuffled = [...artistTracks].sort(() => Math.random() - 0.5);
        player.setQueue(shuffled, 0, true);
        ui.showToast(`${artistName}의 인기곡을 셔플 재생합니다.`);
      }
      return;
    }

    if (e.target.closest('#btn-search-artist-station')) {
      const card = document.getElementById('artist-top-card');
      const artistName = card?.getAttribute('data-artist') || '';
      const artistTracks = allTracks.filter(t => (t.artist || '').toLowerCase().includes(artistName.toLowerCase()));
      if (artistTracks.length > 0) {
        player.setQueue(artistTracks, 0, true);
        autoQueueSimilarTracks(artistTracks[0]);
        ui.showToast(`${artistName} 뮤직 스테이션을 시작합니다.`);
      }
      return;
    }

    // 최근 검색어 클릭
    const recentItem = e.target.closest('.recent-search-item');
    if (recentItem) {
      const q = recentItem.getAttribute('data-query');
      if (q) {
        if (ui.dom.searchInput) ui.dom.searchInput.value = q;
        if (ui.dom.mobileSearchInput) ui.dom.mobileSearchInput.value = q;
        if (ui.dom.mobileSearchOverlay) ui.dom.mobileSearchOverlay.style.display = 'none';
        executeSearch(q);
      }
      return;
    }
  });

  // 둘러보기 전용 장르 상세 열기 함수 (장르 및 분위기별 맞춤 아티스트 및 실시간 추천 곡 로드)
  let currentGenreTracks = [];
  async function openGenreDetail(genreId, genreNameOverride) {
    const genre = genresData.find(g => g.id === genreId || g.mood === genreId || g.name === genreNameOverride) || 
                  { id: genreId, name: genreNameOverride || genreId, color: '#ef4444', mood: genreId };

    const genreTitle = genre.name || genreNameOverride || '추천 장르';

    // 1) 0ms 즉각 로컬 allTracks 매칭 곡 먼저 렌더링
    let localTracks = allTracks.filter(t => {
      const gm = ((t.genre || '') + ' ' + (t.mood || '')).toLowerCase();
      if (genre.id === 'kpop' || genre.mood === 'kpop') return gm.includes('k-pop') || gm.includes('kpop') || gm.includes('pop');
      if (genre.id === 'billboard' || genre.mood === 'billboard') return gm.includes('pop') || gm.includes('all');
      if (genre.id === 'chill' || genre.mood === 'chill') return gm.includes('chill') || gm.includes('acoustic') || gm.includes('calm');
      if (genre.id === 'hiphop' || genre.mood === 'hiphop') return gm.includes('hiphop') || gm.includes('hip-hop') || gm.includes('r&b') || gm.includes('r-b');
      if (genre.id === 'workout' || genre.mood === 'workout') return gm.includes('workout') || gm.includes('energy') || gm.includes('upbeat');
      if (genre.id === 'focus' || genre.mood === 'focus') return gm.includes('focus') || gm.includes('ballad') || gm.includes('calm');
      return gm.includes((genre.mood || '').toLowerCase()) || gm.includes((genre.id || '').toLowerCase());
    });

    currentGenreTracks = localTracks;
    ui.renderGenreDetail(genreTitle, genre.color, localTracks);

    // 2) K-POP 및 빌보드는 공식 차트 API (/api/charts) 연동
    if (genre.id === 'kpop' || genre.id === 'billboard') {
      try {
        const chartUrl = genre.id === 'kpop' ? '/api/charts?type=korea' : '/api/charts?type=global';
        const res = await fetch(chartUrl);
        if (res.ok) {
          const chartTracks = await res.json();
          if (Array.isArray(chartTracks) && chartTracks.length > 0) {
            const cleanChartTracks = chartTracks.filter(t => 
              (!t.duration || t.duration <= 600) && 
              !t.isCompilation && 
              !((t.title || '').includes('플레이리스트') || (t.title || '').includes('노래모음') || (t.title || '').includes('종합차트'))
            );
            cleanChartTracks.forEach(t => {
              t.genre = genre.id;
              t.mood = genre.mood;
              if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
                allTracks.push(t);
              }
            });
            currentGenreTracks = cleanChartTracks;
            ui.renderGenreDetail(genreTitle, genre.color, cleanChartTracks);
            return;
          }
        }
      } catch (e) {
        console.warn("Genre chart fetch error:", e);
      }
    }

    // 3) 그 외 무드/장르는 검증된 정품 노래 전용 쿼리로 온라인 검색
    const genreKeywords = {
      "chill": "카페 어쿠스틱 노래 MV",
      "hiphop": "지코 창모 비오 박재범 랩 MV",
      "workout": "신나는 EDM 댄스 인기곡 MV",
      "focus": "Lofi chill beats study"
    };

    const targetQuery = genreKeywords[genre.id] || genreKeywords[genre.mood] || `${genreTitle} 인기곡 노래 MV`;

    try {
      const searchRes = await searchService.searchOnline(targetQuery);
      const newTracks = Array.isArray(searchRes) ? searchRes : (searchRes.tracks || searchRes.songs || []);
      const cleanTracks = newTracks.filter(t => 
        (!t.duration || t.duration <= 600) && 
        !t.isCompilation && 
        !((t.title || '').includes('플레이리스트') || (t.title || '').includes('노래모음') || (t.title || '').includes('모음집') || (t.title || '').includes('1시간'))
      );

      if (cleanTracks.length > 0) {
        cleanTracks.forEach(t => {
          t.genre = genre.id;
          t.mood = genre.mood;
          if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
            allTracks.push(t);
          }
        });
        currentGenreTracks = cleanTracks;
        ui.renderGenreDetail(genreTitle, genre.color, cleanTracks);
      }
    } catch (e) {
      console.warn("Genre search online error:", e);
    }
  }

  // 8. Player Controls
  const btnPlayPause = document.getElementById('btn-play-pause');
  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => player.togglePlayPause());
  }

  const btnNext = document.getElementById('btn-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => player.nextTrack());
  }

  const btnPrev = document.getElementById('btn-prev');
  if (btnPrev) {
    btnPrev.addEventListener('click', () => player.prevTrack());
  }

  // 셔플 및 반복 UI 동기화 함수
  const syncShuffleUI = (active) => {
    const btnShuffle = document.getElementById('btn-shuffle');
    const btnMobileShuffle = document.getElementById('btn-mobile-shuffle');
    [btnShuffle, btnMobileShuffle].forEach(btn => {
      if (btn) btn.classList.toggle('active', active);
    });
    ui.showToast(active ? '셔플 모드 켜짐' : '셔플 모드 꺼짐');
  };

  const syncRepeatUI = (mode) => {
    const btnRepeat = document.getElementById('btn-repeat');
    const btnMobileRepeat = document.getElementById('btn-mobile-repeat');
    const labels = { off: '반복 꺼짐', all: '전체 반복', one: '한 곡 반복' };

    [btnRepeat, btnMobileRepeat].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle('active', mode !== 'off');
      btn.classList.toggle('repeat-one', mode === 'one');
      if (mode === 'one') {
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m17 2 4 4-4 4"/>
            <path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
            <path d="m7 22-4-4 4-4"/>
            <path d="M21 13v1a4 4 0 0 1-4 4H3"/>
            <text x="12" y="14" font-size="9" font-weight="900" text-anchor="middle" fill="currentColor" stroke="none">1</text>
          </svg>
        `;
      } else {
        btn.innerHTML = `<i data-lucide="repeat"></i>`;
      }
    });
    if (window.lucide) window.lucide.createIcons();
    ui.showToast(labels[mode] || '반복 설정');
  };

  const btnShuffle = document.getElementById('btn-shuffle');
  if (btnShuffle) {
    btnShuffle.addEventListener('click', () => {
      syncShuffleUI(player.toggleShuffle());
    });
  }

  const btnRepeat = document.getElementById('btn-repeat');
  if (btnRepeat) {
    btnRepeat.addEventListener('click', () => {
      syncRepeatUI(player.cycleRepeat());
    });
  }

  // Seek Slider
  if (ui.dom.seekSlider) {
    ui.dom.seekSlider.addEventListener('input', (e) => {
      ui.isSeeking = true;
      const percent = parseFloat(e.target.value);
      if (ui.dom.progressBar) ui.dom.progressBar.style.width = `${percent}%`;
    });

    ui.dom.seekSlider.addEventListener('change', (e) => {
      ui.isSeeking = false;
      const percent = parseFloat(e.target.value);
      player.seekToPercent(percent);
    });
  }

  // Volume
  if (ui.dom.volumeSlider) {
    ui.dom.volumeSlider.addEventListener('input', (e) => {
      player.setVolume(parseFloat(e.target.value));
    });
  }

  const btnVolumeToggle = document.getElementById('btn-volume-toggle');
  if (btnVolumeToggle) {
    btnVolumeToggle.addEventListener('click', () => player.toggleMute());
  }

  // Likes (하단 바 및 전체 모달)
  if (ui.dom.likeBtn) {
    ui.dom.likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.toggleLike(player.getCurrentTrack());
      updatePersonalizedQuickPicks();
    });
  }
  if (ui.dom.modalLikeBtn) {
    ui.dom.modalLikeBtn.addEventListener('click', () => {
      ui.toggleLike(player.getCurrentTrack());
      updatePersonalizedQuickPicks();
    });
  }

  // 9. Full Modal Player Expand / Collapse & Song/Video Mode
  let currentMediaMode = 'song'; // 'song' | 'video'

  const syncVideoPosition = () => {
    const persistent = document.getElementById('yt-player-persistent-wrap');
    if (!persistent) return;

    const isVideoMode = document.body.classList.contains('video-mode-active') && 
                        document.body.classList.contains('player-modal-open');

    if (!isVideoMode) {
      persistent.style.setProperty('position', 'fixed', 'important');
      persistent.style.setProperty('top', '0px', 'important');
      persistent.style.setProperty('left', '0px', 'important');
      persistent.style.setProperty('width', '320px', 'important');
      persistent.style.setProperty('height', '240px', 'important');
      persistent.style.setProperty('transform', 'none', 'important');
      persistent.style.setProperty('opacity', '1', 'important');
      persistent.style.setProperty('pointer-events', 'none', 'important');
      persistent.style.setProperty('z-index', '-999', 'important');
      persistent.style.setProperty('border-radius', '0px', 'important');
      return;
    }

    const videoWrap = document.getElementById('modal-video-wrap');
    const stageMedia = document.getElementById('stage-media-wrap');
    const visualPanel = document.querySelector('.modal-visual-panel');

    let rect = null;
    if (videoWrap && videoWrap.offsetHeight > 30 && videoWrap.offsetWidth > 30) {
      rect = videoWrap.getBoundingClientRect();
    } else if (stageMedia && stageMedia.offsetHeight > 30 && stageMedia.offsetWidth > 30) {
      rect = stageMedia.getBoundingClientRect();
    }

    let top = 0, left = 0, width = 560, height = 315;

    if (rect && rect.width > 50 && rect.height > 50) {
      top = Math.round(rect.top);
      left = Math.round(rect.left);
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    } else if (visualPanel) {
      const vpRect = visualPanel.getBoundingClientRect();
      const calcW = Math.max(280, Math.min(vpRect.width - 32, 560));
      const calcH = Math.round(calcW * 9 / 16);
      width = calcW;
      height = calcH;
      left = Math.round(vpRect.left + (vpRect.width - calcW) / 2);
      top = Math.round(vpRect.top + 20);
    } else {
      width = Math.min(window.innerWidth * 0.9, 560);
      height = Math.round(width * 9 / 16);
      left = Math.round((window.innerWidth - width) / 2);
      top = Math.round(window.innerHeight * 0.2);
    }

    persistent.style.setProperty('position', 'fixed', 'important');
    persistent.style.setProperty('top', `${top}px`, 'important');
    persistent.style.setProperty('left', `${left}px`, 'important');
    persistent.style.setProperty('width', `${width}px`, 'important');
    persistent.style.setProperty('height', `${height}px`, 'important');
    persistent.style.setProperty('transform', 'none', 'important');
    persistent.style.setProperty('opacity', '1', 'important');
    persistent.style.setProperty('pointer-events', 'auto', 'important');
    persistent.style.setProperty('z-index', '999', 'important');
    persistent.style.setProperty('border-radius', '12px', 'important');
  };

  // 비디오 무대 위치 자동 추적용 ResizeObserver 바인딩 (PC & 모바일 공통)
  if (typeof ResizeObserver !== 'undefined') {
    const targetVideoWrap = document.getElementById('modal-video-wrap');
    const targetStageWrap = document.getElementById('stage-media-wrap');
    const vRo = new ResizeObserver(() => {
      if (document.body.classList.contains('video-mode-active')) {
        syncVideoPosition();
      }
    });
    if (targetVideoWrap) vRo.observe(targetVideoWrap);
    if (targetStageWrap) vRo.observe(targetStageWrap);
  }

  const syncTheaterUI = (isTheater) => {
    const modalEl = ui.dom.fullModal || document.getElementById('full-player-modal');
    if (modalEl) modalEl.classList.toggle('modal-theater-mode', isTheater);

    const btnModalTheater = document.getElementById('btn-modal-theater-toggle');
    if (btnModalTheater) {
      btnModalTheater.classList.toggle('active', isTheater);
      btnModalTheater.innerHTML = isTheater 
        ? '<i data-lucide="minimize-2"></i>' 
        : '<i data-lucide="expand"></i>';
      btnModalTheater.setAttribute('title', isTheater ? '기본 모드로 축소' : '대형 영상 모드 (화면 확대 / 시어터 뷰)');
    }

    if (ui.dom.btnVideoTheater) {
      ui.dom.btnVideoTheater.classList.toggle('active', isTheater);
      const expandIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-expand');
      const shrinkIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-shrink');
      if (expandIcon) expandIcon.style.display = isTheater ? 'none' : 'block';
      if (shrinkIcon) shrinkIcon.style.display = isTheater ? 'block' : 'none';
      ui.dom.btnVideoTheater.title = isTheater ? '기본 모드로 축소' : '대형 영상 모드 (화면 확대 / 시어터 뷰)';
    }
    if (window.lucide) window.lucide.createIcons();
    syncVideoPosition();
    setTimeout(syncVideoPosition, 100);
  };

  const toggleTheaterMode = (e) => {
    if (e) e.stopPropagation();
    const modalEl = ui.dom.fullModal || document.getElementById('full-player-modal');
    if (!modalEl) return;
    const isNowTheater = !modalEl.classList.contains('modal-theater-mode');
    syncTheaterUI(isNowTheater);
    ui.showToast(isNowTheater ? '대형 영상 모드 (화면 확대)' : '기본 영상 모드로 복귀');
  };

  const btnModalTheaterToggle = document.getElementById('btn-modal-theater-toggle');
  if (btnModalTheaterToggle) btnModalTheaterToggle.addEventListener('click', toggleTheaterMode);

  const handleTogglePiP = (e) => {
    if (e) e.stopPropagation();
    if (window.pipManager && typeof window.pipManager.togglePiP === 'function') {
      window.pipManager.togglePiP();
    } else if (typeof pipManager !== 'undefined' && pipManager.togglePiP) {
      pipManager.togglePiP();
    }
  };

  const toggleFullscreen = (e) => {
    if (e) e.stopPropagation();
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
      const target = document.documentElement;
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => {});
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
      }
      ui.showToast('전체화면 모드 (F)');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      ui.showToast('전체화면 종료');
    }
  };

  const handleFullscreenChange = () => {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    document.body.classList.toggle('is-fullscreen', isFs);
    const modalEl = ui.dom.fullModal || document.getElementById('full-player-modal');
    if (modalEl) modalEl.classList.toggle('is-fullscreen', isFs);

    // 전체화면 아이콘 상태 갱신
    document.querySelectorAll('.icon-fs-max').forEach(el => {
      el.style.display = isFs ? 'none' : 'block';
    });
    document.querySelectorAll('.icon-fs-min').forEach(el => {
      el.style.display = isFs ? 'block' : 'none';
    });

    const iconModalFs = document.getElementById('icon-modal-fs');
    if (iconModalFs) {
      iconModalFs.setAttribute('data-lucide', isFs ? 'minimize' : 'maximize');
    }
    if (window.lucide) window.lucide.createIcons();

    // ESC로 풀든 버튼으로 풀든 동영상/앨범아트 위치 완벽 동기화 (레이아웃 리플로우 다단계 대응)
    syncVideoPosition();
    requestAnimationFrame(syncVideoPosition);
    setTimeout(syncVideoPosition, 40);
    setTimeout(syncVideoPosition, 100);
    setTimeout(syncVideoPosition, 250);
    setTimeout(syncVideoPosition, 450);
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('video-mode-active')) {
      syncVideoPosition();
    }
  });
  window.addEventListener('scroll', () => {
    if (document.body.classList.contains('video-mode-active')) {
      syncVideoPosition();
    }
  }, { passive: true });

  const btnModalFullscreen = document.getElementById('btn-modal-fullscreen');
  if (btnModalFullscreen) btnModalFullscreen.addEventListener('click', toggleFullscreen);

  const btnToggleStageFs = document.getElementById('btn-toggle-stage-fs');
  if (btnToggleStageFs) btnToggleStageFs.addEventListener('click', toggleFullscreen);

  const btnVideoFsCorner = document.getElementById('btn-video-fullscreen-toggle');
  if (btnVideoFsCorner) btnVideoFsCorner.addEventListener('click', toggleFullscreen);

  // PIP (화면 속 화면 미니 플레이어) 토글 버튼 일괄 연동
  const pipButtons = [
    document.getElementById('btn-toggle-pip'),          // 하단 플레이어 바
    document.getElementById('btn-modal-pip'),           // 풀 플레이어 모달 헤더
    document.getElementById('btn-toggle-pip-art'),       // 모달 앨범아트 코너
    document.getElementById('btn-video-pip-toggle')      // 영상 화면 코너
  ];
  pipButtons.forEach(btn => {
    if (btn) btn.addEventListener('click', handleTogglePiP);
  });

  // 국가 선택 셀렉터 이벤트 리스너 바인딩 (차트 헤더 & 계정 서랍)
  const onCountryChange = (e) => {
    const selected = (e.target.value || '').toUpperCase();
    const countryNames = {
      'KR': '대한민국',
      'GLOBAL': '글로벌',
      'US': '미국',
      'JP': '일본',
      'GB': '영국'
    };
    ui.showToast(`${countryNames[selected] || selected} 트렌드 차트를 불러오는 중...`);
    loadLiveTopCharts(selected);
  };

  const chartCountrySelect = document.getElementById('chart-country-select');
  if (chartCountrySelect) {
    chartCountrySelect.addEventListener('change', onCountryChange);
  }

  const accountCountrySelect = document.getElementById('account-country-select');
  if (accountCountrySelect) {
    accountCountrySelect.addEventListener('change', onCountryChange);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (e.key === 'f' || e.key === 'F') {
      if (document.body.classList.contains('player-modal-open')) {
        e.preventDefault();
        toggleFullscreen();
      }
    }
  });

  const switchMediaMode = (mode) => {
    currentMediaMode = mode;
    const btnSong = document.getElementById('btn-mode-song');
    const btnVideo = document.getElementById('btn-mode-video');
    const albumArtWrap = document.getElementById('modal-album-art-wrap');
    const videoWrap = document.getElementById('modal-video-wrap');
    const btnModalTheater = document.getElementById('btn-modal-theater-toggle');

    if (mode === 'video') {
      const track = player.getCurrentTrack();
      if (!track?.videoId) {
        ui.showToast('현재 곡은 오디오 전용 음원입니다.');
        return;
      }
      btnSong?.classList.remove('active');
      btnVideo?.classList.add('active');
      albumArtWrap?.classList.add('hidden');
      videoWrap?.classList.add('active');
      document.body.classList.add('video-mode-active');
      if (btnModalTheater) btnModalTheater.style.display = 'inline-flex';
      requestAnimationFrame(() => {
        syncVideoPosition();
      });
      setTimeout(syncVideoPosition, 50);
      setTimeout(syncVideoPosition, 150);
      setTimeout(syncVideoPosition, 300);
    } else {
      btnSong?.classList.add('active');
      btnVideo?.classList.remove('active');
      albumArtWrap?.classList.remove('hidden');
      videoWrap?.classList.remove('active');
      document.body.classList.remove('video-mode-active');
      if (btnModalTheater) btnModalTheater.style.display = 'none';
      syncTheaterUI(false);
      syncVideoPosition();
    }
  };

  window.addEventListener('resize', syncVideoPosition);
  window.addEventListener('orientationchange', syncVideoPosition);
  const modalBodyEl = document.querySelector('.full-player-modal .modal-body');
  if (modalBodyEl) {
    modalBodyEl.addEventListener('scroll', syncVideoPosition, { passive: true });
  }

  const btnModeSong = document.getElementById('btn-mode-song');
  if (btnModeSong) btnModeSong.addEventListener('click', () => switchMediaMode('song'));

  const btnModeVideo = document.getElementById('btn-mode-video');
  if (btnModeVideo) btnModeVideo.addEventListener('click', () => switchMediaMode('video'));

  const btnExpandPlayer = document.getElementById('btn-expand-player');

  function openModal(pushState = true) {
    ui.dom.fullModal.classList.add('open');
    document.body.classList.add('player-modal-open');

    // 모바일 뒤로가기 제스처 / 브라우저 뒤로가기 지원 (#player)
    if (pushState && window.location.hash !== '#player') {
      try {
        history.pushState({ modal: 'player' }, '', '#player');
      } catch (e) {}
    }

    // 하단 바의 ^ 버튼을 v (chevron-down)으로 전환
    if (btnExpandPlayer) {
      btnExpandPlayer.innerHTML = '<i data-lucide="chevron-down"></i>';
      btnExpandPlayer.setAttribute('title', '플레이어 접기 (이전 화면으로 복귀)');
      btnExpandPlayer.classList.add('active');
    }
    if (window.lucide) window.lucide.createIcons();

    const isTheater = ui.dom.fullModal.classList.contains('modal-theater-mode');
    syncTheaterUI(isTheater);

    const activeTab = document.querySelector('.modal-tab.active');
    if (!activeTab) {
      document.querySelector('.modal-tab[data-tab="up-next"]')?.click();
    }

    if (currentMediaMode === 'video') {
      requestAnimationFrame(() => syncVideoPosition());
      setTimeout(syncVideoPosition, 80);
      setTimeout(syncVideoPosition, 250);
    }
  }

  function closeModal(fromPopState = false) {
    ui.dom.fullModal.classList.remove('open');
    document.body.classList.remove('player-modal-open');
    document.body.classList.remove('video-mode-active');

    // 하단 바의 v 버튼을 ^ (chevron-up)으로 복원
    if (btnExpandPlayer) {
      btnExpandPlayer.innerHTML = '<i data-lucide="chevron-up"></i>';
      btnExpandPlayer.setAttribute('title', '가사 및 대기열 열기');
      btnExpandPlayer.classList.remove('active');
    }
    if (window.lucide) window.lucide.createIcons();

    // persistent 동영상 위치를 즉시 초기화하여 메인 화면/보관함에 영상이 남는 현상 방지
    syncVideoPosition();

    if (!fromPopState && window.location.hash === '#player') {
      try {
        history.back();
      } catch (e) {}
    }
  }

  // 모바일 안드로이드/제스처 뒤로가기 시 모달 닫기
  window.addEventListener('popstate', () => {
    if (ui.dom.fullModal.classList.contains('open')) {
      closeModal(true);
    }
  });

  // 하단 바 ^ / v 토글 버튼: 닫혀있으면 열기, 열려있으면 이전 화면으로 닫기
  if (btnExpandPlayer) {
    btnExpandPlayer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ui.dom.fullModal.classList.contains('open')) {
        closeModal();
      } else {
        openModal();
      }
    });
  }

  const playerTrackInfo = document.getElementById('player-track-info');
  if (playerTrackInfo) {
    playerTrackInfo.addEventListener('click', (e) => {
      if (e.target.closest('#btn-like-track') || e.target.closest('#btn-thumb-down')) return;
      openModal();
    });
  }

  const btnCloseFullPlayer = document.getElementById('btn-close-full-player');
  if (btnCloseFullPlayer) btnCloseFullPlayer.addEventListener('click', () => closeModal());

  const btnOpenQueue = document.getElementById('btn-open-queue');
  if (btnOpenQueue) {
    btnOpenQueue.addEventListener('click', () => {
      openModal();
      document.querySelector('.modal-tab[data-tab="up-next"]')?.click();
    });
  }

  // 싫어요 버튼 (모바일 / 데스크톱 공통 지원)
  const handleDislike = () => {
    const cur = player.getCurrentTrack();
    if (cur) {
      ui.toggleDislike(cur);
      updatePersonalizedQuickPicks();
      updatePersonalizedSpotlight();
    }
  };
  const btnThumbDown = document.getElementById('btn-thumb-down');
  if (btnThumbDown) btnThumbDown.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDislike();
  });
  const btnModalDislike = document.getElementById('btn-modal-dislike');
  if (btnModalDislike) btnModalDislike.addEventListener('click', handleDislike);

  const btnModalDislikeMobile = document.getElementById('btn-modal-dislike-mobile');
  if (btnModalDislikeMobile) btnModalDislikeMobile.addEventListener('click', handleDislike);

  // 모바일 전용 5버튼 컨트롤러 이벤트 바인딩 (Screenshot 2 100% 매칭)
  const btnMobilePlay = document.getElementById('btn-mobile-play');
  if (btnMobilePlay) btnMobilePlay.addEventListener('click', () => player.togglePlayPause());

  const btnMobilePrev = document.getElementById('btn-mobile-prev');
  if (btnMobilePrev) btnMobilePrev.addEventListener('click', () => player.prevTrack());

  const btnMobileNext = document.getElementById('btn-mobile-next');
  if (btnMobileNext) btnMobileNext.addEventListener('click', () => player.nextTrack());

  const btnMobileShuffle = document.getElementById('btn-mobile-shuffle');
  if (btnMobileShuffle) btnMobileShuffle.addEventListener('click', () => syncShuffleUI(player.toggleShuffle()));

  const btnMobileRepeat = document.getElementById('btn-mobile-repeat');
  if (btnMobileRepeat) btnMobileRepeat.addEventListener('click', () => syncRepeatUI(player.cycleRepeat()));

  const mobileSeekInput = document.getElementById('mobile-seek-input');
  if (mobileSeekInput) {
    mobileSeekInput.addEventListener('input', (e) => {
      ui.isSeeking = true;
      const mobileFill = document.getElementById('mobile-seek-bar-fill');
      if (mobileFill) mobileFill.style.width = `${e.target.value}%`;
    });
    mobileSeekInput.addEventListener('change', (e) => {
      ui.isSeeking = false;
      player.seekToPercent(parseFloat(e.target.value));
    });
  }

  // 모바일 하단 서랍 (가사 / 대기열 / 관련 항목 드로어 슬라이드 업 & 터치 스와이프 제스처)
  const mobileDrawerHandle = document.getElementById('mobile-drawer-drag-bar');
  const modalContentPanel = document.getElementById('modal-content-panel');
  if (mobileDrawerHandle && modalContentPanel) {
    mobileDrawerHandle.addEventListener('click', () => {
      modalContentPanel.classList.toggle('drawer-expanded');
    });

    let touchStartY = 0;
    mobileDrawerHandle.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    mobileDrawerHandle.addEventListener('touchend', (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      const diffY = touchStartY - touchEndY;
      if (diffY > 35) {
        // 위로 스와이프 -> 확장
        modalContentPanel.classList.add('drawer-expanded');
      } else if (diffY < -35) {
        // 아래로 스와이프 -> 닫기
        modalContentPanel.classList.remove('drawer-expanded');
      }
    }, { passive: true });
  }

  // 3-dots 메뉴 팝업 바텀시트 (Screenshot 1 Right Image 100% 매칭)
  const trackMoreSheet = document.getElementById('track-more-sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  let currentSheetTrack = null;

  const openTrackMoreSheet = (track = player.getCurrentTrack()) => {
    if (!track) return;
    currentSheetTrack = track;
    const cover = document.getElementById('sheet-cover-img');
    const title = document.getElementById('sheet-track-title');
    const artist = document.getElementById('sheet-track-artist');
    if (cover) cover.src = track.cover;
    if (title) title.textContent = track.title;
    if (artist) artist.textContent = `${track.artist} • ${ui.formatTime(track.duration)}`;

    // 리액션 버튼 상태 동기화
    const btnLike = document.getElementById('sheet-btn-like');
    const btnDislike = document.getElementById('sheet-btn-dislike');
    if (btnLike) {
      btnLike.classList.toggle('liked', ui.likedTrackIds.has(track.id));
    }
    if (btnDislike) {
      btnDislike.classList.toggle('disliked', ui.dislikedTrackIds.has(track.id));
    }

    trackMoreSheet?.classList.add('open');
    if (window.lucide) window.lucide.createIcons();
  };

  const closeTrackMoreSheet = () => {
    trackMoreSheet?.classList.remove('open');
    currentSheetTrack = null;
  };

  document.getElementById('btn-modal-more')?.addEventListener('click', () => openTrackMoreSheet());
  document.getElementById('btn-player-more')?.addEventListener('click', () => openTrackMoreSheet());
  sheetBackdrop?.addEventListener('click', closeTrackMoreSheet);

  document.getElementById('sheet-btn-like')?.addEventListener('click', () => {
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      ui.toggleLike(target);
      const isLiked = ui.likedTrackIds.has(target.id);
      document.getElementById('sheet-btn-like')?.classList.toggle('liked', isLiked);
      if (isLiked) {
        document.getElementById('sheet-btn-dislike')?.classList.remove('disliked');
      }
    }
  });

  document.getElementById('sheet-btn-dislike')?.addEventListener('click', () => {
    const target = currentSheetTrack || player.getCurrentTrack();
    closeTrackMoreSheet();
    if (target) {
      ui.toggleDislike(target);
      updatePersonalizedQuickPicks();
      updatePersonalizedSpotlight();
    }
  });

  // 1. 뮤직 스테이션 시작
  document.getElementById('sheet-act-radio')?.addEventListener('click', async () => {
    const target = currentSheetTrack || player.getCurrentTrack();
    closeTrackMoreSheet();
    if (target) {
      playWithSmartQueue(target);
      ui.showToast(`'${target.title}' 뮤직 스테이션을 시작합니다.`);
      // 큐가 적으면 온라인에서 아티스트 곡을 실시간 추가하여 스테이션 자동 확장
      if (player.queue.length < 8 && target.artist) {
        try {
          const res = await searchService.searchOnline(`${target.artist} 노래`);
          const moreTracks = Array.isArray(res) ? res : (res.tracks || res.songs || []);
          moreTracks.forEach(t => {
            if (!player.queue.find(q => q.id === t.id || (t.videoId && q.videoId === t.videoId))) {
              player.queue.push(t);
            }
          });
          ui.renderQueue(player.queue, player.currentIndex);
        } catch (e) {}
      }
    }
  });

  // 2. 다음 동영상으로 재생
  document.getElementById('sheet-act-next')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      player.queue.splice(player.currentIndex + 1, 0, target);
      ui.renderQueue(player.queue, player.currentIndex);
      ui.showToast(`'${target.title}' 다음 재생 목록에 추가되었습니다.`);
    }
  });

  // 3. 목록에 추가
  document.getElementById('sheet-act-queue')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      player.addTrackToQueue(target);
      ui.renderQueue(player.queue, player.currentIndex);
      ui.showToast(`'${target.title}' 목록 끝에 추가되었습니다.`);
    }
  });

  // 4. 보관함에 추가
  document.getElementById('sheet-act-library')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      ui.toggleLike(target);
    }
  });

  // 5. 오프라인 저장 (IndexedDB 영구 저장 엔진)
  document.getElementById('sheet-act-download')?.addEventListener('click', async () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      try {
        await offlineStorage.saveTrack(target);
        await ui.updateOfflineBadgeCount();
        ui.showToast(`'${target.title}' 오프라인 저장 완료! (데이터 없이 감상 가능)`);
      } catch (e) {
        ui.showToast('오프라인 저장 중 오류가 발생했습니다.');
      }
    }
  });

  // 6. 재생목록에 추가
  document.getElementById('sheet-act-playlist')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      try {
        const stored = JSON.parse(localStorage.getItem('streamvance_user_playlists') || '[]');
        let defaultPl = stored.find(p => p.id === 'user-pl-default');
        if (!defaultPl) {
          defaultPl = { id: 'user-pl-default', title: '내가 만든 재생목록', tracks: [] };
          stored.push(defaultPl);
        }
        if (!defaultPl.tracks.find(t => t.id === target.id || (t.videoId && t.videoId === target.videoId))) {
          defaultPl.tracks.push(target);
          localStorage.setItem('streamvance_user_playlists', JSON.stringify(stored));
        }
      } catch (e) {}
      ui.showToast(`'${target.title}'이(가) 내 재생목록에 추가되었습니다.`);
    }
  });

  // 7. 앨범으로 이동
  document.getElementById('sheet-act-album')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target) {
      closeModal();
      ui.switchView('search');
      const q = (target.album && target.album !== 'YouTube Music Stream') ? target.album : `${target.artist} ${target.title}`;
      if (ui.dom.searchInput) ui.dom.searchInput.value = q;
      if (ui.dom.mobileSearchInput) ui.dom.mobileSearchInput.value = q;
      executeSearch(q, 'album');
      ui.showToast(`앨범 '${q}' 검색 결과를 불러옵니다.`);
    }
  });

  // 8. 아티스트로 이동
  document.getElementById('sheet-act-artist')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const target = currentSheetTrack || player.getCurrentTrack();
    if (target && target.artist) {
      closeModal();
      ui.switchView('search');
      if (ui.dom.searchInput) ui.dom.searchInput.value = target.artist;
      if (ui.dom.mobileSearchInput) ui.dom.mobileSearchInput.value = target.artist;
      executeSearch(target.artist);
      ui.showToast(`아티스트 '${target.artist}' 검색 결과를 불러옵니다.`);
    }
  });

  // 9. 공유 (근처 기기 Bluetooth / Quick Share / Streamvance 링크 공유)
  document.getElementById('sheet-act-share')?.addEventListener('click', () => {
    const target = currentSheetTrack || player.getCurrentTrack();
    closeTrackMoreSheet();
    shareNearbyDevice(target);
  });

  // 10. 신고 (버튼은 유지하되 실제 신고/알림은 작동하지 않도록 무동작 처리 - 사용자 요청)
  document.getElementById('sheet-act-report')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeTrackMoreSheet();
    // 사용자 요청: 신고 버튼은 유지한 채로 실제로 작동하지 않게 처리
  });

  // 11. 자막 토글 (실시간 비주얼 무대 자막 오버레이 및 가사 싱크)
  let isCaptionsActive = false;
  document.getElementById('sheet-act-captions')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    isCaptionsActive = !isCaptionsActive;
    const stageCcOverlay = document.getElementById('stage-cc-overlay');
    if (stageCcOverlay) {
      stageCcOverlay.style.display = isCaptionsActive ? 'block' : 'none';
    }
    const cur = player.getCurrentTrack();
    if (isCaptionsActive) {
      document.querySelector('.modal-tab[data-tab="lyrics"]')?.click();
      if (window.innerWidth <= 768) {
        document.getElementById('modal-content-panel')?.classList.add('drawer-expanded');
      }
      ui.showToast('실시간 싱크 자막이 활성화되었습니다.');
      if (cur?.lyrics && cur.lyrics.length > 0) {
        ui.updateLyricsSync(player.currentTime || 0, cur.lyrics);
      }
    } else {
      ui.showToast('실시간 자막이 꺼졌습니다.');
    }
  });

  // 오프라인 저장 콘텐츠 보관함 뷰 표시 함수 (정상 작동 보장)
  async function openOfflineLibrary() {
    closeModal();
    auth.closeProfileDropdown();
    closeAccountDrawer();
    ui.switchView('library');
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
    const offTab = document.querySelector('.lib-tab[data-lib="offline"]');
    if (offTab) offTab.classList.add('active');
    await ui.renderLibrary('offline', allTracks);
    const offlineList = await offlineStorage.getTracks();
    if (offlineList.length === 0) {
      ui.showToast('오프라인 저장된 곡이 없습니다. 원하는 노래의 [더보기(⋮) > 오프라인 저장]을 이용해보세요.');
    } else {
      ui.showToast(`오프라인 저장 콘텐츠 (${offlineList.length}곡)`);
    }
  }

  // ==========================================================================
  // 16. YouTube Music 정품 계정 패널 컨트롤 (Screenshot 2 100% 매칭)
  // ==========================================================================
  const accountDrawer = document.getElementById('account-drawer-overlay');
  const openAccountDrawer = () => {
    const nameEl = document.getElementById('account-user-name');
    const handleEl = document.getElementById('account-user-handle');
    const avatarCircle = document.getElementById('account-avatar-circle');
    const avatarImg = document.getElementById('account-avatar-img');

    // 현재 사용자 정보 동기화 (사용자 요청: 핫핑크 LG 대신 실제 내 프로필 사진 및 이름 '최서원'/'서원'으로 동기화)
    const currentName = auth.currentUser?.name || document.getElementById('welcome-user-name')?.textContent || '최서원';
    const currentEmail = auth.currentUser?.email || 'seowon.choi@gmail.com';
    const currentPic = auth.currentUser?.picture || auth.currentUser?.avatar;

    if (nameEl) nameEl.textContent = currentName;
    if (handleEl) handleEl.textContent = `@${currentEmail.split('@')[0]}`;

    if (currentPic) {
      if (avatarImg) {
        avatarImg.src = currentPic;
        avatarImg.style.display = 'block';
      }
      if (avatarCircle) avatarCircle.style.display = 'none';
    } else {
      if (avatarCircle) {
        avatarCircle.style.display = 'flex';
        avatarCircle.textContent = currentName.length >= 2 ? currentName.slice(-2) : currentName;
        avatarCircle.style.background = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';
        avatarCircle.style.color = '#ffffff';
        avatarCircle.style.fontWeight = '700';
      }
      if (avatarImg) avatarImg.style.display = 'none';
    }
    accountDrawer?.classList.add('open');
    if (window.lucide) window.lucide.createIcons();
  };

  const closeAccountDrawer = () => {
    accountDrawer?.classList.remove('open');
  };

  document.getElementById('btn-close-account-panel')?.addEventListener('click', closeAccountDrawer);
  document.getElementById('account-drawer-backdrop')?.addEventListener('click', closeAccountDrawer);
  document.getElementById('menu-open-account-drawer')?.addEventListener('click', () => {
    auth.closeProfileDropdown();
    openAccountDrawer();
  });
  document.getElementById('menu-view-offline-pc')?.addEventListener('click', () => {
    auth.closeProfileDropdown();
    openOfflineLibrary();
  });

  // 프로필 아바타 클릭 시 모바일/PC 스마트 연동
  const userAvatarWrap = document.querySelector('.header-user-avatar');
  if (userAvatarWrap) {
    userAvatarWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      openAccountDrawer();
    });
  }

  // 계정 패널 개별 메뉴 클릭 처리 (Screenshot 2)
  document.getElementById('account-item-channel')?.addEventListener('click', () => {
    closeAccountDrawer();
    ui.switchView('library');
  });
  document.getElementById('account-item-offline')?.addEventListener('click', () => {
    closeAccountDrawer();
    openOfflineLibrary();
  });
  document.getElementById('account-item-history')?.addEventListener('click', () => {
    closeAccountDrawer();
    ui.switchView('library');
    document.querySelector('.lib-tab[data-lib="history"]')?.click();
  });
  document.getElementById('account-item-recap')?.addEventListener('click', () => {
    closeAccountDrawer();
    auth.openTasteModal(allTracks);
  });
  document.getElementById('account-item-membership')?.addEventListener('click', () => {
    ui.showToast('Streamvance Premium 멤버십이 활성화되어 있습니다.');
  });
  document.getElementById('account-item-switch')?.addEventListener('click', () => {
    closeAccountDrawer();
    auth.openLoginModal();
  });
  document.getElementById('account-item-settings')?.addEventListener('click', () => {
    ui.showToast('설정: 앰비언트 모드, 실시간 정밀 가사 싱크 및 MediaSession 백그라운드 재생이 활성화되어 있습니다.');
  });
  document.getElementById('account-item-help')?.addEventListener('click', () => {
    ui.showToast('Streamvance 고객센터: 서비스 이용 및 지원 안내가 활성화되어 있습니다.');
  });


  // Full Modal Tabs (Up Next, Lyrics, Related)
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetPane = tab.getAttribute('data-tab');

      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
      });
      const activePane = document.getElementById(`pane-${targetPane}`);
      if (activePane) activePane.classList.add('active');

      // 모바일에서 탭 클릭 시 서랍 자동 오픈
      if (window.innerWidth <= 768 && modalContentPanel) {
        modalContentPanel.classList.add('drawer-expanded');
      }
    });
  });

  // 대기열 비우기 버튼
  const btnClearQueue = document.getElementById('btn-clear-queue');
  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
      player.clearQueue();
      ui.showToast('대기열을 모두 비웠습니다.');
    });
  }

  // 실시간 가사 싱크 미세조정 핸들러 (유튜브 MV 인트로 대화나 전주 차이 즉시 해결)
  const handleLyricSyncAdjust = (delta, isReset = false) => {
    const current = player.getCurrentTrack();
    if (!current) return;

    let newOffset = 0;
    if (!isReset) {
      const currentOffset = (current.lyricsOffset !== undefined) ? current.lyricsOffset : 0;
      newOffset = Math.round((currentOffset + delta) * 10) / 10;
    }

    current.lyricsOffset = newOffset;
    lyricsService.saveCustomOffset(current, newOffset);

    if (current.lyrics && Array.isArray(current.lyrics)) {
      lyricsService.adjustLyricsOffset(current.lyrics, newOffset);
      ui.refreshLyricTimes(current.lyrics);
      ui.updateLyricsOffsetDisplay(newOffset);
      ui.updateLyricsSync(player.getCurrentTime(), current.lyrics);
    }

    const sign = newOffset > 0 ? '+' : '';
    ui.showToast(`가사 싱크: ${sign}${newOffset.toFixed(1)}초 (자동 저장됨)`);
  };

  const btnSyncMinusFast = document.getElementById('btn-sync-minus-fast');
  const btnSyncMinus = document.getElementById('btn-sync-minus');
  const btnSyncReset = document.getElementById('btn-sync-reset');
  const btnSyncPlus = document.getElementById('btn-sync-plus');
  const btnSyncPlusFast = document.getElementById('btn-sync-plus-fast');

  if (btnSyncMinusFast) btnSyncMinusFast.addEventListener('click', () => handleLyricSyncAdjust(-1.0));
  if (btnSyncMinus) btnSyncMinus.addEventListener('click', () => handleLyricSyncAdjust(-0.5));

  const btnSyncMinusFine = document.getElementById('btn-sync-minus-fine');
  const btnSyncPlusFine = document.getElementById('btn-sync-plus-fine');
  if (btnSyncMinusFine) btnSyncMinusFine.addEventListener('click', () => handleLyricSyncAdjust(-0.1));
  if (btnSyncPlusFine) btnSyncPlusFine.addEventListener('click', () => handleLyricSyncAdjust(0.1));

  if (btnSyncReset) btnSyncReset.addEventListener('click', () => handleLyricSyncAdjust(0, true));
  if (btnSyncPlus) btnSyncPlus.addEventListener('click', () => handleLyricSyncAdjust(0.5));
  if (btnSyncPlusFast) btnSyncPlusFast.addEventListener('click', () => handleLyricSyncAdjust(1.0));

  // 키보드 단축키 지원 ([ : 0.5초 당기기, ] : 0.5초 미루기, { : 1초 당기기, } : 1초 미루기)
  window.addEventListener('keydown', (e) => {
    // 텍스트 입력 중일 때는 무시
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    if (e.key === '[') {
      e.preventDefault();
      handleLyricSyncAdjust(-0.5);
    } else if (e.key === ']') {
      e.preventDefault();
      handleLyricSyncAdjust(0.5);
    } else if (e.key === '{') {
      e.preventDefault();
      handleLyricSyncAdjust(-1.0);
    } else if (e.key === '}') {
      e.preventDefault();
      handleLyricSyncAdjust(1.0);
    } else if (e.key === ',') {
      e.preventDefault();
      handleLyricSyncAdjust(-0.1);
    } else if (e.key === '.') {
      e.preventDefault();
      handleLyricSyncAdjust(0.1);
    }
  });

  // 10. Real-time YouTube Search Functionality (Zero Local Storage)
  let searchDebounceTimer = null;

  // 최근 검색어 저장 및 렌더링 함수
  function saveRecentSearch(q) {
    if (!q || !q.trim()) return;
    const cleanQ = q.trim();
    try {
      let recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]');
      recents = recents.filter(item => item.toLowerCase() !== cleanQ.toLowerCase());
      recents.unshift(cleanQ);
      if (recents.length > 10) recents.pop();
      localStorage.setItem('streamvance_recent_searches', JSON.stringify(recents));

      // 사용자가 다시 검색하면 삭제 목록에서 복구
      let deleted = JSON.parse(localStorage.getItem('streamvance_deleted_searches') || '[]');
      deleted = deleted.filter(item => item.toLowerCase() !== cleanQ.toLowerCase());
      localStorage.setItem('streamvance_deleted_searches', JSON.stringify(deleted));

      renderRecentSearches();
      updatePersonalizedQuickPicks();
    } catch (e) {}
  }

  // 검색어 개별 삭제 & 알고리즘에서도 완전 제외 연동
  function deleteRecentSearchItem(query) {
    if (!query) return;
    const qLower = query.toLowerCase().trim();
    try {
      // 1) 최근 검색어 목록에서 제거
      let recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]');
      recents = recents.filter(item => item.toLowerCase() !== qLower);
      localStorage.setItem('streamvance_recent_searches', JSON.stringify(recents));

      // 2) 알고리즘 제외 목록(deleted_searches)에 영구 추가
      let deleted = JSON.parse(localStorage.getItem('streamvance_deleted_searches') || '[]');
      if (!deleted.includes(qLower)) {
        deleted.push(qLower);
      }
      localStorage.setItem('streamvance_deleted_searches', JSON.stringify(deleted));

      // 3) 구글 테이크아웃 가져오기 아티스트 풀에서도 해당 아티스트/검색어 가중치 제거
      const savedTakeout = localStorage.getItem('streamvance_takeout_top_artists');
      if (savedTakeout) {
        let parsed = JSON.parse(savedTakeout);
        if (Array.isArray(parsed)) {
          parsed = parsed.filter(item => {
            const aLow = (item.artist || '').toLowerCase();
            return !aLow.includes(qLower) && !qLower.includes(aLow);
          });
          localStorage.setItem('streamvance_takeout_top_artists', JSON.stringify(parsed));
        }
      }

      renderRecentSearches();
      updatePersonalizedQuickPicks();
      ui.showToast(`'${query}' 검색 기록 및 알고리즘 추천에서 삭제되었습니다.`);
    } catch (e) {}
  }

  // 검색어 전체 삭제 & 알고리즘 초기화
  function clearAllRecentSearches() {
    try {
      let recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]');
      let deleted = JSON.parse(localStorage.getItem('streamvance_deleted_searches') || '[]');
      recents.forEach(r => {
        const rLow = r.toLowerCase();
        if (!deleted.includes(rLow)) deleted.push(rLow);
      });
      localStorage.setItem('streamvance_deleted_searches', JSON.stringify(deleted));
      localStorage.setItem('streamvance_recent_searches', JSON.stringify([]));

      renderRecentSearches();
      updatePersonalizedQuickPicks();
      ui.showToast('검색 기록이 모두 삭제되고 추천이 재설정되었습니다.');
    } catch (e) {}
  }

  function renderRecentSearches() {
    let recents = [];
    try {
      recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]');
    } catch (e) {}

    const generateHtml = (items) => {
      if (items.length === 0) {
        return `<div style="padding: 16px 8px; font-size: 0.85rem; color: #888; text-align: center;">최근 검색 기록이 없습니다.</div>`;
      }
      return items.map(q => `
        <div class="recent-search-item" data-query="${q}">
          <div class="recent-search-item-left" data-query="${q}">
            <i data-lucide="history"></i>
            <span>${q}</span>
          </div>
          <button type="button" class="btn-delete-search-item" data-delete-query="${q}" title="기록에서 삭제">
            <i data-lucide="x" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `).join('');
    };

    const htmlContent = generateHtml(recents);

    // 모바일 오버레이 렌더링
    if (ui.dom.recentSearchList) {
      ui.dom.recentSearchList.innerHTML = htmlContent;
    }
    // PC 드롭다운 렌더링
    if (ui.dom.pcRecentSearchList) {
      ui.dom.pcRecentSearchList.innerHTML = htmlContent;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  const executeSearch = async (val) => {
    clearTimeout(searchDebounceTimer);
    if (!val) {
      closeModal();
      ui.switchView('home');
      return;
    }

    saveRecentSearch(val);
    closeModal();
    ui.switchView('search');

    // 검색 필터 칩 바 초기화 ('전체'로 리셋)
    ui.currentSearchFilter = 'all';
    const chipsBar = document.getElementById('search-filter-chips-bar');
    if (chipsBar) {
      chipsBar.querySelectorAll('.search-filter-chip').forEach(c => c.classList.remove('active'));
      chipsBar.querySelector('.search-filter-chip[data-filter="all"]')?.classList.add('active');
    }

    // 1) 즉시 로컬 카탈로그 필터링 결과 표시 (0.01초 반응)
    const localFiltered = allTracks.filter(t => 
      t.title.toLowerCase().includes(val.toLowerCase()) ||
      t.artist.toLowerCase().includes(val.toLowerCase()) ||
      t.album.toLowerCase().includes(val.toLowerCase())
    );
    ui.renderSearchResults(val, localFiltered, true);

    // 2) 고속 실시간 라이브 검색 비동기 실행 (아티스트 및 곡 분리 매칭)
    try {
      const searchRes = await searchService.searchOnline(val);
      const onlineTracks = Array.isArray(searchRes) ? searchRes : (searchRes.tracks || searchRes.songs || []);
      
      // 전역 풀에 새 트랙 등록 (클릭 시 재생 가능하도록)
      onlineTracks.forEach(t => {
        if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
          allTracks.push(t);
        }
      });

      ui.renderSearchResults(val, searchRes, false);
    } catch (err) {
      console.warn("Online search error:", err);
      ui.renderSearchResults(val, localFiltered, false);
    }
  };

  // 검색 결과 카테고리 필터 칩 바 이벤트 (Screenshot 3 매칭)
  const searchChipsBar = document.getElementById('search-filter-chips-bar');
  if (searchChipsBar) {
    searchChipsBar.addEventListener('click', (e) => {
      const chip = e.target.closest('.search-filter-chip');
      if (!chip) return;
      searchChipsBar.querySelectorAll('.search-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.getAttribute('data-filter') || 'all';
      ui.currentSearchFilter = filter;
      if (ui.lastSearchData) {
        ui.renderSearchResults(ui.lastSearchData.query, ui.lastSearchData.searchData, false);
      }
    });
  }

  // 검색 결과 카드 클릭 & 더보기(⋮) 바텀시트 메뉴 연동
  const searchResultsListEl = document.getElementById('search-results-list');
  if (searchResultsListEl) {
    searchResultsListEl.addEventListener('click', (e) => {
      const moreBtn = e.target.closest('.search-card-more-btn');
      if (moreBtn) {
        e.stopPropagation();
        const trackId = moreBtn.getAttribute('data-track-id');
        const track = allTracks.find(t => t.id === trackId) || ui.playHistory.find(t => t.id === trackId);
        if (track) {
          openTrackMoreSheet(track);
        }
        return;
      }

      const card = e.target.closest('.search-card-wide') || e.target.closest('.track-row-card');
      if (card) {
        const trackId = card.getAttribute('data-track-id');
        const track = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
        if (track) {
          playWithSmartQueue(track);
        }
      }
    });
  }

  // 1) 아티스트 전용 뷰 연동 및 추가 곡 페칭 콜백 (사용자 요청 2번)
  ui.onFetchMoreArtistSongs = async (artistName, callback) => {
    try {
      const res = await searchService.searchOnline(`${artistName} 노래`);
      const songs = Array.isArray(res) ? res : (res.tracks || res.songs || []);
      songs.forEach(t => {
        if (!allTracks.find(item => item.id === t.id || (item.videoId && item.videoId === t.videoId))) {
          allTracks.push(t);
        }
      });
      callback(songs);
    } catch (e) {
      callback([]);
    }
  };

  // 아티스트 뷰 뒤로가기 버튼
  const btnArtistBack = document.getElementById('btn-artist-back');
  if (btnArtistBack) {
    btnArtistBack.addEventListener('click', () => {
      ui.switchView('search');
    });
  }

  // 아티스트 전체 재생 & 셔플
  const btnArtistPlayAll = document.getElementById('btn-artist-play-all');
  if (btnArtistPlayAll) {
    btnArtistPlayAll.addEventListener('click', () => {
      if (ui.currentArtistTracks && ui.currentArtistTracks.length > 0) {
        player.setQueue(ui.currentArtistTracks, 0);
        ui.showToast(`${ui.currentArtist?.name || '아티스트'} 모든 곡을 재생합니다.`);
      }
    });
  }

  const btnArtistShuffleAll = document.getElementById('btn-artist-shuffle-all');
  if (btnArtistShuffleAll) {
    btnArtistShuffleAll.addEventListener('click', () => {
      if (ui.currentArtistTracks && ui.currentArtistTracks.length > 0) {
        const shuffled = [...ui.currentArtistTracks].sort(() => Math.random() - 0.5);
        player.setQueue(shuffled, 0);
        ui.showToast(`${ui.currentArtist?.name || '아티스트'} 모든 곡을 셔플 재생합니다.`);
      }
    });
  }

  // 아티스트 곡 목록 카드 클릭
  const artistFullTracksListEl = document.getElementById('artist-full-tracks-list');
  if (artistFullTracksListEl) {
    artistFullTracksListEl.addEventListener('click', (e) => {
      const moreBtn = e.target.closest('.search-card-more-btn');
      if (moreBtn) {
        e.stopPropagation();
        const trackId = moreBtn.getAttribute('data-track-id');
        const track = allTracks.find(t => t.id === trackId) || ui.currentArtistTracks?.find(t => t.id === trackId);
        if (track) openTrackMoreSheet(track);
        return;
      }
      const card = e.target.closest('.search-card-wide') || e.target.closest('.track-row-card');
      if (card) {
        const trackId = card.getAttribute('data-track-id');
        const track = allTracks.find(t => t.id === trackId) || ui.currentArtistTracks?.find(t => t.id === trackId);
        if (track) playWithSmartQueue(track);
      }
    });
  }

  // 2) YouTube Music 액션 바 (좋아요, 싫어요, 댓글, 저장) 연동 (사용자 요청 6번 & 스크린샷 일치)
  const btnPillLike = document.getElementById('btn-pill-like');
  if (btnPillLike) {
    btnPillLike.addEventListener('click', () => {
      const cur = player.getCurrentTrack();
      if (cur) {
        ui.toggleLike(cur);
      }
    });
  }

  const btnPillDislike = document.getElementById('btn-pill-dislike');
  if (btnPillDislike) {
    btnPillDislike.addEventListener('click', () => {
      const cur = player.getCurrentTrack();
      if (cur) {
        ui.toggleDislike(cur);
      }
    });
  }

  const btnPillComment = document.getElementById('btn-pill-comment');
  if (btnPillComment) {
    btnPillComment.addEventListener('click', () => {
      const cur = player.getCurrentTrack();
      if (cur) {
        let vid = cur.videoId;
        if (!vid && cur.id) {
          if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
            const found = window.allTracks.find(t => t.id === cur.id);
            if (found && found.videoId) vid = found.videoId;
          }
          if (!vid && typeof cur.id === 'string') {
            vid = cur.id.replace(/^yt-/, '');
          }
        }
        ui.openCommentsSheet(vid, 'top');
      }
    });
  }

  // 플레이어 바 댓글 버튼 클릭 시에도 실시간 댓글 바텀시트 즉시 오픈
  const btnPlayerComment = document.getElementById('btn-player-comment');
  if (btnPlayerComment) {
    btnPlayerComment.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = player.getCurrentTrack();
      if (cur) {
        let vid = cur.videoId;
        if (!vid && cur.id) {
          if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
            const found = window.allTracks.find(t => t.id === cur.id);
            if (found && found.videoId) vid = found.videoId;
          }
          if (!vid && typeof cur.id === 'string') {
            vid = cur.id.replace(/^yt-/, '');
          }
        }
        ui.openCommentsSheet(vid, 'top');
      }
    });
  }

  const btnPillSave = document.getElementById('btn-pill-save');
  if (btnPillSave) {
    btnPillSave.addEventListener('click', () => {
      const cur = player.getCurrentTrack();
      if (cur) {
        openTrackMoreSheet(cur);
      }
    });
  }

  // 4) OLED 화면 끄기 / 절전 슬립 모드 (화면 꺼짐 시 음악 유지용)
  const btnSleepMode = document.getElementById('btn-modal-sleep-mode');
  const oledOverlay = document.getElementById('oled-sleep-overlay');
  const oledTrackName = document.getElementById('oled-sleep-track-name');

  if (btnSleepMode && oledOverlay) {
    btnSleepMode.addEventListener('click', () => {
      const cur = player.getCurrentTrack();
      if (oledTrackName && cur) {
        oledTrackName.textContent = `${cur.title} - ${cur.artist}`;
      }
      oledOverlay.style.display = 'flex';
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(() => {});
      }
    });

    let lastTap = 0;
    oledOverlay.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 400) {
        // 더블 탭 시 해제
        oledOverlay.style.display = 'none';
      } else {
        lastTap = now;
        const hint = oledOverlay.querySelector('.oled-sleep-hint');
        if (hint) {
          hint.style.color = '#fff';
          setTimeout(() => { hint.style.color = '#777'; }, 800);
        }
      }
    });
  }

  // 3) 댓글 바텀시트 닫기 및 정렬 필터 연동
  const btnCloseComments = document.getElementById('btn-close-comments');
  const commentsBackdrop = document.getElementById('comments-sheet-backdrop');
  const commentsModal = document.getElementById('comments-sheet-modal');
  const closeCommentsSheet = () => {
    if (commentsModal) commentsModal.classList.remove('open');
    document.body.classList.remove('comments-sheet-open');
  };
  if (btnCloseComments) btnCloseComments.addEventListener('click', closeCommentsSheet);
  if (commentsBackdrop) commentsBackdrop.addEventListener('click', closeCommentsSheet);

  // 모바일 댓글 바텀시트 드래그 핸들 아래로 쓸어내려 닫기 터치 제스처
  const commentsDragHandle = document.querySelector('.comments-sheet-drag-handle');
  if (commentsDragHandle && commentsModal) {
    let startY = 0;
    commentsDragHandle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    commentsDragHandle.addEventListener('touchend', (e) => {
      const diffY = e.changedTouches[0].clientY - startY;
      if (diffY > 50) {
        closeCommentsSheet();
      }
    }, { passive: true });
  }

  const btnCommentsTop = document.getElementById('btn-comments-sort-top');
  const btnCommentsNew = document.getElementById('btn-comments-sort-new');
  if (btnCommentsTop) {
    btnCommentsTop.addEventListener('click', () => {
      if (ui.currentCommentsVideoId) {
        ui.openCommentsSheet(ui.currentCommentsVideoId, 'top');
      }
    });
  }
  if (btnCommentsNew) {
    btnCommentsNew.addEventListener('click', () => {
      if (ui.currentCommentsVideoId) {
        ui.openCommentsSheet(ui.currentCommentsVideoId, 'new');
      }
    });
  }

  if (ui.dom.searchInput) {
    ui.dom.searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (ui.dom.searchClearBtn) {
        ui.dom.searchClearBtn.style.display = val ? 'block' : 'none';
      }

      if (val.length === 0) {
        clearTimeout(searchDebounceTimer);
        return;
      }

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => executeSearch(val), 250);
    });

    // 엔터키 입력 시 유튜브 URL이면 다이렉트 재생, 일반 검색어면 0ms 즉시 검색 실행
    ui.dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = ui.dom.searchInput.value.trim();
        if (!val) return;

        // 유튜브 링크 직접 붙여넣기 지원
        const ytMatch = val.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        if (ytMatch && ytMatch[1]) {
          const customTrack = {
            id: `yt-${ytMatch[1]}`,
            videoId: ytMatch[1],
            title: `YouTube 사용자 지정 트랙 (${ytMatch[1]})`,
            artist: "YouTube Stream",
            album: "Direct Stream",
            genre: "custom",
            mood: "all",
            duration: 200,
            cover: `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`,
            lyrics: [{ time: 0, text: "[YouTube 직접 링크 재생]" }],
            isLiked: false
          };
          allTracks.unshift(customTrack);
          player.addTrackToQueue(customTrack, true);
          ui.showToast('YouTube 링크에서 음악을 불러와 재생합니다.');
          ui.dom.searchInput.value = '';
          ui.switchView('home');
          return;
        }

        executeSearch(val);
      }
    });

    // 검색창 x 버튼 클릭 시: 홈화면으로 튕기지 않고 글자만 지우고 인풋 포커스 유지 (사용자 요청 1번)
    if (ui.dom.searchClearBtn) {
      ui.dom.searchClearBtn.addEventListener('click', () => {
        ui.dom.searchInput.value = '';
        ui.dom.searchClearBtn.style.display = 'none';
        ui.dom.searchInput.focus();
      });
    }

    const btnSearchToggle = document.getElementById('btn-search-toggle');
    if (btnSearchToggle) {
      btnSearchToggle.addEventListener('click', () => {
        if (ui.dom.searchInput) {
          ui.dom.searchInput.focus();
          const val = ui.dom.searchInput.value.trim();
          if (val) executeSearch(val);
        }
      });
    }
  }

  // 모바일 검색 바 및 오버레이 이벤트 바인딩 (Screenshot 3 100% 일치)
  if (ui.dom.mobileSearchBtn) {
    ui.dom.mobileSearchBtn.addEventListener('click', () => {
      if (ui.dom.mobileSearchOverlay) {
        ui.dom.mobileSearchOverlay.style.display = 'flex';
        renderRecentSearches();
        if (ui.dom.mobileSearchInput) {
          ui.dom.mobileSearchInput.focus();
        }
      }
    });
  }

  if (ui.dom.mobileSearchBackBtn) {
    ui.dom.mobileSearchBackBtn.addEventListener('click', () => {
      if (ui.dom.mobileSearchOverlay) {
        ui.dom.mobileSearchOverlay.style.display = 'none';
      }
    });
  }

  if (ui.dom.mobileSearchInput) {
    // 텍스트 입력 시: 클리어 버튼 표시/숨김만 처리 (타이핑 도중 닫히는 치명적 버그 수정)
    ui.dom.mobileSearchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (ui.dom.mobileSearchClearBtn) {
        ui.dom.mobileSearchClearBtn.style.display = val ? 'flex' : 'none';
      }
    });

    // 키보드 엔터키 입력 시 검색 실행
    ui.dom.mobileSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = ui.dom.mobileSearchInput.value.trim();
        if (val) {
          if (ui.dom.mobileSearchOverlay) ui.dom.mobileSearchOverlay.style.display = 'none';
          if (ui.dom.searchInput) ui.dom.searchInput.value = val;
          executeSearch(val);
        }
      }
    });
  }

  // 모바일 검색 폼 제출 (가상 키보드의 '검색' / '이동' 버튼 탭 시 100% 실행)
  if (ui.dom.mobileSearchForm) {
    ui.dom.mobileSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (ui.dom.mobileSearchInput ? ui.dom.mobileSearchInput.value : '').trim();
      if (val) {
        if (ui.dom.mobileSearchOverlay) ui.dom.mobileSearchOverlay.style.display = 'none';
        if (ui.dom.searchInput) ui.dom.searchInput.value = val;
        executeSearch(val);
      }
    });
  }

  // 모바일 검색 돋보기 버튼 탭 시 검색 실행
  if (ui.dom.mobileSearchSubmitBtn) {
    ui.dom.mobileSearchSubmitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = (ui.dom.mobileSearchInput ? ui.dom.mobileSearchInput.value : '').trim();
      if (val) {
        if (ui.dom.mobileSearchOverlay) ui.dom.mobileSearchOverlay.style.display = 'none';
        if (ui.dom.searchInput) ui.dom.searchInput.value = val;
        executeSearch(val);
      }
    });
  }

  if (ui.dom.mobileSearchClearBtn) {
    ui.dom.mobileSearchClearBtn.addEventListener('click', () => {
      if (ui.dom.mobileSearchInput) {
        ui.dom.mobileSearchInput.value = '';
        ui.dom.mobileSearchClearBtn.style.display = 'none';
        ui.dom.mobileSearchInput.focus();
      }
    });
  }

  // PC 검색창 포커스 시 최근 검색어 드롭다운 토글 & 외부 클릭 시 닫기
  if (ui.dom.searchInput && ui.dom.searchDropdownMenu) {
    ui.dom.searchInput.addEventListener('focus', () => {
      renderRecentSearches();
      ui.dom.searchDropdownMenu.style.display = 'block';
    });

    document.addEventListener('click', (e) => {
      const isInsideSearch = e.target.closest('#ytm-search-box');
      if (!isInsideSearch && ui.dom.searchDropdownMenu) {
        ui.dom.searchDropdownMenu.style.display = 'none';
      }
    });
  }

  // 최근 검색어 클릭 이벤트 위임 (개별 삭제 X 버튼 vs 검색어 실행)
  const handleRecentSearchClick = (e) => {
    const delBtn = e.target.closest('.btn-delete-search-item');
    if (delBtn) {
      e.stopPropagation();
      const q = delBtn.getAttribute('data-delete-query');
      if (q) deleteRecentSearchItem(q);
      return;
    }

    const item = e.target.closest('.recent-search-item');
    if (item) {
      const q = item.getAttribute('data-query');
      if (q) {
        if (ui.dom.searchDropdownMenu) ui.dom.searchDropdownMenu.style.display = 'none';
        if (ui.dom.mobileSearchOverlay) ui.dom.mobileSearchOverlay.style.display = 'none';
        if (ui.dom.searchInput) ui.dom.searchInput.value = q;
        executeSearch(q);
      }
    }
  };

  if (ui.dom.recentSearchList) {
    ui.dom.recentSearchList.addEventListener('click', handleRecentSearchClick);
  }
  if (ui.dom.pcRecentSearchList) {
    ui.dom.pcRecentSearchList.addEventListener('click', handleRecentSearchClick);
  }

  // 최근 검색어 전체 삭제 버튼 (PC & 모바일)
  if (ui.dom.btnClearSearchesPc) {
    ui.dom.btnClearSearchesPc.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllRecentSearches();
    });
  }
  if (ui.dom.btnClearSearchesMobile) {
    ui.dom.btnClearSearchesMobile.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllRecentSearches();
    });
  }

  // 보관함 시청 / 감상 기록 전체 삭제 버튼
  if (ui.dom.btnClearHistory) {
    ui.dom.btnClearHistory.addEventListener('click', () => {
      if (confirm('시청 및 감상 기록을 모두 삭제하시겠습니까?')) {
        ui.clearAllPlayHistory();
        updatePersonalizedQuickPicks();
      }
    });
  }

  // 시청 기록 변경 시 맞춤 추천 자동 재계산 콜백
  ui.onHistoryChanged = () => {
    updatePersonalizedQuickPicks();
  };

  // 11. Library Tabs (Likes, History, Local)
  document.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.getAttribute('data-lib');
      ui.renderLibrary(type, allTracks);
    });
  });

  // 보관함 최근 재생한 곡 날짜별 검색 & 필터 바 이벤트 리스너
  const libDatePicker = document.getElementById('library-date-picker');
  const libDateSearchInput = document.getElementById('library-date-search-input');
  const btnClearDateFilter = document.getElementById('btn-clear-date-filter');

  const applyLibraryDateFilter = (val) => {
    ui.libraryDateFilter = (val || '').trim();
    if (btnClearDateFilter) {
      btnClearDateFilter.style.display = ui.libraryDateFilter ? 'flex' : 'none';
    }
    ui.renderLibrary('history', allTracks);
  };

  if (libDatePicker) {
    libDatePicker.addEventListener('change', (e) => {
      const val = e.target.value; // 'YYYY-MM-DD'
      if (libDateSearchInput) libDateSearchInput.value = val;
      applyLibraryDateFilter(val);
    });
  }

  if (libDateSearchInput) {
    libDateSearchInput.addEventListener('input', (e) => {
      applyLibraryDateFilter(e.target.value);
    });
  }

  if (btnClearDateFilter) {
    btnClearDateFilter.addEventListener('click', () => {
      if (libDatePicker) libDatePicker.value = '';
      if (libDateSearchInput) libDateSearchInput.value = '';
      applyLibraryDateFilter('');
    });
  }

  // 12. Local File Audio Upload (내 PC 음원 추가)
  const localAudioInput = document.getElementById('local-audio-input');
  const triggerLocalUpload = () => {
    if (localAudioInput) localAudioInput.click();
  };

  const btnAddLocalFile = document.getElementById('btn-add-local-file');
  if (btnAddLocalFile) btnAddLocalFile.addEventListener('click', triggerLocalUpload);

  const btnLibraryUpload = document.getElementById('btn-library-upload');
  if (btnLibraryUpload) btnLibraryUpload.addEventListener('click', triggerLocalUpload);

  const headerUploadBtn = document.getElementById('header-upload-btn');
  if (headerUploadBtn) headerUploadBtn.addEventListener('click', triggerLocalUpload);

  // 동적 로컬 파일 추가 버튼 클릭 위임
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-add-local-file') || e.target.closest('#btn-library-upload')) {
      triggerLocalUpload();
    }
  });

  if (localAudioInput) {
    localAudioInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      files.forEach((file, index) => {
        const fileUrl = URL.createObjectURL(file);
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const newTrack = {
          id: `local-${Date.now()}-${index}`,
          title: fileNameWithoutExt,
          artist: "내 로컬 음원",
          album: "로컬 라이브러리",
          genre: "local",
          mood: "chill",
          duration: 0,
          audioUrl: fileUrl,
          cover: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80",
          lyrics: [
            { time: 0, text: `[${file.name} 로컬 음원 재생]` }
          ],
          isLiked: true
        };

        allTracks.unshift(newTrack);
        ui.localFiles.unshift(newTrack);
        ui.likedTrackIds.add(newTrack.id);
        player.addTrackToQueue(newTrack, index === 0);
      });

      ui.updateLikesCount();
      ui.renderQuickPicks(allTracks);
      ui.showToast(`${files.length}개의 로컬 음원이 추가되어 재생됩니다.`);
      localAudioInput.value = '';
    });
  }

  // 13. Quick Picks 새로고침 & 모두 재생 버튼
  const btnRefreshQuick = document.getElementById('btn-refresh-quick-picks');
  if (btnRefreshQuick) {
    btnRefreshQuick.addEventListener('click', () => {
      updatePersonalizedQuickPicks();
      ui.showToast('청취 취향을 반영하여 빠른 선곡이 갱신되었습니다! ✨');
    });
  }

  const btnPlayAllQuick = document.getElementById('btn-play-all-quick');
  if (btnPlayAllQuick) {
    btnPlayAllQuick.addEventListener('click', () => {
      const picks = getPersonalizedQuickPicks();
      player.setQueue(picks, 0, true);
      ui.showToast('취향 맞춤 추천 곡 재생을 시작합니다.');
    });
  }

  // 14. Google Login & Music Taste DNA Modal Integration
  auth.onUserLogin = () => {
    updatePersonalizedQuickPicks();
  };
  if (typeof auth.initGoogleAuth === 'function') {
    auth.initGoogleAuth();
  }
  auth.updateUserUI();

  const btnTasteDna = document.getElementById('btn-taste-dna');
  if (btnTasteDna) {
    btnTasteDna.addEventListener('click', () => auth.openTasteModal());
  }

  // 상단 헤더 로그인 버튼 클릭 시 구글 정품 로그인 모달 열기
  const btnLoginHeader = document.getElementById('header-login-btn');
  if (btnLoginHeader) {
    btnLoginHeader.addEventListener('click', (e) => {
      e.stopPropagation();
      auth.openSignInModal();
    });
  }

  // 프로필 아바타 클릭 시 YouTube Music 정품 스타일 드롭다운 또는 계정 드로어 열기
  const userProfileWrap = document.getElementById('user-profile-wrap');
  if (userProfileWrap) {
    userProfileWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 768) {
        openAccountDrawer();
      } else {
        auth.toggleProfileDropdown();
      }
    });
  }

  // 드롭다운 외부 클릭 시 자동 닫기
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('user-profile-dropdown');
    if (dropdown && dropdown.classList.contains('open')) {
      if (!dropdown.contains(e.target) && !userProfileWrap?.contains(e.target)) {
        auth.closeProfileDropdown();
      }
    }
  });

  // 드롭다운 메뉴 아이템 이벤트
  const menuViewTaste = document.getElementById('menu-view-taste');
  if (menuViewTaste) {
    menuViewTaste.addEventListener('click', () => {
      auth.closeProfileDropdown();
      auth.openTasteModal();
    });
  }

  const menuViewHistory = document.getElementById('menu-view-history');
  if (menuViewHistory) {
    menuViewHistory.addEventListener('click', () => {
      auth.closeProfileDropdown();
      closeModal();
      ui.switchView('library');
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      const histTab = document.querySelector('.lib-tab[data-lib="history"]');
      if (histTab) histTab.classList.add('active');
      ui.renderLibrary('history');
    });
  }

  const menuViewLikes = document.getElementById('menu-view-likes');
  if (menuViewLikes) {
    menuViewLikes.addEventListener('click', () => {
      auth.closeProfileDropdown();
      closeModal();
      ui.switchView('library');
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      const likedTab = document.querySelector('.lib-tab[data-lib="likes"]');
      if (likedTab) likedTab.classList.add('active');
      ui.renderLibrary('likes');
    });
  }

  const menuLogout = document.getElementById('menu-logout');
  if (menuLogout) {
    menuLogout.addEventListener('click', () => {
      auth.logout();
      updatePersonalizedQuickPicks();
    });
  }

  // 구글 로그인 모달 닫기
  const btnCloseSigninModal = document.getElementById('btn-close-signin-modal');
  if (btnCloseSigninModal) {
    btnCloseSigninModal.addEventListener('click', () => auth.closeSignInModal());
  }

  const signinModalBackdrop = document.getElementById('signin-modal-backdrop');
  if (signinModalBackdrop) {
    signinModalBackdrop.addEventListener('click', () => auth.closeSignInModal());
  }

  // 음악 취향 DNA 모달 닫기
  const btnCloseTasteModal = document.getElementById('btn-close-taste-modal');
  if (btnCloseTasteModal) {
    btnCloseTasteModal.addEventListener('click', () => auth.closeTasteModal());
  }

  const tasteModalBackdrop = document.getElementById('taste-modal-backdrop');
  if (tasteModalBackdrop) {
    tasteModalBackdrop.addEventListener('click', () => auth.closeTasteModal());
  }

  // Google 공식 OAuth 로그인 버튼 (외부 실제 구글 로그인 창으로 이동)
  const btnGoogleOAuthLaunch = document.getElementById('btn-google-oauth-launch');
  if (btnGoogleOAuthLaunch) {
    btnGoogleOAuthLaunch.addEventListener('click', () => {
      auth.launchRealGoogleOAuth();
    });
  }

  // 게스트로 로그인 버튼
  const btnGuestLogin = document.getElementById('btn-guest-login');
  if (btnGuestLogin) {
    btnGuestLogin.addEventListener('click', () => {
      auth.loginAsGuest();
      updatePersonalizedQuickPicks();
    });
  }

  // Google OAuth Client ID 직접 설정 토글 및 저장
  const btnToggleClientIdSettings = document.getElementById('btn-toggle-client-id-settings');
  const clientIdSettingsBox = document.getElementById('client-id-settings-box');
  const inputCustomClientId = document.getElementById('input-custom-client-id');
  const btnSaveCustomClientId = document.getElementById('btn-save-custom-client-id');
  const btnResetCustomClientId = document.getElementById('btn-reset-custom-client-id');

  if (inputCustomClientId) {
    inputCustomClientId.value = auth.clientId || '';
  }

  if (btnToggleClientIdSettings && clientIdSettingsBox) {
    btnToggleClientIdSettings.addEventListener('click', () => {
      const isOpen = clientIdSettingsBox.style.display !== 'none';
      clientIdSettingsBox.style.display = isOpen ? 'none' : 'block';
      if (inputCustomClientId && !isOpen) {
        inputCustomClientId.value = auth.clientId || '';
      }
    });
  }

  if (btnSaveCustomClientId && inputCustomClientId) {
    btnSaveCustomClientId.addEventListener('click', () => {
      const newId = inputCustomClientId.value.trim();
      if (!newId) {
        ui.showToast('Client ID를 입력해주세요.');
        return;
      }
      auth.setClientId(newId);
      ui.showToast('새 Google OAuth Client ID가 적용되었습니다.');
    });
  }

  if (btnResetCustomClientId && inputCustomClientId) {
    btnResetCustomClientId.addEventListener('click', () => {
      localStorage.removeItem('streamvance_google_client_id');
      auth.clientId = DEFAULT_GOOGLE_CLIENT_ID;
      inputCustomClientId.value = auth.clientId;
      ui.showToast('Google OAuth Client ID가 기본값으로 복원되었습니다.');
    });
  }

  // Google 테이크아웃 YouTube 기록 파일 가져오기 모달
  const takeoutModal = document.getElementById('takeout-import-modal');
  const btnOpenTakeout = document.getElementById('menu-import-takeout');
  const btnCloseTakeout = document.getElementById('btn-close-takeout-modal');
  const takeoutBackdrop = document.getElementById('takeout-modal-backdrop');
  const takeoutDropzone = document.getElementById('takeout-dropzone');
  const takeoutFileInput = document.getElementById('takeout-file-input');
  const takeoutStatusMsg = document.getElementById('takeout-status-msg');

  const openTakeoutModal = () => {
    auth.closeProfileDropdown();
    if (takeoutModal) {
      takeoutModal.classList.add('open');
      if (takeoutStatusMsg) {
        takeoutStatusMsg.style.display = 'none';
        takeoutStatusMsg.textContent = '';
      }
    }
  };

  const closeTakeoutModal = () => {
    if (takeoutModal) takeoutModal.classList.remove('open');
  };

  if (btnOpenTakeout) btnOpenTakeout.addEventListener('click', openTakeoutModal);
  if (btnCloseTakeout) btnCloseTakeout.addEventListener('click', closeTakeoutModal);
  if (takeoutBackdrop) takeoutBackdrop.addEventListener('click', closeTakeoutModal);

  const handleTakeoutUpload = async (file) => {
    if (!file) return;
    if (takeoutStatusMsg) {
      takeoutStatusMsg.style.display = 'block';
      takeoutStatusMsg.style.color = '#38bdf8';
      takeoutStatusMsg.textContent = '파일을 분석 중입니다... 잠시만 기다려주세요.';
    }

    try {
      const result = await takeoutService.importFile(file);
      takeoutService.applyToApp(result, allTracks);

      if (takeoutStatusMsg) {
        takeoutStatusMsg.style.color = '#4ade80';
        takeoutStatusMsg.textContent = `성공! 총 ${result.totalCount.toLocaleString()}건의 시청기록 분석 완료!`;
      }

      // 개인 맞춤 빠른 선곡 즉각 갱신
      updatePersonalizedQuickPicks();

      setTimeout(() => {
        closeTakeoutModal();
        ui.switchView('home');
      }, 1500);
    } catch (err) {
      console.error("Takeout import error:", err);
      if (takeoutStatusMsg) {
        takeoutStatusMsg.style.color = '#f87171';
        takeoutStatusMsg.textContent = err.message || '파일 분석에 실패했습니다.';
      }
      ui.showToast('파일 분석 실패: 올바른 watch-history.json 파일을 선택해주세요.');
    }
  };

  if (takeoutDropzone && takeoutFileInput) {
    takeoutDropzone.addEventListener('click', () => takeoutFileInput.click());
    takeoutFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleTakeoutUpload(file);
    });

    takeoutDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      takeoutDropzone.style.borderColor = '#ff0055';
      takeoutDropzone.style.background = 'rgba(255, 0, 85, 0.08)';
    });

    takeoutDropzone.addEventListener('dragleave', () => {
      takeoutDropzone.style.borderColor = 'rgba(255, 0, 85, 0.4)';
      takeoutDropzone.style.background = 'rgba(255, 0, 85, 0.03)';
    });

    takeoutDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      takeoutDropzone.style.borderColor = 'rgba(255, 0, 85, 0.4)';
      takeoutDropzone.style.background = 'rgba(255, 0, 85, 0.03)';
      const file = e.dataTransfer.files?.[0];
      if (file) handleTakeoutUpload(file);
    });
  }


  // 15. 모바일 네비게이션 & 사이드바 터치 최적화 (Mobile Touch & Menu Fixes)
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-mobile-backdrop');

  const toggleMobileSidebar = (forceState) => {
    if (!sidebar) return;
    const shouldOpen = (typeof forceState === 'boolean') ? forceState : !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', shouldOpen);
    if (sidebarBackdrop) sidebarBackdrop.classList.toggle('active', shouldOpen);
  };

  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', () => toggleMobileSidebar(false));
  }

  // 모바일 사이드바 내 PC 기능 바로가기 이벤트 바인딩
  document.getElementById('sidebar-brand-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    ui.switchView('home');
    toggleMobileSidebar(false);
  });

  document.getElementById('sidebar-menu-taste')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    auth.openTasteModal();
  });

  document.getElementById('sidebar-menu-takeout')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    openTakeoutModal();
  });

  document.getElementById('sidebar-menu-history')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    closeModal();
    ui.switchView('library');
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
    const histTab = document.querySelector('.lib-tab[data-lib="history"]');
    if (histTab) histTab.classList.add('active');
    ui.renderLibrary('history');
  });

  document.getElementById('sidebar-menu-likes')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    closeModal();
    ui.switchView('library');
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
    const likedTab = document.querySelector('.lib-tab[data-lib="likes"]');
    if (likedTab) likedTab.classList.add('active');
    ui.renderLibrary('likes');
  });

  document.getElementById('sidebar-menu-upload')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    document.getElementById('local-audio-input')?.click();
  });

  document.getElementById('sidebar-menu-cast')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    document.getElementById('btn-cast-device')?.click();
  });

  document.getElementById('sidebar-login-btn')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    auth.openSignInModal();
  });

  document.getElementById('sidebar-logout-btn')?.addEventListener('click', () => {
    toggleMobileSidebar(false);
    auth.logout();
  });

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileSidebar();
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => toggleMobileSidebar(false));
    sidebarBackdrop.addEventListener('touchend', (e) => {
      e.preventDefault();
      toggleMobileSidebar(false);
    });
  }

  // 모바일 하단 플레이어 바 탭 시 전체화면 플레이어 모달 열기 (버튼 클릭 제외)
  const playerBarEl = document.getElementById('player-bar');
  if (playerBarEl) {
    playerBarEl.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        if (e.target.closest('button') || e.target.closest('input')) return;
        openModal();
      }
    });
  }

  // 모바일 하단 탭 바 터치 및 클릭 이벤트
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    const handleMobileNav = (e) => {
      e.stopPropagation();
      const targetNav = item.getAttribute('data-nav');
      if (targetNav) {
        ui.switchView(targetNav);
        toggleMobileSidebar(false);
        if (targetNav === 'library') {
          ui.renderLibrary('likes', allTracks);
        }
      }
    };
    item.addEventListener('click', handleMobileNav);
    item.addEventListener('touchend', (e) => {
      e.preventDefault();
      handleMobileNav(e);
    });
  });

  // 사이드바 내 네비게이션 버튼 클릭 시 모바일이면 사이드바 닫기
  document.querySelectorAll('.sidebar-nav .nav-item, .playlist-item').forEach(el => {
    el.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        toggleMobileSidebar(false);
      }
    });
  });

  // 15. Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // 검색 인풋 등에 포커스가 있을 때는 단축키 무시
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        player.togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        player.seekRelative(5);
        ui.showToast('+5초 이동');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        player.seekRelative(-5);
        ui.showToast('-5초 이동');
        break;
      case 'ArrowUp':
        e.preventDefault();
        player.setVolume(player.volume + 0.05);
        break;
      case 'ArrowDown':
        e.preventDefault();
        player.setVolume(player.volume - 0.05);
        break;
      case 'KeyM':
        player.toggleMute();
        break;
      case 'KeyL':
        ui.toggleLike(player.getCurrentTrack());
        break;
      case 'KeyJ':
        player.prevTrack();
        break;
      case 'KeyK':
        player.togglePlayPause();
        break;
      case 'KeyN':
        player.nextTrack();
        break;
      case 'Escape':
        closeModal();
        break;
    }
  });

  // 16. 모바일 Pull-to-Refresh 당겨서 새로고침 연동 (YouTube Music 실시간 피드 갱신)
  ui.initPullToRefresh(async () => {
    updatePersonalizedQuickPicks();
    if (ui.currentView === 'home') {
      try {
        await loadLiveTopCharts(currentChartCountry);
      } catch (e) {}
    } else if (ui.currentView === 'library') {
      ui.renderLibrary(ui.currentLibTab || 'playlists');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // 17. 삼성인터넷 모바일 백그라운드 재생 가이드 모달 바인딩
  const bgGuideModal = document.getElementById('bg-guide-modal');
  const btnCloseBgGuide = document.getElementById('btn-close-bg-guide');
  const btnBgGuideConfirm = document.getElementById('btn-bg-guide-confirm');
  const bgGuideBackdrop = document.getElementById('bg-guide-backdrop');
  const btnBgGuideTestPip = document.getElementById('btn-bg-guide-test-pip');
  const sheetActBgGuide = document.getElementById('sheet-act-bg-guide');
  const accountItemBgGuide = document.getElementById('account-item-bg-guide');

  const openBgGuideModal = () => {
    if (bgGuideModal) {
      bgGuideModal.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    }
  };

  const closeBgGuideModal = () => {
    if (bgGuideModal) {
      bgGuideModal.style.display = 'none';
    }
  };

  if (btnCloseBgGuide) btnCloseBgGuide.addEventListener('click', closeBgGuideModal);
  if (btnBgGuideConfirm) btnBgGuideConfirm.addEventListener('click', closeBgGuideModal);
  if (bgGuideBackdrop) bgGuideBackdrop.addEventListener('click', closeBgGuideModal);

  if (sheetActBgGuide) {
    sheetActBgGuide.addEventListener('click', () => {
      ui.closeTrackMoreSheet();
      openBgGuideModal();
    });
  }

  if (accountItemBgGuide) {
    accountItemBgGuide.addEventListener('click', () => {
      const accountDrawer = document.getElementById('account-drawer-overlay');
      if (accountDrawer) accountDrawer.classList.remove('active');
      openBgGuideModal();
    });
  }

  if (btnBgGuideTestPip) {
    btnBgGuideTestPip.addEventListener('click', async () => {
      closeBgGuideModal();
      await pipManager.togglePiP();
    });
  }



  // Lucide Icons 초기 렌더링
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// DOMContentLoaded가 이미 완료된 환경(Cloudflare Pages CDN 등)에서도 즉각 앱 초기화 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

