// ==========================================================================
// Main Application Entry Point
// ==========================================================================

import { sampleTracks, sampleAlbums, genresData } from './data.js';
import { AudioPlayer } from './audioPlayer.js';
import { UIManager } from './ui.js';
import { YouTubeSearchService } from './searchService.js';
import { AuthManager } from './auth.js';
import { LyricsService } from './lyricsService.js';
import { ColorExtractor } from './colorExtractor.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Core Engine & UI
  const audioElement = document.getElementById('main-audio');
  const player = new AudioPlayer(audioElement);
  const ui = new UIManager(player);
  const auth = new AuthManager(ui, player);
  const lyricsService = new LyricsService();
  const colorExtractor = new ColorExtractor();

  let allTracks = [...sampleTracks];
  let currentMood = 'all';
  auth.setAllTracks(allTracks);

  // 2. Setup Audio Player Callbacks
  player.callbacks.onTrackChange = (track, index) => {
    ui.updateCurrentTrackUI(track);
    ui.renderRelated(track, allTracks);
    ui.renderQueue(player.queue, player.currentIndex);

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

    // 실시간 정밀 싱크 가사 자동 로딩 (LRCLIB 글로벌 가사 DB 및 유튜브 싱크 가사)
    ui.setLyricsLoading();
    lyricsService.getLyrics(track).then(liveLyrics => {
      const current = player.getCurrentTrack();
      if (current && (current.id === track.id || current.videoId === track.videoId)) {
        current.lyrics = liveLyrics;
        ui.renderLyrics(liveLyrics, current.lyricsOffset);
      }
    }).catch(err => {
      console.warn("Lyrics fetch error:", err);
    });

    // 재생 히스토리 반영하여 빠른 선곡 실시간 갱신
    updatePersonalizedQuickPicks();

    // 다음 대기열이 얼마 안 남았으면 유사 음악 자동 큐잉
    if (player.queue.length - player.currentIndex <= 2) {
      autoQueueSimilarTracks(track);
    }
  };

  player.callbacks.onQueueNearEnd = () => {
    const cur = player.getCurrentTrack();
    if (cur) autoQueueSimilarTracks(cur);
  };

  player.callbacks.onPlayStateChange = (isPlaying) => {
    ui.updatePlayStateUI(isPlaying);

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
  // 실시간 사용자 취향 기반 빠른 선곡 (Dynamic Taste-based Quick Picks)
  // ==========================================================================
  function getPersonalizedQuickPicks() {
    // 1) 후보 풀: allTracks + playHistory + likedTracksMap 합치기 (최신 재생 곡이 반드시 포함되도록)
    const poolMap = new Map();
    allTracks.forEach(t => poolMap.set(t.id, t));
    ui.playHistory.forEach(t => poolMap.set(t.id, t));
    ui.likedTracksMap.forEach(t => poolMap.set(t.id, t));
    const candidatePool = Array.from(poolMap.values());

    const taste = auth.analyzeUserTaste(candidatePool);
    const topGenres = new Set(taste.genres.slice(0, 3).map(g => g.genre));
    const topArtists = new Set(taste.artists.map(a => a.artist.toLowerCase()));

    // 최근 재생한 아티스트 목록 (가장 최근 들은 아티스트에 최고 가중치 부여)
    const recentPlayedArtists = new Set(ui.playHistory.slice(0, 5).map(t => (t.artist || '').toLowerCase()));

    // 개인 맞춤 스코어링
    const scored = candidatePool.map((track, idx) => {
      let score = 0;
      const tArtist = (track.artist || '').toLowerCase();
      
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

  // 유사 트랙 자동 큐잉 (스마트 오토플레이 라디오)
  function autoQueueSimilarTracks(currentTrack) {
    if (!currentTrack) return;
    const curArtist = (currentTrack.artist || '').toLowerCase();
    const curGenre = currentTrack.genre || 'pop';
    const curMood = currentTrack.mood || 'energy';

    const queueVideoIds = new Set(player.queue.map(t => t.videoId).filter(Boolean));
    const candidates = allTracks.filter(t => !queueVideoIds.has(t.videoId));

    const scored = candidates.map(t => {
      let score = 0;
      if (curArtist && (t.artist || '').toLowerCase().includes(curArtist)) score += 30;
      if (t.genre === curGenre) score += 20;
      if (t.mood === curMood) score += 15;
      score += Math.random() * 5;
      return { track: t, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const similar = scored.slice(0, 5).map(s => s.track);
    if (similar.length > 0) {
      similar.forEach(t => player.queue.push(t));
      ui.renderQueue(player.queue, player.currentIndex);
    }
  }

  // ==========================================================================
  // 아티스트 스포트라이트 (< > 아티스트 및 곡 전환 기능)
  // ==========================================================================
  const SPOTLIGHT_ARTISTS = [
    { name: "NewJeans", query: "NewJeans", image: "https://i.ytimg.com/vi/9wUKhEgnllc/hqdefault.jpg" },
    { name: "아이유 (IU)", query: "아이유", image: "https://i.ytimg.com/vi/0-q1K8530JF/hqdefault.jpg" },
    { name: "LE SSERAFIM", query: "LE SSERAFIM", image: "https://i.ytimg.com/vi/f0FDOw3zvGo/hqdefault.jpg" },
    { name: "IVE (아이브)", query: "IVE", image: "https://i.ytimg.com/vi/pXbugSyo0tI/hqdefault.jpg" },
    { name: "aespa (에스파)", query: "aespa", image: "https://i.ytimg.com/vi/phuiAIQAxZ4/hqdefault.jpg" },
    { name: "ROSÉ", query: "ROSÉ", image: "https://i.ytimg.com/vi/ekr2nIex040/hqdefault.jpg" },
    { name: "성시경", query: "성시경", image: "https://i.ytimg.com/vi/3_nnLq4D3tc/hqdefault.jpg" },
    { name: "지코 (ZICO)", query: "지코", image: "https://i.ytimg.com/vi/azaZt7eccnc/hqdefault.jpg" }
  ];

  // 각 아티스트별 정품 대표곡 컬렉션 (특정 아티스트 선택 시 오직 그 아티스트의 노래만 0ms 즉각 표시)
  const SPOTLIGHT_ARTIST_TRACKS = {
    "NewJeans": [
      { id: "yt-pSUydWEq424", videoId: "pSUydWEq424", title: "Ditto", artist: "NewJeans", album: "NewJeans 'OMG'", genre: "k-pop", mood: "calm", duration: 186, cover: "https://i.ytimg.com/vi/pSUydWEq424/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-11cta61Wi0g", videoId: "11cta61Wi0g", title: "Hype Boy", artist: "NewJeans", album: "1st EP 'New Jeans'", genre: "k-pop", mood: "upbeat", duration: 179, cover: "https://i.ytimg.com/vi/11cta61Wi0g/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-ArmDp-zijuc", videoId: "ArmDp-zijuc", title: "Super Shy", artist: "NewJeans", album: "Get Up", genre: "k-pop", mood: "upbeat", duration: 154, cover: "https://i.ytimg.com/vi/ArmDp-zijuc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-sVTy_wmn5SU", videoId: "sVTy_wmn5SU", title: "OMG", artist: "NewJeans", album: "NewJeans 'OMG'", genre: "k-pop", mood: "chill", duration: 213, cover: "https://i.ytimg.com/vi/sVTy_wmn5SU/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Q3K0TOvTOno", videoId: "Q3K0TOvTOno", title: "How Sweet", artist: "NewJeans", album: "How Sweet", genre: "k-pop", mood: "chill", duration: 219, cover: "https://i.ytimg.com/vi/Q3K0TOvTOno/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-jOTfBlKSQPE", videoId: "jOTfBlKSQPE", title: "ETA", artist: "NewJeans", album: "Get Up", genre: "k-pop", mood: "upbeat", duration: 151, cover: "https://i.ytimg.com/vi/jOTfBlKSQPE/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-js1CtxSY38I", videoId: "js1CtxSY38I", title: "Attention", artist: "NewJeans", album: "1st EP 'New Jeans'", genre: "k-pop", mood: "chill", duration: 180, cover: "https://i.ytimg.com/vi/js1CtxSY38I/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "아이유 (IU)": [
      { id: "yt-0-q1K8530JF", videoId: "0-q1K8530JF", title: "Love wins all", artist: "아이유 (IU)", album: "The Winning", genre: "ballad", mood: "focus", duration: 271, cover: "https://i.ytimg.com/vi/0-q1K8530JF/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-BzYnNdJhZQw", videoId: "BzYnNdJhZQw", title: "밤편지 (Through the Night)", artist: "아이유 (IU)", album: "Palette", genre: "acoustic", mood: "calm", duration: 253, cover: "https://i.ytimg.com/vi/BzYnNdJhZQw/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-TgOu00Mf3kI", videoId: "TgOu00Mf3kI", title: "에잇 (eight feat. SUGA)", artist: "아이유 (IU)", album: "에잇", genre: "pop", mood: "upbeat", duration: 167, cover: "https://i.ytimg.com/vi/TgOu00Mf3kI/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-v7bnOxV4jAc", videoId: "v7bnOxV4jAc", title: "라일락 (LILAC)", artist: "아이유 (IU)", album: "IU 5th Album 'LILAC'", genre: "pop", mood: "upbeat", duration: 215, cover: "https://i.ytimg.com/vi/v7bnOxV4jAc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-sqgxcCjD04s", videoId: "sqgxcCjD04s", title: "strawberry moon", artist: "아이유 (IU)", album: "strawberry moon", genre: "pop", mood: "chill", duration: 205, cover: "https://i.ytimg.com/vi/sqgxcCjD04s/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-4L-H_PXG31I", videoId: "4L-H_PXG31I", title: "너의 의미 (Meaning of you)", artist: "아이유 (IU)", album: "꽃갈피", genre: "acoustic", mood: "chill", duration: 195, cover: "https://i.ytimg.com/vi/4L-H_PXG31I/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "LE SSERAFIM": [
      { id: "yt-hLvWy2b857I", videoId: "hLvWy2b857I", title: "Perfect Night", artist: "LE SSERAFIM", album: "Perfect Night", genre: "k-pop", mood: "chill", duration: 159, cover: "https://i.ytimg.com/vi/hLvWy2b857I/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-bNKXxwOQ48E", videoId: "bNKXxwOQ48E", title: "EASY", artist: "LE SSERAFIM", album: "EASY", genre: "k-pop", mood: "chill", duration: 165, cover: "https://i.ytimg.com/vi/bNKXxwOQ48E/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-KNexS61PCck", videoId: "KNexS61PCck", title: "Smart", artist: "LE SSERAFIM", album: "EASY", genre: "k-pop", mood: "upbeat", duration: 166, cover: "https://i.ytimg.com/vi/KNexS61PCck/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-pyf8hSgk6SU", videoId: "pyf8hSgk6SU", title: "ANTIFRAGILE", artist: "LE SSERAFIM", album: "ANTIFRAGILE", genre: "k-pop", mood: "workout", duration: 184, cover: "https://i.ytimg.com/vi/pyf8hSgk6SU/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-8qVzU4-8iR4", videoId: "8qVzU4-8iR4", title: "CRAZY", artist: "LE SSERAFIM", album: "CRAZY", genre: "k-pop", mood: "workout", duration: 164, cover: "https://i.ytimg.com/vi/8qVzU4-8iR4/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-UBURTj20HXI", videoId: "UBURTj20HXI", title: "UNFORGIVEN (feat. Nile Rodgers)", artist: "LE SSERAFIM", album: "UNFORGIVEN", genre: "k-pop", mood: "workout", duration: 182, cover: "https://i.ytimg.com/vi/UBURTj20HXI/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "IVE (아이브)": [
      { id: "yt-6ZUIwj3FgUY", videoId: "6ZUIwj3FgUY", title: "I AM", artist: "IVE (아이브)", album: "I've IVE", genre: "k-pop", mood: "upbeat", duration: 184, cover: "https://i.ytimg.com/vi/6ZUIwj3FgUY/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Y8JFxS1HlDo", videoId: "Y8JFxS1HlDo", title: "LOVE DIVE", artist: "IVE (아이브)", album: "LOVE DIVE", genre: "k-pop", mood: "chill", duration: 177, cover: "https://i.ytimg.com/vi/Y8JFxS1HlDo/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-F0B7HFeZOkE", videoId: "F0B7HFeZOkE", title: "After LIKE", artist: "IVE (아이브)", album: "After LIKE", genre: "k-pop", mood: "upbeat", duration: 177, cover: "https://i.ytimg.com/vi/F0B7HFeZOkE/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Da4P2uT4mVc", videoId: "Da4P2uT4mVc", title: "Baddie", artist: "IVE (아이브)", album: "I'VE MINE", genre: "k-pop", mood: "chill", duration: 154, cover: "https://i.ytimg.com/vi/Da4P2uT4mVc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-7H_qE1y6Tzg", videoId: "7H_qE1y6Tzg", title: "HEYA (해야)", artist: "IVE (아이브)", album: "IVE SWITCH", genre: "k-pop", mood: "upbeat", duration: 190, cover: "https://i.ytimg.com/vi/7H_qE1y6Tzg/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "--FmExEAs30", videoId: "--FmExEAs30", title: "ELEVEN", artist: "IVE (아이브)", album: "ELEVEN", genre: "k-pop", mood: "upbeat", duration: 178, cover: "https://i.ytimg.com/vi/--FmExEAs30/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "aespa (에스파)": [
      { id: "yt-phuiAIQAxZ4", videoId: "phuiAIQAxZ4", title: "Supernova", artist: "aespa (에스파)", album: "Armageddon", genre: "k-pop", mood: "workout", duration: 178, cover: "https://i.ytimg.com/vi/phuiAIQAxZ4/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-jWQx2f-CErU", videoId: "jWQx2f-CErU", title: "Whiplash", artist: "aespa (에스파)", album: "Whiplash", genre: "k-pop", mood: "workout", duration: 184, cover: "https://i.ytimg.com/vi/jWQx2f-CErU/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-nFYwcndNuOY", videoId: "nFYwcndNuOY", title: "Armageddon", artist: "aespa (에스파)", album: "Armageddon", genre: "k-pop", mood: "workout", duration: 196, cover: "https://i.ytimg.com/vi/nFYwcndNuOY/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-4TWR90KJl84", videoId: "4TWR90KJl84", title: "Next Level", artist: "aespa (에스파)", album: "Next Level", genre: "k-pop", mood: "upbeat", duration: 221, cover: "https://i.ytimg.com/vi/4TWR90KJl84/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-D8VEhcPeSlc", videoId: "D8VEhcPeSlc", title: "Drama", artist: "aespa (에스파)", album: "Drama", genre: "k-pop", mood: "workout", duration: 214, cover: "https://i.ytimg.com/vi/D8VEhcPeSlc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Os_heh8vPfs", videoId: "Os_heh8vPfs", title: "Spicy", artist: "aespa (에스파)", album: "MY WORLD", genre: "k-pop", mood: "upbeat", duration: 197, cover: "https://i.ytimg.com/vi/Os_heh8vPfs/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "ROSÉ": [
      { id: "yt-ekr2nIex040", videoId: "ekr2nIex040", title: "APT. (with Bruno Mars)", artist: "ROSÉ & Bruno Mars", album: "rosie", genre: "pop", mood: "party", duration: 170, cover: "https://i.ytimg.com/vi/ekr2nIex040/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-CKZvWhCqxSM", videoId: "CKZvWhCqxSM", title: "On The Ground", artist: "ROSÉ", album: "-R-", genre: "pop", mood: "focus", duration: 168, cover: "https://i.ytimg.com/vi/CKZvWhCqxSM/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-K9_VFxzCuQ0", videoId: "K9_VFxzCuQ0", title: "Gone", artist: "ROSÉ", album: "-R-", genre: "ballad", mood: "calm", duration: 207, cover: "https://i.ytimg.com/vi/K9_VFxzCuQ0/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-L72m57K9_3w", videoId: "L72m57K9_3w", title: "number one girl", artist: "ROSÉ", album: "rosie", genre: "pop", mood: "chill", duration: 219, cover: "https://i.ytimg.com/vi/L72m57K9_3w/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-K9t8XgO_7d4", videoId: "K9t8XgO_7d4", title: "toxic till the end", artist: "ROSÉ", album: "rosie", genre: "pop", mood: "chill", duration: 157, cover: "https://i.ytimg.com/vi/K9t8XgO_7d4/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "성시경": [
      { id: "yt-3_nnLq4D3tc", videoId: "3_nnLq4D3tc", title: "너의 모든 순간", artist: "성시경", album: "별에서 온 그대 OST", genre: "ballad", mood: "focus", duration: 242, cover: "https://i.ytimg.com/vi/3_nnLq4D3tc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-eZ0d72M7kO0", videoId: "eZ0d72M7kO0", title: "거리에서", artist: "성시경", album: "The Ballads", genre: "ballad", mood: "calm", duration: 279, cover: "https://i.ytimg.com/vi/eZ0d72M7kO0/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Q9rOQ2xYfB8", videoId: "Q9rOQ2xYfB8", title: "희재", artist: "성시경", album: "국화꽃 향기 OST", genre: "ballad", mood: "calm", duration: 275, cover: "https://i.ytimg.com/vi/Q9rOQ2xYfB8/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-V9u_j6kU7tU", videoId: "V9u_j6kU7tU", title: "두 사람", artist: "성시경", album: "다시 꿈꾸고 싶다", genre: "ballad", mood: "calm", duration: 255, cover: "https://i.ytimg.com/vi/V9u_j6kU7tU/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-o_FvK7W4mH8", videoId: "o_FvK7W4mH8", title: "좋을텐데", artist: "성시경", album: "Melodie D' Amour", genre: "ballad", mood: "chill", duration: 236, cover: "https://i.ytimg.com/vi/o_FvK7W4mH8/hqdefault.jpg", lyrics: [], isLiked: false }
    ],
    "지코 (ZICO)": [
      { id: "yt-azaZt7eccnc", videoId: "azaZt7eccnc", title: "SPOT! (feat. JENNIE)", artist: "지코 (ZICO)", album: "SPOT!", genre: "hip-hop", mood: "party", duration: 168, cover: "https://i.ytimg.com/vi/azaZt7eccnc/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-UuV2BmJ1n_I", videoId: "UuV2BmJ1n_I", title: "아무노래 (Any song)", artist: "지코 (ZICO)", album: "아무노래", genre: "hip-hop", mood: "party", duration: 227, cover: "https://i.ytimg.com/vi/UuV2BmJ1n_I/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-Hl3_x7M50x4", videoId: "Hl3_x7M50x4", title: "새삥 (New thing feat. 호미들)", artist: "지코 (ZICO)", album: "스트릿 맨 파이터 OST", genre: "hip-hop", mood: "workout", duration: 147, cover: "https://i.ytimg.com/vi/Hl3_x7M50x4/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-obzb3KQI0sU", videoId: "obzb3KQI0sU", title: "Artist", artist: "지코 (ZICO)", album: "Television", genre: "hip-hop", mood: "party", duration: 202, cover: "https://i.ytimg.com/vi/obzb3KQI0sU/hqdefault.jpg", lyrics: [], isLiked: false },
      { id: "yt-6zS39L3lZ98", videoId: "6zS39L3lZ98", title: "너는 나 나는 너", artist: "지코 (ZICO)", album: "Break Up 2 Make Up", genre: "r-b", mood: "chill", duration: 217, cover: "https://i.ytimg.com/vi/6zS39L3lZ98/hqdefault.jpg", lyrics: [], isLiked: false }
    ]
  };

  // 모든 아티스트 사전 대표곡을 전역 allTracks 풀에 등록
  Object.values(SPOTLIGHT_ARTIST_TRACKS).forEach(trackList => {
    trackList.forEach(t => {
      if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
        allTracks.push(t);
      }
    });
  });

  let currentSpotlightIndex = 0;

  // 아티스트 전환 함수: 0ms 즉각 반응 & 오직 선택된 아티스트 노래만 필터링 (사용자 요청 2, 3, 6번)
  function switchSpotlightArtist(index) {
    if (index < 0 || index >= SPOTLIGHT_ARTISTS.length) return;
    currentSpotlightIndex = index;
    const artist = SPOTLIGHT_ARTISTS[index];

    // 헤더 업데이트
    const spotlightTitle = document.getElementById('spotlight-artist-name');
    const spotlightImg = document.getElementById('spotlight-artist-img');
    if (spotlightTitle) spotlightTitle.textContent = artist.name;
    if (spotlightImg && artist.image) spotlightImg.src = artist.image;

    // 1) 사전 준비된 해당 아티스트 고유 트랙 확보
    let artistTracks = SPOTLIGHT_ARTIST_TRACKS[artist.name] || [];

    // 2) 전역 allTracks 중 해당 아티스트 일치 곡 추가 필터링
    const qLower = (artist.query || artist.name).toLowerCase();
    const extraTracks = allTracks.filter(t => {
      const art = (t.artist || '').toLowerCase();
      return art.includes(qLower) || (artist.name.toLowerCase().includes(art) && art.length >= 2);
    });

    extraTracks.forEach(et => {
      if (!artistTracks.find(at => at.id === et.id || at.videoId === et.videoId)) {
        artistTracks.push(et);
      }
    });

    // 3) 0ms 즉시 화면 렌더링 (지연 제로!)
    ui.renderSpotlight(artistTracks);
    ui.renderSpotlightChips(SPOTLIGHT_ARTISTS, currentSpotlightIndex, (newIdx) => {
      switchSpotlightArtist(newIdx);
    });

    // 4) 스크롤 맨 앞으로 리셋
    const spotlightList = document.getElementById('spotlight-tracks-list');
    if (spotlightList) spotlightList.scrollTo({ left: 0, behavior: 'auto' });

    // 5) 백그라운드 프리패치 (현재 보고 있는 아티스트가 유지될 때만 비동기 보강)
    if (artistTracks.length < 6) {
      searchService.searchOnline(`${artist.query || artist.name} 노래`).then(searchRes => {
        if (currentSpotlightIndex !== index) return; // 이미 다른 아티스트로 전환되었으면 무시
        const onlineTracks = Array.isArray(searchRes) ? searchRes : (searchRes.tracks || searchRes.songs || []);
        let added = false;
        onlineTracks.forEach(ot => {
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
          ui.renderSpotlight(artistTracks);
        }
      }).catch(() => {});
    }
  }

  // ==========================================================================
  // 실시간 YouTube TOP 차트 로딩 (/api/charts)
  // ==========================================================================
  async function loadLiveTopCharts() {
    try {
      const res = await fetch('/api/charts');
      if (res.ok) {
        const chartTracks = await res.json();
        if (Array.isArray(chartTracks) && chartTracks.length > 0) {
          chartTracks.forEach(ct => {
            if (!allTracks.find(t => t.id === ct.id || t.videoId === ct.videoId)) {
              allTracks.push(ct);
            }
          });
          ui.renderTopCharts(chartTracks);
          if (window.lucide) window.lucide.createIcons();
          return;
        }
      }
    } catch (e) {
      console.warn("Live charts fetch failed, fallback to default:", e);
    }
    ui.renderTopCharts(allTracks);
  }

  // 3. Initial Queue & Data Setup
  player.setQueue(allTracks, 0, false);
  ui.updateLikesCount();

  // 4. Initial Views Render
  updatePersonalizedQuickPicks();
  ui.renderRecommendedAlbums(sampleAlbums, allTracks);
  switchSpotlightArtist(0);
  loadLiveTopCharts();
  ui.renderGenres(genresData);
  ui.renderQueue(player.queue, 0);

  // 5. Navigation Tab Switching (Top Header Tabs & Mobile - 스크린샷 기능 일치)
  document.querySelectorAll('[data-nav], .ytm-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const navTarget = btn.getAttribute('data-nav');
      if (navTarget) {
        closeModal();
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

  // 캐스트 버튼
  const btnCastDevice = document.getElementById('btn-cast-device');
  if (btnCastDevice) {
    btnCastDevice.addEventListener('click', () => {
      if (player.audio && player.audio.remote && typeof player.audio.remote.prompt === 'function') {
        player.audio.remote.prompt().catch(() => {
          ui.showToast('사용 가능한 Cast / Bluetooth 기기를 찾는 중입니다...');
        });
      } else {
        ui.showToast('기기 연결: 브라우저 메뉴 또는 전송 기능을 통해 오디오 기기를 연결할 수 있습니다.');
      }
    });
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

      // 무드별 온라인 추천곡 확보
      const moodKeywords = {
        sleep: '수면 음악 로파이 lofi sleep',
        chill: '휴식 편안한 음악 chill beats',
        energy: '에너지 충전 신나는 케이팝 dance',
        happy: '기분 좋은 드라이브 팝송',
        workout: '운동 런닝 헬스 rock workout',
        focus: '공부 집중 로파이 focus study',
        commute: '출퇴근길 음악',
        ballad: '감성 발라드 명곡'
      };

      if (currentMood !== 'all' && moodKeywords[currentMood]) {
        try {
          const res = await searchService.searchOnline(moodKeywords[currentMood]);
          const moodTracks = Array.isArray(res) ? res : (res.tracks || res.songs || []);
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
      // 액션 버튼(좋아요, 큐 추가, 삭제) 클릭인 경우
      const actionBtn = e.target.closest('button');
      const trackId = trackCard.getAttribute('data-track-id');
      const queueIndex = trackCard.getAttribute('data-queue-index');

      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        if (action === 'like') {
          e.stopPropagation();
          const target = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
          if (target) {
            ui.toggleLike(target);
            updatePersonalizedQuickPicks();
          }
          return;
        } else if (action === 'queue') {
          e.stopPropagation();
          const target = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
          if (target) {
            player.addTrackToQueue(target);
            ui.showToast(`'${target.title}' 대기열에 추가되었습니다.`);
          }
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

      // 일반 트랙 클릭 시
      if (trackId) {
        const targetIndex = player.queue.findIndex(t => t.id === trackId);
        if (targetIndex >= 0) {
          player.playTrackAtIndex(targetIndex);
        } else {
          const targetTrack = allTracks.find(t => t.id === trackId) || ui.likedTracksMap.get(trackId) || ui.playHistory.find(t => t.id === trackId);
          if (targetTrack) {
            player.addTrackToQueue(targetTrack, true);
          }
        }
      }
    }

    // 실시간 TOP 차트 아이템 클릭 처리
    const chartItem = e.target.closest('.chart-item');
    if (chartItem) {
      const trackId = chartItem.getAttribute('data-track-id');
      if (trackId) {
        const targetIndex = player.queue.findIndex(t => t.id === trackId);
        if (targetIndex >= 0) {
          player.playTrackAtIndex(targetIndex);
        } else {
          const targetTrack = allTracks.find(t => t.id === trackId);
          if (targetTrack) {
            player.addTrackToQueue(targetTrack, true);
          }
        }
      }
      return;
    }

    // 앨범 카드 / 스포트라이트 카드 클릭
    const albumCard = e.target.closest('.music-card');
    if (albumCard) {
      const trackId = albumCard.getAttribute('data-track-id');
      if (trackId) {
        const targetIndex = player.queue.findIndex(t => t.id === trackId);
        if (targetIndex >= 0) {
          player.playTrackAtIndex(targetIndex);
        } else {
          const targetTrack = allTracks.find(t => t.id === trackId);
          if (targetTrack) {
            player.addTrackToQueue(targetTrack, true);
          }
        }
        return;
      }

      const albumId = albumCard.getAttribute('data-album-id');
      const album = sampleAlbums.find(a => a.id === albumId);
      if (album) {
        const albumTracks = allTracks.filter(t => album.trackIds.includes(t.id));
        if (albumTracks.length > 0) {
          player.setQueue(albumTracks, 0, true);
          ui.showToast(`앨범 '${album.title}' 재생 시작`);
        }
      }
      return;
    }

    // 둘러보기 히어로 배너 재생 버튼
    if (e.target.closest('#btn-hero-play')) {
      const track = allTracks[0];
      if (track) {
        player.setQueue([track, ...allTracks.slice(1)], 0, true);
        ui.showToast(`'${track.title}' 재생 시작`);
      }
    }

    // 둘러보기 장르 카드 클릭 시 홈으로 튕기지 않고 전용 추천 패널 열기
    const genreCard = e.target.closest('.genre-card');
    if (genreCard) {
      const mood = genreCard.getAttribute('data-genre-mood');
      openGenreDetail(mood);
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

  // 둘러보기 전용 장르 상세 열기 함수
  let currentGenreTracks = [];
  async function openGenreDetail(mood) {
    const genre = genresData.find(g => g.mood === mood) || { name: mood, color: '#ef4444', mood };
    let genreTracks = allTracks.filter(t => t.genre === mood || t.mood === mood);
    
    // 곡 수가 적으면 온라인 검색으로 해당 장르 명곡 실시간 확보
    if (genreTracks.length < 5) {
      try {
        const searchRes = await searchService.searchOnline(`${genre.name} 명곡 노래`);
        const newTracks = Array.isArray(searchRes) ? searchRes : (searchRes.tracks || searchRes.songs || []);
        newTracks.forEach(t => {
          t.genre = mood;
          t.mood = mood;
          if (!allTracks.find(item => item.id === t.id || item.videoId === t.videoId)) {
            allTracks.push(t);
          }
        });
        genreTracks = allTracks.filter(t => t.genre === mood || t.mood === mood);
      } catch (e) {}
    }
    
    currentGenreTracks = genreTracks;
    ui.renderGenreDetail(genre.name, genre.color, genreTracks);
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

  const switchMediaMode = (mode) => {
    currentMediaMode = mode;
    const btnSong = document.getElementById('btn-mode-song');
    const btnVideo = document.getElementById('btn-mode-video');
    const albumArtWrap = document.getElementById('modal-album-art-wrap');
    const videoWrap = document.getElementById('modal-video-wrap');

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
    } else {
      btnSong?.classList.add('active');
      btnVideo?.classList.remove('active');
      albumArtWrap?.classList.remove('hidden');
      videoWrap?.classList.remove('active');
    }
  };

  const btnModeSong = document.getElementById('btn-mode-song');
  if (btnModeSong) btnModeSong.addEventListener('click', () => switchMediaMode('song'));

  const btnModeVideo = document.getElementById('btn-mode-video');
  if (btnModeVideo) btnModeVideo.addEventListener('click', () => switchMediaMode('video'));

  function openModal() {
    ui.dom.fullModal.classList.add('open');
    document.body.classList.add('player-modal-open');
    if (window.lucide) window.lucide.createIcons();
    const isTheater = ui.dom.fullModal.classList.contains('modal-theater-mode');
    if (ui.dom.btnVideoTheater) {
      ui.dom.btnVideoTheater.classList.toggle('active', isTheater);
      const expandIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-expand');
      const shrinkIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-shrink');
      if (expandIcon) expandIcon.style.display = isTheater ? 'none' : 'block';
      if (shrinkIcon) shrinkIcon.style.display = isTheater ? 'block' : 'none';
    }
    const activeTab = document.querySelector('.modal-tab.active');
    if (!activeTab) {
      document.querySelector('.modal-tab[data-tab="up-next"]')?.click();
    }
  }
  function closeModal() {
    ui.dom.fullModal.classList.remove('open');
    document.body.classList.remove('player-modal-open');
  }

  const btnExpandPlayer = document.getElementById('btn-expand-player');
  if (btnExpandPlayer) btnExpandPlayer.addEventListener('click', openModal);

  const playerTrackInfo = document.getElementById('player-track-info');
  if (playerTrackInfo) {
    playerTrackInfo.addEventListener('click', (e) => {
      if (e.target.closest('#btn-like-track') || e.target.closest('#btn-thumb-down')) return;
      openModal();
    });
  }

  const btnCloseFullPlayer = document.getElementById('btn-close-full-player');
  if (btnCloseFullPlayer) btnCloseFullPlayer.addEventListener('click', closeModal);

  const btnOpenQueue = document.getElementById('btn-open-queue');
  if (btnOpenQueue) {
    btnOpenQueue.addEventListener('click', () => {
      openModal();
      document.querySelector('.modal-tab[data-tab="up-next"]')?.click();
    });
  }

  // 모달 내 싫어요 버튼 (모바일 / 데스크톱 공통 지원)
  const handleDislike = () => {
    const cur = player.getCurrentTrack();
    if (cur) {
      ui.removeLike(cur.id);
      updatePersonalizedQuickPicks();
      updatePersonalizedSpotlight();
    }
    ui.showToast('취향에 맞지 않는 곡으로 설정되었습니다.');
    player.nextTrack();
  };
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

  // 모바일 하단 서랍 (가사 / 대기열 / 관련 항목 드로어 슬라이드 업)
  const mobileDrawerHandle = document.getElementById('mobile-drawer-drag-bar');
  const modalContentPanel = document.getElementById('modal-content-panel');
  if (mobileDrawerHandle && modalContentPanel) {
    mobileDrawerHandle.addEventListener('click', () => {
      modalContentPanel.classList.toggle('drawer-expanded');
    });
  }

  // 3-dots 메뉴 팝업 바텀시트 (Screenshot 2 매칭)
  const trackMoreSheet = document.getElementById('track-more-sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  const openTrackMoreSheet = () => {
    const track = player.getCurrentTrack();
    if (!track) return;
    const cover = document.getElementById('sheet-cover-img');
    const title = document.getElementById('sheet-track-title');
    const artist = document.getElementById('sheet-track-artist');
    if (cover) cover.src = track.cover;
    if (title) title.textContent = track.title;
    if (artist) artist.textContent = `${track.artist} • ${ui.formatTime(track.duration)}`;
    trackMoreSheet?.classList.add('open');
  };
  const closeTrackMoreSheet = () => {
    trackMoreSheet?.classList.remove('open');
  };

  document.getElementById('btn-modal-more')?.addEventListener('click', openTrackMoreSheet);
  document.getElementById('btn-player-more')?.addEventListener('click', openTrackMoreSheet);
  sheetBackdrop?.addEventListener('click', closeTrackMoreSheet);

  document.getElementById('sheet-btn-like')?.addEventListener('click', () => {
    ui.toggleLike(player.getCurrentTrack());
  });
  document.getElementById('sheet-btn-dislike')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    handleDislike();
  });
  document.getElementById('sheet-act-radio')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    updatePersonalizedQuickPicks();
    ui.showToast('뮤직 스테이션을 시작합니다.');
  });
  document.getElementById('sheet-act-next')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const cur = player.getCurrentTrack();
    if (cur) {
      player.queue.splice(player.currentIndex + 1, 0, cur);
      ui.renderQueue(player.queue, player.currentIndex);
      ui.showToast('다음 재생 목록에 추가되었습니다.');
    }
  });
  document.getElementById('sheet-act-queue')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    const cur = player.getCurrentTrack();
    if (cur) {
      player.queue.push(cur);
      ui.renderQueue(player.queue, player.currentIndex);
      ui.showToast('목록 끝에 추가되었습니다.');
    }
  });
  document.getElementById('sheet-act-library')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    ui.toggleLike(player.getCurrentTrack());
  });
  document.getElementById('sheet-act-download')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    ui.showToast('오프라인 저장 완료 (로컬 보관함)');
  });
  document.getElementById('sheet-act-playlist')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    ui.showToast('재생목록에 추가되었습니다.');
  });
  document.getElementById('sheet-act-taste')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    auth.openTasteModal(allTracks);
  });
  document.getElementById('sheet-act-share')?.addEventListener('click', () => {
    closeTrackMoreSheet();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
    }
    ui.showToast('공유 링크가 클립보드에 복사되었습니다.');
  });

  // 전체화면 토글
  const btnToggleStageFs = document.getElementById('btn-toggle-stage-fs');
  if (btnToggleStageFs) {
    btnToggleStageFs.addEventListener('click', () => {
      const stage = document.getElementById('stage-media-wrap');
      if (!document.fullscreenElement) {
        stage?.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }

  // 동영상 대형 영상 모드 (Theater Mode) 버튼 (사용자 요청 7번)
  if (ui.dom.btnVideoTheater) {
    ui.dom.btnVideoTheater.addEventListener('click', (e) => {
      e.stopPropagation();
      const modalEl = ui.dom.fullModal || ui.dom.modal || document.getElementById('full-player-modal');
      if (!modalEl) return;

      const isTheater = modalEl.classList.toggle('modal-theater-mode');
      ui.dom.btnVideoTheater.classList.toggle('active', isTheater);

      const expandIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-expand');
      const shrinkIcon = ui.dom.btnVideoTheater.querySelector('.theater-icon-shrink');
      if (expandIcon) expandIcon.style.display = isTheater ? 'none' : 'block';
      if (shrinkIcon) shrinkIcon.style.display = isTheater ? 'block' : 'none';

      ui.dom.btnVideoTheater.title = isTheater ? '기본 모드로 축소' : '대형 영상 모드 (화면 확대 / 시어터 뷰)';
      ui.showToast(isTheater ? '대형 영상 모드 (화면 확대)' : '기본 영상 모드로 복귀');
    });
  }

  if (ui.dom.btnVideoFs) {
    ui.dom.btnVideoFs.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoWrap = document.getElementById('modal-video-wrap') || document.getElementById('stage-media-wrap');
      if (!document.fullscreenElement) {
        videoWrap?.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  }

  // 미니 플레이어 (PIP) 토글 버튼
  const btnTogglePip = document.getElementById('btn-toggle-pip');
  if (btnTogglePip) {
    btnTogglePip.addEventListener('click', async () => {
      closeModal();
      ui.showToast('미니 플레이어로 전환되었습니다.');
      try {
        const videoEl = document.querySelector('#youtube-player-hidden iframe') || document.querySelector('video');
        if (videoEl && document.pictureInPictureEnabled && !document.pictureInPictureElement && videoEl.requestPictureInPicture) {
          await videoEl.requestPictureInPicture();
        }
      } catch (e) {}
    });
  }

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
  const searchService = new YouTubeSearchService();
  let searchDebounceTimer = null;

  // 최근 검색어 저장 및 렌더링 함수 (Screenshot 3 일치)
  function saveRecentSearch(q) {
    if (!q || !q.trim()) return;
    try {
      let recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '[]');
      recents = recents.filter(item => item !== q);
      recents.unshift(q);
      if (recents.length > 8) recents.pop();
      localStorage.setItem('streamvance_recent_searches', JSON.stringify(recents));
      renderRecentSearches();
    } catch (e) {}
  }

  function renderRecentSearches() {
    if (!ui.dom.recentSearchList) return;
    let recents = [];
    try {
      recents = JSON.parse(localStorage.getItem('streamvance_recent_searches') || '["alter bridge", "linkin park", "kiss of life bad news", "아이유", "뉴진스"]');
    } catch (e) {}
    ui.dom.recentSearchList.innerHTML = recents.map(q => `
      <div class="recent-search-item" data-query="${q}">
        <div class="recent-search-item-left">
          <i data-lucide="history"></i>
          <span>${q}</span>
        </div>
        <i data-lucide="arrow-up-right" style="color: #666; width: 16px; height: 16px;"></i>
      </div>
    `).join('');
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

  // 11. Library Tabs (Likes, History, Local)
  document.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.getAttribute('data-lib');
      ui.renderLibrary(type, allTracks);
    });
  });

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

  // 프로필 아바타 클릭 시 YouTube Music 정품 스타일 드롭다운 메뉴 토글
  const userProfileWrap = document.getElementById('user-profile-wrap');
  if (userProfileWrap) {
    userProfileWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      auth.toggleProfileDropdown();
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

  // 싫어요 버튼 (피드백 후 다음 곡)
  const btnThumbDown = document.getElementById('btn-thumb-down');
  if (btnThumbDown) {
    btnThumbDown.addEventListener('click', () => {
      ui.showToast('취향에 맞지 않는 곡으로 설정되었습니다.');
      player.nextTrack();
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

  // 사이드바 내의 항목 클릭 시 모바일이면 사이드바 닫기
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

  // Lucide Icons 초기 렌더링
  if (window.lucide) {
    window.lucide.createIcons();
  }
});
