// ==========================================================================
// UI Rendering, Interactions, and View Management (YouTube Music PC 100% Match)
// ==========================================================================

import { sampleTracks } from './data.js';
import { offlineStorage } from './offlineStorage.js';

// ==========================================================================
// 범용 썸네일 실시간 교차검증 & 다중 자동 복구 엔진 (Universal Cross-Verification Engine)
// - 전 세계 모든 아티스트/곡 100% 대응 (특정 아티스트 하드코딩 제거)
// - 120x90 더미 이미지 실시간 감지
// - YouTube 다중 CDN 호스트 자동 스위칭 (i.ytimg.com <-> img.youtube.com)
// - 글로벌 iTunes Search API 고화질(600x600) 실시간 교차 검증 & 영구 캐싱
// - 오프라인 글래스모피즘 동적 SVG 폴백
// ==========================================================================

const thumbnailCrossCheckCache = new Map();
try {
  const savedArtCache = JSON.parse(localStorage.getItem('streamvance_art_cache') || '{}');
  Object.entries(savedArtCache).forEach(([k, v]) => thumbnailCrossCheckCache.set(k, v));
} catch (e) {}

function saveCrossCheckCache(key, url) {
  if (!key || !url) return;
  thumbnailCrossCheckCache.set(key, url);
  try {
    const obj = {};
    let count = 0;
    for (const [k, v] of thumbnailCrossCheckCache.entries()) {
      obj[k] = v;
      if (++count > 250) break;
    }
    localStorage.setItem('streamvance_art_cache', JSON.stringify(obj));
  } catch (e) {}
}

async function fetchItunesArtwork(query) {
  if (!query) return null;
  const cleanQ = query.trim().toLowerCase();
  if (thumbnailCrossCheckCache.has(cleanQ)) {
    return thumbnailCrossCheckCache.get(cleanQ);
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=song&limit=1`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.results && data.results.length > 0) {
        const item = data.results[0];
        const art = (item.artworkUrl100 || '').replace('100x100bb', '600x600bb');
        if (art) {
          saveCrossCheckCache(cleanQ, art);
          return art;
        }
      }
    }
  } catch (err) {}
  return null;
}

if (typeof window !== 'undefined') {
  // YouTube의 120x90 회색 더미 이미지(HTTP 200 반환) 실시간 적발 함수
  window.validateTrackImg = function(img) {
    if (!img) return;
    if (img.naturalWidth === 120 && img.naturalHeight === 90) {
      window.handleTrackImgError(img);
    }
  };

  window.handleTrackImgError = function(img) {
    if (!img) return;
    const src = img.src || '';
    const title = decodeURIComponent(img.dataset.title || img.alt || '');
    const artist = decodeURIComponent(img.dataset.artist || '');

    // 1단계: maxresdefault 404 -> hqdefault (가장 안전한 유튜브 표준 규격)
    if (src.includes('maxresdefault.jpg')) {
      img.src = src.replace('maxresdefault.jpg', 'hqdefault.jpg');
      return;
    }
    // 2단계: i.ytimg.com CDN 차단 -> img.youtube.com 교차 호스트 시도
    if (src.includes('i.ytimg.com/vi/')) {
      img.src = src.replace('i.ytimg.com/vi/', 'img.youtube.com/vi/');
      return;
    }
    // 3단계: hqdefault 실패 시 mqdefault 시도
    if (src.includes('hqdefault.jpg')) {
      img.src = src.replace('hqdefault.jpg', 'mqdefault.jpg');
      return;
    }
    // 4단계: mqdefault 실패 시 default.jpg 시도
    if (src.includes('mqdefault.jpg')) {
      img.src = src.replace('mqdefault.jpg', 'default.jpg');
      return;
    }

    // 5단계: 글로벌 iTunes 실시간 교차 검증 (모든 아티스트/곡 100% 자동 복구)
    if (!img.dataset.itunesAttempted && (artist || title)) {
      img.dataset.itunesAttempted = 'true';
      const query = `${artist} ${title}`.trim();
      fetchItunesArtwork(query).then(artUrl => {
        if (artUrl) {
          img.src = artUrl;
        } else {
          applySvgFallback(img, title, artist);
        }
      }).catch(() => {
        applySvgFallback(img, title, artist);
      });
      return;
    }

    // 6단계: 최종 오프라인 세련된 글래스모피즘 동적 SVG 커버 (절대 깨지지 않음)
    applySvgFallback(img, title, artist);
  };

  window.handleArtistImgError = function(img, artistName) {
    if (!img) return;
    const src = img.src || '';
    const name = (artistName || img.alt || '').trim();

    if (src.includes('maxresdefault.jpg')) {
      img.src = src.replace('maxresdefault.jpg', 'hqdefault.jpg');
      return;
    }
    if (src.includes('i.ytimg.com/vi/')) {
      img.src = src.replace('i.ytimg.com/vi/', 'img.youtube.com/vi/');
      return;
    }
    if (src.includes('hqdefault.jpg')) {
      img.src = src.replace('hqdefault.jpg', 'mqdefault.jpg');
      return;
    }

    if (!img.dataset.itunesArtistAttempted && name) {
      img.dataset.itunesArtistAttempted = 'true';
      fetchItunesArtwork(name).then(artUrl => {
        if (artUrl) {
          img.src = artUrl;
        } else {
          applyArtistSvg(img, name);
        }
      }).catch(() => {
        applyArtistSvg(img, name);
      });
      return;
    }

    applyArtistSvg(img, name);
  };
}

function applySvgFallback(img, title = '', artist = '') {
  if (!img || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = 'true';
  const cleanTitle = (title || 'Track').slice(0, 16);
  img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100%25' height='100%25'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%231f1c2c'/%3E%3Cstop offset='50%25' stop-color='%23302b63'/%3E%3Cstop offset='100%25' stop-color='%2324243e'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3Ccircle cx='50' cy='46' r='26' fill='none' stroke='%23ffffff' stroke-width='1.5' opacity='0.25'/%3E%3Cpath d='M42 60a6 6 0 1 1-3-5.2V32l18-4v24a6 6 0 1 1-3-5.2V36l-12 2.7v21.3z' fill='%23ffffff' opacity='0.85'/%3E%3Ctext x='50' y='88' font-family='sans-serif' font-size='9' font-weight='600' fill='%23ffffff' opacity='0.7' text-anchor='middle'%3E${encodeURIComponent(cleanTitle)}%3C/text%3E%3C/svg%3E`;
}

function applyArtistSvg(img, name = '') {
  if (!img || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = 'true';
  const initial = (name || 'A').trim().charAt(0).toUpperCase();
  img.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='ag' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%236366f1'/%3E%3Cstop offset='100%25' stop-color='%23ec4899'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23ag)'/%3E%3Ctext x='50' y='64' font-family='sans-serif' font-size='44' font-weight='bold' fill='%23ffffff' text-anchor='middle'%3E${encodeURIComponent(initial)}%3C/text%3E%3C/svg%3E`;
}

export class UIManager {
  constructor(player) {
    this.player = player;
    this.currentView = 'home';
    this._lastActiveLyricIndex = -1;

    // 좋아요 표시한 음악 영구 저장 및 Map 관리
    this.likedTracksMap = new Map();
    try {
      const storedLikes = JSON.parse(localStorage.getItem('streamvance_liked_tracks') || '[]');
      if (Array.isArray(storedLikes) && storedLikes.length > 0) {
        storedLikes.forEach(t => {
          if (t && t.id) this.likedTracksMap.set(t.id, t);
        });
      }
    } catch (e) {}
    this.likedTrackIds = new Set(this.likedTracksMap.keys());

    // 싫어요(Dislike) 목록 영구 저장 및 관리
    this.dislikedTrackIds = new Set();
    try {
      const storedDislikes = JSON.parse(localStorage.getItem('streamvance_disliked_tracks') || '[]');
      if (Array.isArray(storedDislikes)) {
        storedDislikes.forEach(id => this.dislikedTrackIds.add(id));
      }
    } catch (e) {}

    // 검색 결과 캐시 및 필터 상태 (Screenshot 3 일치)
    this.lastSearchData = null;
    this.currentSearchFilter = 'all';

    // 시청 / 감상 기록 영구 저장 및 관리
    this.playHistory = [];
    try {
      const storedHist = JSON.parse(localStorage.getItem('streamvance_play_history') || '[]');
      if (Array.isArray(storedHist) && storedHist.length > 0) {
        this.playHistory = storedHist;
      }
    } catch (e) {}

    this.localFiles = [];

    // DOM Elements Cache
    this.dom = {
      // Views
      views: {
        home: document.getElementById('view-home'),
        explore: document.getElementById('view-explore'),
        library: document.getElementById('view-library'),
        search: document.getElementById('view-search'),
        artist: document.getElementById('view-artist')
      },
      // Bottom Player Bar (스크린샷 일치)
      playerBar: document.getElementById('player-bar'),
      coverImg: document.getElementById('player-cover-img'),
      titleText: document.getElementById('player-title'),
      artistText: document.getElementById('player-artist'),
      playPauseBtn: document.getElementById('btn-play-pause'),
      eqBars: document.getElementById('audio-eq-bars'),
      likeBtn: document.getElementById('btn-like-track'),
      thumbDownBtn: document.getElementById('btn-thumb-down'),
      shuffleBtn: document.getElementById('btn-shuffle'),
      repeatBtn: document.getElementById('btn-repeat'),
      currentTimeText: document.getElementById('current-time'),
      durationTimeText: document.getElementById('duration-time'),
      progressBar: document.getElementById('seek-progress-bar'),
      seekSlider: document.getElementById('seek-slider'),
      volumeSlider: document.getElementById('volume-slider'),
      volumeIcon: document.getElementById('icon-volume'),
      
      // Full Modal
      fullModal: document.getElementById('full-player-modal'),
      modalCover: document.getElementById('modal-album-art'),
      modalTitle: document.getElementById('modal-song-title'),
      modalArtist: document.getElementById('modal-song-artist'),
      modalLikeBtn: document.getElementById('btn-like-modal'),
      queueList: document.getElementById('queue-track-list'),
      queueCount: document.getElementById('queue-count'),
      lyricsContainer: document.getElementById('lyrics-container'),
      syncOffsetDisplay: document.getElementById('sync-offset-display'),
      relatedList: document.getElementById('related-tracks-list'),
      
      // Containers
      quickPicksList: document.getElementById('quick-picks-list'),
      recommendedAlbumsList: document.getElementById('recommended-albums-list'),
      spotlightTracksList: document.getElementById('spotlight-tracks-list'),
      topChartsList: document.getElementById('top-charts-list'),
      genreGrid: document.getElementById('genre-grid'),
      libraryContent: document.getElementById('library-content'),
      searchResultsList: document.getElementById('search-results-list'),
      searchQueryText: document.getElementById('search-query-text'),
      searchInput: document.getElementById('search-input'),
      searchClearBtn: document.getElementById('search-clear-btn'),
      toast: document.getElementById('toast-notification'),
      likesCount: document.getElementById('likes-count'),

      // 모바일 검색 & 둘러보기 상세 & 비디오 확장 요소
      mobileSearchBtn: document.getElementById('mobile-search-btn'),
      mobileSearchOverlay: document.getElementById('mobile-search-overlay'),
      mobileSearchInput: document.getElementById('mobile-search-input'),
      mobileSearchClearBtn: document.getElementById('btn-mobile-search-clear'),
      mobileSearchBackBtn: document.getElementById('btn-mobile-search-back'),
      recentSearchList: document.getElementById('recent-search-list'),
      exploreMainGenres: document.getElementById('explore-main-genres'),
      exploreGenreDetail: document.getElementById('explore-genre-detail'),
      btnExploreGenreBack: document.getElementById('btn-explore-genre-back'),
      genreDetailTitle: document.getElementById('genre-detail-title'),
      genreDetailDesc: document.getElementById('genre-detail-desc'),
      genreTracksList: document.getElementById('genre-tracks-list'),
      btnGenrePlayAll: document.getElementById('btn-genre-play-all'),
      btnGenreShuffle: document.getElementById('btn-genre-shuffle'),
      btnVideoTheater: document.getElementById('btn-video-theater') || document.getElementById('btn-video-theater-toggle'),
      btnVideoFs: document.getElementById('btn-video-fs') || document.getElementById('btn-video-fullscreen-toggle'),
      modal: document.getElementById('full-player-modal'),
      mobileSearchForm: document.getElementById('mobile-search-form'),
      mobileSearchSubmitBtn: document.getElementById('btn-mobile-search-submit'),
      spotlightArtistChips: document.getElementById('spotlight-artist-chips'),
      btnClearHistory: document.getElementById('btn-clear-history'),
      searchDropdownMenu: document.getElementById('search-dropdown-menu'),
      pcRecentSearchList: document.getElementById('pc-recent-search-list'),
      btnClearSearchesPc: document.getElementById('btn-clear-searches-pc'),
      btnClearSearchesMobile: document.getElementById('btn-clear-searches')
    };
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  showToast(message) {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('show');
    }, 2800);
  }

  switchView(viewName, pushHistory = true) {
    this.currentView = viewName;
    Object.keys(this.dom.views).forEach(key => {
      if (this.dom.views[key]) {
        this.dom.views[key].classList.toggle('active', key === viewName);
      }
    });

    // Top Navigation Tabs & Mobile Nav active state update
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === viewName);
    });

    if (pushHistory && typeof window !== 'undefined' && window.history) {
      try {
        window.history.pushState({ view: viewName }, '', `#${viewName}`);
      } catch (e) {}
    }

    const scrollArea = document.getElementById('content-scroll-area');
    if (scrollArea) scrollArea.scrollTop = 0;
  }

  removeLike(trackId) {
    if (!trackId) return;
    if (this.likedTracksMap.has(trackId)) {
      this.likedTracksMap.delete(trackId);
      this.likedTrackIds.delete(trackId);
      try {
        localStorage.setItem('streamvance_liked_tracks', JSON.stringify(Array.from(this.likedTracksMap.values())));
      } catch (e) {}
      this.updateLikeButtons(trackId);
      this.updateLikesCount();
    }
  }

  toggleLike(track) {
    if (!track) return;
    if (this.likedTracksMap.has(track.id)) {
      this.likedTracksMap.delete(track.id);
      this.likedTrackIds.delete(track.id);
      this.showToast(`'${track.title}' 좋아요 취소됨`);
    } else {
      this.likedTracksMap.set(track.id, track);
      this.likedTrackIds.add(track.id);
      if (this.dislikedTrackIds.has(track.id)) {
        this.dislikedTrackIds.delete(track.id);
      }
      this.showToast(`'${track.title}' 좋아요 표시한 음악에 추가됨`);
    }
    try {
      localStorage.setItem('streamvance_liked_tracks', JSON.stringify(Array.from(this.likedTracksMap.values())));
      localStorage.setItem('streamvance_disliked_tracks', JSON.stringify(Array.from(this.dislikedTrackIds)));
    } catch (e) {}

    this.updateLikeButtons(track.id);
    this.updateLikesCount();
    if (this.currentView === 'library') {
      const activeTab = document.querySelector('.lib-tab.active');
      const tabType = activeTab ? activeTab.getAttribute('data-lib') : 'likes';
      this.renderLibrary(tabType);
    }
  }

  toggleDislike(track) {
    if (!track) return;
    if (this.dislikedTrackIds.has(track.id)) {
      this.dislikedTrackIds.delete(track.id);
      this.showToast(`'${track.title}' 싫어요 취소됨`);
    } else {
      this.dislikedTrackIds.add(track.id);
      if (this.likedTracksMap.has(track.id)) {
        this.likedTracksMap.delete(track.id);
        this.likedTrackIds.delete(track.id);
      }
      this.showToast('취향에 맞지 않는 곡으로 설정되었습니다.');
    }
    try {
      localStorage.setItem('streamvance_liked_tracks', JSON.stringify(Array.from(this.likedTracksMap.values())));
      localStorage.setItem('streamvance_disliked_tracks', JSON.stringify(Array.from(this.dislikedTrackIds)));
    } catch (e) {}

    this.updateLikeButtons(track.id);
    this.updateLikesCount();
  }

  updateLikesCount() {
    if (this.dom.likesCount) {
      this.dom.likesCount.textContent = this.likedTracksMap.size;
    }
  }

  updateLikeButtons(currentTrackId) {
    if (!currentTrackId && this.player) {
      currentTrackId = this.player.getCurrentTrack()?.id;
    }
    const isLiked = currentTrackId ? this.likedTrackIds.has(currentTrackId) : false;
    const isDisliked = currentTrackId ? this.dislikedTrackIds.has(currentTrackId) : false;

    // 좋아요 버튼 (화이트 채움)
    if (this.dom.likeBtn) {
      this.dom.likeBtn.classList.toggle('liked', isLiked);
    }
    if (this.dom.modalLikeBtn) {
      this.dom.modalLikeBtn.classList.toggle('liked', isLiked);
    }

    // 싫어요 버튼 (화이트 채움)
    const thumbDownBtn = this.dom.thumbDownBtn || document.getElementById('btn-thumb-down');
    if (thumbDownBtn) {
      thumbDownBtn.classList.toggle('disliked', isDisliked);
    }
    const modalDislikeBtn = document.getElementById('btn-modal-dislike');
    if (modalDislikeBtn) {
      modalDislikeBtn.classList.toggle('disliked', isDisliked);
    }
    const modalDislikeMobile = document.getElementById('btn-modal-dislike-mobile');
    if (modalDislikeMobile) {
      modalDislikeMobile.classList.toggle('disliked', isDisliked);
    }

    const btnPillLike = document.getElementById('btn-pill-like');
    if (btnPillLike) {
      btnPillLike.classList.toggle('active', isLiked);
    }
    const btnPillDislike = document.getElementById('btn-pill-dislike');
    if (btnPillDislike) {
      btnPillDislike.classList.toggle('active', isDisliked);
    }

    // 페이지 내 모든 트랙 카드의 인라인 좋아요 버튼 동기화
    if (currentTrackId) {
      document.querySelectorAll(`.btn-inline-like[data-track-id="${currentTrackId}"]`).forEach(btn => {
        btn.classList.toggle('liked', isLiked);
      });
    }
  }

  // 1. 빠른 선곡 렌더링 (4행 x 2컬럼 레이아웃 - 스크린샷 100% 일치)
  renderQuickPicks(tracks) {
    if (!this.dom.quickPicksList) return;
    this.dom.quickPicksList.innerHTML = tracks.map(track => {
      const isCurrent = this.player.getCurrentTrack()?.id === track.id;
      const isLiked = this.likedTrackIds.has(track.id);
      return `
        <div class="track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
          <div class="track-row-cover">
            <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
            <div class="cover-play-overlay">
              ${isCurrent && this.player.isPlaying 
                ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
                : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
              }
            </div>
          </div>
          <div class="track-row-info">
            <div class="track-row-title">${track.title}</div>
            <div class="track-row-artist">
              <span class="track-radio-icon">((•))</span> ${track.artist} • ${track.album}
            </div>
          </div>
          <div class="track-row-actions">
            <button class="btn-track-action btn-inline-like ${isLiked ? 'liked' : ''}" data-action="like" title="좋아요">
              <i data-lucide="thumbs-up"></i>
            </button>
            <button class="btn-track-action" data-action="queue" title="대기열에 추가">
              <i data-lucide="list-plus"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  // 2. 다시 듣기 렌더링 (실제 최근 감상 기록 + 취향 DNA 알고리즘 기반)
  renderRecommendedAlbums(albums, allTracks) {
    if (!this.dom.recommendedAlbumsList) return;

    // 1) 실제 청취 기록(playHistory)에서 최근 곡 우선 수집 (중복 제거)
    const historyTrackIds = new Set();
    const historyCards = [];
    if (Array.isArray(this.playHistory)) {
      for (const h of this.playHistory) {
        if (h && h.id && !historyTrackIds.has(h.id)) {
          historyTrackIds.add(h.id);
          const full = (allTracks || []).find(t => t.id === h.id) || h;
          historyCards.push(full);
          if (historyCards.length >= 8) break;
        }
      }
    }

    // 2) 청취 기록 카드 생성 (실제 들은 곡이 바로 '다시 듣기'에 반영)
    let cardsHtml = '';
    if (historyCards.length > 0) {
      cardsHtml = historyCards.map(track => `
        <div class="music-card" data-track-id="${track.id}">
          <div class="card-cover-wrapper">
            <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
            <div class="card-float-play-btn" data-action="play" title="다시 듣기">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <polygon points="7 5 19 12 7 19 7 5"></polygon>
              </svg>
            </div>
          </div>
          <div class="card-title">${track.title}</div>
          <div class="card-subtitle">다시 듣기 • ${track.artist}</div>
        </div>
      `).join('');
    }

    // 3) 추천 앨범 결합
    const albumCardsHtml = (albums || []).map(album => `
      <div class="music-card" data-album-id="${album.id}">
        <div class="card-cover-wrapper">
          <img referrerpolicy="no-referrer" src="${album.cover}" alt="${album.title}" loading="lazy" data-title="${encodeURIComponent(album.title || '')}" data-artist="${encodeURIComponent(album.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
          <div class="card-float-play-btn" data-action="play-album" title="앨범 재생">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <polygon points="7 5 19 12 7 19 7 5"></polygon>
            </svg>
          </div>
        </div>
        <div class="card-title">${album.title}</div>
        <div class="card-subtitle">${album.artist}</div>
      </div>
    `).join('');

    this.dom.recommendedAlbumsList.innerHTML = cardsHtml + albumCardsHtml;
  }

  // 3. 아티스트 스포트라이트 (아래 아티스트를 좋아한다면)
  renderSpotlight(artistTracks) {
    if (!this.dom.spotlightTracksList) return;
    this.dom.spotlightTracksList.innerHTML = artistTracks.slice(0, 18).map(track => `
      <div class="music-card" data-track-id="${track.id}">
        <div class="card-cover-wrapper">
          <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
          <div class="card-float-play-btn" data-action="play" title="재생">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <polygon points="7 5 19 12 7 19 7 5"></polygon>
            </svg>
          </div>
        </div>
        <div class="card-title">${track.title}</div>
        <div class="card-subtitle">노래 • ${track.artist}</div>
      </div>
    `).join('');
  }

  // 3-1. 아티스트 퀵 선택 칩 바 렌더링 (특정 아티스트 선택 시 해당 아티스트 노래만 표시)
  renderSpotlightChips(artists, currentIndex, onSelect) {
    if (!this.dom.spotlightArtistChips) return;
    this.dom.spotlightArtistChips.innerHTML = artists.map((artist, idx) => {
      const safeName = (artist.name || '').replace(/'/g, "\\'");
      return `
        <button class="artist-chip ${idx === currentIndex ? 'active' : ''}" data-artist-index="${idx}">
          <img referrerpolicy="no-referrer" class="artist-chip-avatar" src="${artist.image || 'https://i.ytimg.com/vi/9wUKhEgnllc/hqdefault.jpg'}" alt="${artist.name}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleArtistImgError==='function'){window.handleArtistImgError(this, '${safeName}');}">
          <span>${artist.name}</span>
        </button>
      `;
    }).join('');

    this.dom.spotlightArtistChips.querySelectorAll('.artist-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-artist-index'), 10);
        if (typeof onSelect === 'function') onSelect(idx);
      });
    });
  }

  // 4. TOP 차트 렌더링
  renderTopCharts(tracks) {
    if (!this.dom.topChartsList) return;
    this.dom.topChartsList.innerHTML = tracks.slice(0, 5).map((track, idx) => `
      <div class="chart-item" data-track-id="${track.id}">
        <span class="chart-rank">${idx + 1}</span>
        <img referrerpolicy="no-referrer" class="chart-cover" src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(this.src.includes('maxresdefault.jpg'))this.src=this.src.replace('maxresdefault.jpg','hqdefault.jpg');">
        <div class="chart-meta">
          <div class="chart-song-title">${track.title}</div>
          <div class="chart-song-artist">${track.artist} • ${track.album || '실시간 차트'}</div>
        </div>
        <button class="ctrl-btn" data-action="play" title="재생">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        </button>
      </div>
    `).join('');
  }

  // 5. 장르 카드 렌더링
  renderGenres(genres) {
    if (!this.dom.genreGrid) return;
    this.dom.genreGrid.innerHTML = genres.map(g => `
      <div class="genre-card" style="background: ${g.color}; padding: 24px; border-radius: 8px; font-weight: 700; font-size: 1.1rem; cursor: pointer;" data-genre-id="${g.id || g.mood}" data-genre-mood="${g.mood}" data-genre-name="${g.name}">
        <span>${g.name}</span>
      </div>
    `).join('');
  }

  // 6. 보관함 렌더링 (좋아요 표시한 곡 & 시청/감상 기록 & 오프라인 저장 100% 실시간 반영)
  async renderLibrary(tabType = 'likes', allTracks = []) {
    if (!this.dom.libraryContent) return;
    let targetTracks = [];

    if (tabType === 'likes') {
      targetTracks = Array.from(this.likedTracksMap.values());
    } else if (tabType === 'history') {
      targetTracks = this.playHistory;
    } else if (tabType === 'local') {
      targetTracks = this.localFiles;
    } else if (tabType === 'offline') {
      try {
        targetTracks = await offlineStorage.getTracks();
      } catch (e) {
        targetTracks = [];
      }
    }

    // 오프라인 저장 뱃지 숫자 실시간 동기화
    this.updateOfflineBadgeCount();

    // 시청 기록 전체 삭제 버튼 표시/숨김 제어
    if (this.dom.btnClearHistory) {
      this.dom.btnClearHistory.style.display = (tabType === 'history' && targetTracks.length > 0) ? 'inline-flex' : 'none';
    }

    if (targetTracks.length === 0) {
      let emptyMsg = '아직 보관된 음악이 없습니다.';
      let emptySub = '좋아하는 곡에 좋아요를 누르거나 음악 파일을 추가해보세요.';
      let icon = 'music';
      if (tabType === 'likes') {
        emptyMsg = '좋아요 표시한 음악이 없습니다.';
        emptySub = '음악을 들으며 엄지척(좋아요)을 눌러 나만의 보관함을 만들어보세요.';
        icon = 'thumbs-up';
      } else if (tabType === 'history') {
        emptyMsg = '시청 / 감상 기록이 없습니다.';
        emptySub = '음악을 재생하면 여기에 자동으로 기록되어 언제든 다시 들을 수 있습니다.';
        icon = 'history';
      } else if (tabType === 'local') {
        emptyMsg = '추가된 로컬 음악이 없습니다.';
        emptySub = '컴퓨터의 MP3, WAV, FLAC 오디오 파일을 보관함에 추가해보세요.';
        icon = 'folder-open';
      } else if (tabType === 'offline') {
        emptyMsg = '오프라인 저장된 음악이 없습니다.';
        emptySub = '노래의 더보기(⋮) 메뉴에서 [오프라인 저장]을 누르면 인터넷 연결 없이 언제든 감상할 수 있습니다.';
        icon = 'download';
      }

      this.dom.libraryContent.innerHTML = `
        <div style="padding: 60px 16px; text-align: center; color: var(--text-muted);">
          <i data-lucide="${icon}" style="width: 48px; height: 48px; margin-bottom: 14px; opacity: 0.5;"></i>
          <p style="font-size: 1.15rem; font-weight: 600; color: #fff;">${emptyMsg}</p>
          <p style="font-size: 0.88rem; margin-top: 6px;">${emptySub}</p>
          ${tabType === 'local' ? `
            <div style="margin-top: 20px;">
              <button class="btn-add-local-empty" id="btn-add-local-file" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px; border-radius: 22px; background: #fff; color: #030303; font-weight: 600; font-size: 0.95rem; cursor: pointer; border: none; box-shadow: 0 4px 14px rgba(255,255,255,0.2);">
                <i data-lucide="upload-cloud"></i>
                <span>내 PC 음원 추가 (MP3/WAV)</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.dom.libraryContent.innerHTML = `
      <div class="library-tracks-grid">
        ${targetTracks.map(track => {
          const isCurrent = this.player.getCurrentTrack()?.id === track.id;
          const isLiked = this.likedTrackIds.has(track.id);
          const isOfflineItem = tabType === 'offline' || track.isOffline;
          return `
            <div class="track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
              <div class="track-row-cover">
                <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
                <div class="cover-play-overlay">
                  ${isCurrent && this.player.isPlaying 
                    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
                    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
                  }
                </div>
              </div>
              <div class="track-row-info">
                <div class="track-row-title">
                  ${track.title}
                  ${isOfflineItem ? '<span class="badge-offline-saved"><i data-lucide="download" style="width: 11px; height: 11px;"></i>저장됨</span>' : ''}
                </div>
                <div class="track-row-artist">${track.artist} • ${track.album || ''}</div>
              </div>
              <span class="track-row-duration">${this.formatTime(track.duration)}</span>
              <div class="track-row-actions">
                ${tabType === 'history' ? `
                  <button class="btn-track-action btn-delete-history" data-action="delete-history" data-track-id="${track.id}" title="기록에서 삭제">
                    <i data-lucide="trash-2"></i>
                  </button>
                ` : ''}
                ${tabType === 'offline' ? `
                  <button class="btn-track-action btn-delete-offline" data-action="delete-offline" data-track-id="${track.id}" title="오프라인 저장 삭제">
                    <i data-lucide="trash-2"></i>
                  </button>
                ` : ''}
                <button class="btn-track-action btn-inline-like ${isLiked ? 'liked' : ''}" data-action="like" title="좋아요">
                  <i data-lucide="thumbs-up"></i>
                </button>
                <button class="btn-track-action" data-action="queue" title="대기열에 추가">
                  <i data-lucide="list-plus"></i>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  // 오프라인 저장 뱃지 개수 업데이트
  async updateOfflineBadgeCount() {
    try {
      const tracks = await offlineStorage.getTracks();
      const countEl = document.getElementById('offline-count');
      if (countEl) countEl.textContent = tracks.length;
    } catch (e) {}
  }

  // 오프라인 저장 항목 개별 삭제
  async deleteOfflineItem(trackId) {
    if (!trackId) return;
    try {
      await offlineStorage.removeTrack(trackId);
      this.showToast('오프라인 저장 목록에서 삭제되었습니다.');
      await this.renderLibrary('offline');
      this.updateOfflineBadgeCount();
    } catch (e) {
      console.warn('deleteOfflineItem error:', e);
    }
  }

  // 시청 / 재생 기록 개별 항목 삭제
  deletePlayHistoryItem(trackId) {
    if (!trackId) return;
    const initialLen = this.playHistory.length;
    this.playHistory = this.playHistory.filter(t => t.id !== trackId && t.videoId !== trackId);
    if (this.playHistory.length !== initialLen) {
      try {
        localStorage.setItem('streamvance_play_history', JSON.stringify(this.playHistory));
        localStorage.setItem('streamvance_history', JSON.stringify(this.playHistory));
      } catch (e) {}
      this.renderLibrary('history');
      this.showToast('시청 기록에서 삭제되었습니다.');
      if (typeof this.onHistoryChanged === 'function') {
        this.onHistoryChanged(trackId);
      }
    }
  }

  // 시청 / 재생 기록 전체 삭제
  clearAllPlayHistory() {
    this.playHistory = [];
    try {
      localStorage.removeItem('streamvance_play_history');
      localStorage.removeItem('streamvance_history');
    } catch (e) {}
    this.renderLibrary('history');
    this.showToast('시청 기록이 모두 삭제되었습니다.');
    if (typeof this.onHistoryChanged === 'function') {
      this.onHistoryChanged(null);
    }
  }

  // 7. 대기열 렌더링 (윤하 스크린샷 100% 매칭: 재생 중인 곡 스피커 아이콘 & 하이라이트)
  renderQueue(queue, currentIndex) {
    if (!this.dom.queueList) return;
    if (this.dom.queueCount) {
      this.dom.queueCount.textContent = `${queue.length}곡`;
    }

    // 1) Screenshot 1 일치: 현재 재생 중인 트랙 카드 (이퀄라이저 바 + '=' 드래그 핸들)
    const currentCardWrap = document.getElementById('queue-current-card-wrap');
    const curTrack = (currentIndex >= 0 && currentIndex < queue.length) ? queue[currentIndex] : null;

    if (currentCardWrap) {
      if (curTrack) {
        currentCardWrap.innerHTML = `
          <div class="queue-current-card" data-queue-index="${currentIndex}">
            <div class="track-row-cover" style="width: 48px; height: 48px; position: relative; border-radius: 6px; overflow: hidden; flex-shrink: 0;">
              <img referrerpolicy="no-referrer" src="${curTrack.cover}" alt="${curTrack.title}" data-title="${encodeURIComponent(curTrack.title || '')}" data-artist="${encodeURIComponent(curTrack.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
              <div class="audio-equalizer-bars active" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.55);">
                <span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span>
              </div>
            </div>
            <div class="track-row-info">
              <div class="track-row-title" style="font-size: 0.95rem; font-weight: 700; color: #fff;">${curTrack.title}</div>
              <div class="track-row-artist" style="font-size: 0.82rem; color: #aaa;">${curTrack.artist} • ${this.formatTime(curTrack.duration)}</div>
            </div>
            <div class="queue-drag-handle" title="재생 중인 트랙">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line></svg>
            </div>
          </div>
        `;
      } else {
        currentCardWrap.innerHTML = '';
      }
    }

    if (queue.length === 0) {
      this.dom.queueList.innerHTML = `<p class="lyrics-placeholder">대기열이 비어있습니다.</p>`;
      return;
    }

    // 2) Screenshot 1 일치: 다음 재생될 트랙 목록 (드래그 핸들 '=' 및 X 삭제)
    const nextTracks = queue.slice(currentIndex + 1);
    if (nextTracks.length === 0) {
      this.dom.queueList.innerHTML = `
        <div style="padding: 24px; text-align: center; color: #888;">
          <p style="font-size: 0.95rem; color: #ccc;">대기열의 마지막 곡입니다.</p>
          <p style="font-size: 0.8rem; margin-top: 4px; color: #777;">자동재생이 켜져 있으면 유사한 맞춤곡이 계속 이어집니다.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.dom.queueList.innerHTML = nextTracks.map((track, i) => {
      const realIndex = currentIndex + 1 + i;
      return `
        <div class="track-row-card queue-card" data-queue-index="${realIndex}">
          <div class="track-row-cover" style="width: 44px; height: 44px; position: relative; border-radius: 6px; overflow: hidden; flex-shrink: 0;">
            <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
            <div class="cover-play-overlay">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            </div>
          </div>
          <div class="track-row-info">
            <div class="track-row-title" style="font-weight: 500; font-size: 0.92rem; color: #fff;">${track.title}</div>
            <div class="track-row-artist" style="font-size: 0.8rem; color: #aaa;">${track.artist} • ${this.formatTime(track.duration)}</div>
          </div>
          <button class="btn-track-action" data-action="remove-queue" data-index="${realIndex}" title="대기열에서 삭제">
            <i data-lucide="x"></i>
          </button>
          <div class="queue-drag-handle" title="순서 이동">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line></svg>
          </div>
        </div>
      `;
    }).join('');

    this.attachQueueDragListeners();
    if (window.lucide) window.lucide.createIcons();
  }

  attachQueueDragListeners() {
    if (!this.dom.queueList) return;
    const cards = this.dom.queueList.querySelectorAll('.queue-card');
    let draggedIndex = null;
    let touchDraggedCard = null;
    let touchOverCard = null;

    cards.forEach(card => {
      const handle = card.querySelector('.queue-drag-handle');
      if (!handle) return;

      // 데스크톱 마우스 드래그 앤 드롭
      handle.addEventListener('mousedown', () => {
        card.setAttribute('draggable', 'true');
      });
      handle.addEventListener('mouseup', () => {
        card.setAttribute('draggable', 'false');
      });

      card.addEventListener('dragstart', (e) => {
        draggedIndex = parseInt(card.getAttribute('data-queue-index'), 10);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(draggedIndex));
        }
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.setAttribute('draggable', 'false');
        card.classList.remove('dragging');
        cards.forEach(c => c.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        cards.forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        cards.forEach(c => c.classList.remove('drag-over'));
        const targetIndex = parseInt(card.getAttribute('data-queue-index'), 10);
        if (draggedIndex !== null && !isNaN(targetIndex) && draggedIndex !== targetIndex) {
          if (typeof this.onQueueReorder === 'function') {
            this.onQueueReorder(draggedIndex, targetIndex);
          }
        }
        draggedIndex = null;
      });

      // 모바일 터치 드래그 앤 드롭 (= 핸들 터치 시)
      handle.addEventListener('touchstart', (e) => {
        touchDraggedCard = card;
        draggedIndex = parseInt(card.getAttribute('data-queue-index'), 10);
        card.classList.add('dragging');
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        if (!touchDraggedCard) return;
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const overCard = el ? el.closest('.queue-card') : null;
        if (overCard && overCard !== touchOverCard) {
          if (touchOverCard) touchOverCard.classList.remove('drag-over');
          touchOverCard = overCard;
          touchOverCard.classList.add('drag-over');
        }
      }, { passive: true });

      handle.addEventListener('touchend', () => {
        if (touchDraggedCard) {
          touchDraggedCard.classList.remove('dragging');
        }
        if (touchOverCard) {
          touchOverCard.classList.remove('drag-over');
          const targetIndex = parseInt(touchOverCard.getAttribute('data-queue-index'), 10);
          if (draggedIndex !== null && !isNaN(targetIndex) && draggedIndex !== targetIndex) {
            if (typeof this.onQueueReorder === 'function') {
              this.onQueueReorder(draggedIndex, targetIndex);
            }
          }
        }
        touchDraggedCard = null;
        touchOverCard = null;
        draggedIndex = null;
      });
    });
  }

  // 8. 가사(Lyrics) 렌더링 및 동기화 (전주/간주 정확히 반영)
  setLyricsLoading() {
    if (!this.dom.lyricsContainer) return;
    this.dom.lyricsContainer.innerHTML = `
      <div style="padding: 48px 16px; text-align: center; color: var(--text-muted);">
        <div class="audio-equalizer-bars active" style="position: static; margin: 0 auto 16px auto; height: 28px;">
          <span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span>
        </div>
        <p style="font-size: 1.1rem; color: #fff; font-weight: 600;">실시간 동기화 가사를 검색 중입니다...</p>
        <p style="font-size: 0.85rem; margin-top: 6px;">유튜브 & 글로벌 가사 DB에서 전주 및 싱크를 정밀 분석합니다.</p>
      </div>
    `;
    this._lastActiveLyricIndex = -1;
  }

  updateLyricsOffsetDisplay(offset = 0) {
    const el = this.dom.syncOffsetDisplay || document.getElementById('sync-offset-display');
    if (!el) return;
    const num = parseFloat(offset) || 0;
    if (Math.abs(num) < 0.05) {
      el.textContent = '±0.0s';
    } else {
      el.textContent = `${num > 0 ? '+' : ''}${num.toFixed(1)}s`;
    }
  }

  refreshLyricTimes(lyrics) {
    if (!this.dom.lyricsContainer || !Array.isArray(lyrics)) return;
    const lines = this.dom.lyricsContainer.querySelectorAll('.lyric-line');
    lines.forEach((el, idx) => {
      if (lyrics[idx]) {
        el.setAttribute('data-time', lyrics[idx].time);
        el.setAttribute('title', `${this.formatTime(lyrics[idx].time)}로 이동하기`);
      }
    });
  }

  renderLyrics(lyrics, offset = null) {
    if (!this.dom.lyricsContainer) return;
    this._lastActiveLyricIndex = -1;

    const currentTrack = this.player.getCurrentTrack();
    const currentOffset = (offset !== null) ? offset : (currentTrack?.lyricsOffset || 0);
    this.updateLyricsOffsetDisplay(currentOffset);

    if (!lyrics || lyrics.length === 0) {
      this.dom.lyricsContainer.innerHTML = `
        <div style="padding: 48px 16px; text-align: center; color: var(--text-muted);">
          <i data-lucide="music-4" style="width: 44px; height: 44px; margin-bottom: 12px; opacity: 0.5;"></i>
          <p style="font-size: 1.1rem; font-weight: 600;">등록된 실시간 싱크 가사가 없습니다.</p>
          <p style="font-size: 0.85rem; margin-top: 6px;">이 곡은 연주곡이거나 실시간 가사 제공 대상이 아닐 수 있습니다.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.dom.lyricsContainer.innerHTML = lyrics.map((line, idx) => `
      <div class="lyric-line ${line.isInstrumental ? 'instrumental' : ''}" id="lyric-${idx}" data-time="${line.time}" title="${this.formatTime(line.time)}로 이동하기">
        ${line.text}
      </div>
    `).join('');

    // 가사 라인 클릭 시 노래의 정확한 타이밍으로 즉각 이동
    this.dom.lyricsContainer.querySelectorAll('.lyric-line').forEach(el => {
      el.addEventListener('click', () => {
        const time = parseFloat(el.getAttribute('data-time'));
        if (!isNaN(time)) {
          if (typeof this.player.seekTo === 'function') {
            this.player.seekTo(time);
          } else {
            const track = this.player.getCurrentTrack();
            if (track && track.duration) {
              const percent = Math.min(100, Math.max(0, (time / track.duration) * 100));
              this.player.seekToPercent(percent);
            }
          }
          this.showToast(`가사 위치(${this.formatTime(time)})로 이동`);
        }
      });
    });
  }

  updateLyricsSync(currentTime, lyrics) {
    if (!lyrics || lyrics.length === 0) return;

    // 만약 노래가 아직 첫 가사 시작 전(전주 연주 중)이라면 첫 가사 하이라이트 방지
    let activeIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex === this._lastActiveLyricIndex) return;
    this._lastActiveLyricIndex = activeIndex;

    const lines = this.dom.lyricsContainer?.querySelectorAll('.lyric-line');
    if (!lines || lines.length === 0) return;

    lines.forEach((el, idx) => {
      const isMatch = (idx === activeIndex);
      const isPast = (idx < activeIndex);
      el.classList.toggle('active', isMatch);
      el.classList.toggle('past', isPast);
    });

    if (activeIndex >= 0 && lines[activeIndex]) {
      lines[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 실시간 비주얼 무대 자막 (Stage CC) 동기화
    const stageCcOverlay = document.getElementById('stage-cc-overlay');
    const stageCcText = document.getElementById('stage-cc-text');
    if (stageCcOverlay && stageCcText && stageCcOverlay.style.display !== 'none') {
      if (activeIndex >= 0 && lyrics[activeIndex] && lyrics[activeIndex].text) {
        stageCcText.textContent = lyrics[activeIndex].text;
      } else {
        stageCcText.textContent = '';
      }
    }
  }

  _createSearchTrackRow(track, isVideo = false) {
    const isCurrent = this.player.getCurrentTrack()?.id === track.id;
    const isLiked = this.likedTrackIds.has(track.id);
    const isWide = isVideo || track.isCompilation;

    return `
      <div class="search-card-wide track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
        <div class="${isWide ? 'search-card-thumb-wide' : 'search-card-thumb-square'}">
          <img referrerpolicy="no-referrer" src="${track.cover}" alt="${track.title}" loading="lazy" data-title="${encodeURIComponent(track.title || '')}" data-artist="${encodeURIComponent(track.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
          <div class="cover-play-overlay">
            ${isCurrent && this.player.isPlaying 
              ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
              : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
            }
          </div>
        </div>
        <div class="search-card-info">
          <div class="search-card-title">${track.title}</div>
          <div class="search-card-meta">${isWide ? (track.channel || track.artist) + ' • 동영상' : (track.artist || '노래') + (track.duration ? ' • ' + this.formatTime(track.duration) : '')}</div>
        </div>
        <button class="search-card-more-btn" data-action="track-more" data-track-id="${track.id}" title="더보기">
          <i data-lucide="more-vertical"></i>
        </button>
      </div>
    `;
  }

  // 9. 관련 음악(Related) 렌더링 (아티스트 및 장르/분위기 정밀 매칭)
  renderRelated(currentTrack, allTracks) {
    if (!this.dom.relatedList) return;
    if (!currentTrack) {
      this.dom.relatedList.innerHTML = `<p class="lyrics-placeholder">재생 중인 곡이 없습니다.</p>`;
      return;
    }

    const curArtist = (currentTrack.artist || '').toLowerCase();
    const curGenre = currentTrack.genre || '';
    const curMood = currentTrack.mood || '';

    // 1) 같은 아티스트 곡 우선 추출
    const sameArtistTracks = allTracks.filter(t => 
      t.id !== currentTrack.id && 
      t.videoId !== currentTrack.videoId &&
      (curArtist.length > 1 && (
        (t.artist || '').toLowerCase().includes(curArtist) ||
        curArtist.includes((t.artist || '').toLowerCase())
      ))
    );

    // 2) 비슷한 장르 또는 분위기 곡 추출
    const similarMoodTracks = allTracks.filter(t =>
      t.id !== currentTrack.id &&
      t.videoId !== currentTrack.videoId &&
      !sameArtistTracks.some(sa => sa.id === t.id) &&
      (t.genre === curGenre || t.mood === curMood)
    );

    // 3) 보충 추천 곡
    const fallbackTracks = allTracks.filter(t =>
      t.id !== currentTrack.id &&
      t.videoId !== currentTrack.videoId &&
      !sameArtistTracks.some(sa => sa.id === t.id) &&
      !similarMoodTracks.some(sm => sm.id === t.id)
    );

    let html = '';

    if (sameArtistTracks.length > 0) {
      html += `
        <div class="related-group" style="margin-bottom: 24px;">
          <h3 class="related-subhead">${currentTrack.artist}의 다른 곡</h3>
          <div class="related-tracks-sublist">
            ${sameArtistTracks.slice(0, 4).map(track => this._createSearchTrackRow(track)).join('')}
          </div>
        </div>
      `;
    }

    const combinedSimilar = [...similarMoodTracks, ...fallbackTracks].slice(0, 6);
    if (combinedSimilar.length > 0) {
      html += `
        <div class="related-group">
          <h3 class="related-subhead">비슷한 분위기의 맞춤 추천</h3>
          <div class="related-tracks-sublist">
            ${combinedSimilar.map(track => this._createSearchTrackRow(track)).join('')}
          </div>
        </div>
      `;
    }

    this.dom.relatedList.innerHTML = html || `<p class="lyrics-placeholder">관련 추천 음악을 찾는 중입니다...</p>`;
    if (window.lucide) window.lucide.createIcons();
  }

  // 10. 검색 결과 렌더링 (아티스트 상위 검색결과 카드 + 노래 + 동영상 분리 - 스크린샷 2 일치)
  // 10. 검색 결과 렌더링 (Screenshot 3 100% 일치: 상단 필터 칩 + 와이드/스퀘어 카드 + 더보기 버튼)
  renderSearchResults(query, searchData, isSearchingOnline = false) {
    if (!this.dom.searchResultsList) return;
    if (this.dom.searchQueryText) this.dom.searchQueryText.textContent = query;

    this.lastSearchData = { query, searchData, isSearchingOnline };
    const filter = this.currentSearchFilter || 'all';

    let tracks = [];
    let artistInfo = null;
    let songs = [];
    let videos = [];

    if (Array.isArray(searchData)) {
      tracks = searchData;
      songs = tracks.filter(t => !t.isCompilation);
      videos = tracks.filter(t => t.isCompilation);
      const qLower = query.toLowerCase().trim();
      const matchArtistTrack = tracks.find(t => (t.artist || '').toLowerCase().includes(qLower) || qLower.includes((t.artist || '').toLowerCase()));
      if (matchArtistTrack && qLower.length >= 2) {
        artistInfo = {
          name: matchArtistTrack.artist,
          subscribers: '아티스트',
          avatar: matchArtistTrack.cover
        };
      }
    } else if (searchData && typeof searchData === 'object') {
      tracks = searchData.tracks || [];
      artistInfo = searchData.artist || null;
      songs = searchData.songs || tracks.filter(t => !t.isCompilation);
      videos = searchData.videos || tracks.filter(t => t.isCompilation);
    }

    // 아티스트 검색 필터링 강화
    const targetArtistName = artistInfo?.name || query.trim();
    const artNorm = targetArtistName.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    let artistOfficialSongs = [];
    let relatedVideos = [];

    songs.forEach(s => {
      const cNorm = (s.channel || s.artist || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
      const isOfficial = s.isOfficialChannel ||
        (artNorm && (cNorm.includes(artNorm) || artNorm.includes(cNorm))) ||
        (s.channel && s.channel.toLowerCase().includes('- topic')) ||
        (s.channel && /hybe|smtown|jyp|yg|1thek|stone music|edam|starship/i.test(s.channel));

      if (isOfficial) {
        artistOfficialSongs.push(s);
      } else {
        relatedVideos.push(s);
      }
    });

    if (artistInfo && artistInfo.name && artistOfficialSongs.length > 0) {
      songs = artistOfficialSongs;
      if (relatedVideos.length > 0) {
        videos = [...relatedVideos, ...videos];
      }
    }

    if (tracks.length === 0) {
      if (isSearchingOnline) {
        this.dom.searchResultsList.innerHTML = `
          <div style="padding: 48px; text-align: center; color: var(--text-muted);">
            <div class="audio-equalizer-bars active" style="position: static; margin: 0 auto 16px auto; height: 24px;">
              <span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span>
            </div>
            <p style="font-size: 1.1rem; color: #fff;">YouTube에서 공식 음원 및 아티스트를 검색하는 중...</p>
          </div>
        `;
        return;
      }

      this.dom.searchResultsList.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <p style="font-size: 1.1rem;">"${query}"에 대한 검색 결과가 없습니다.</p>
        </div>
      `;
      return;
    }

    let html = '';

    // 필터별 분기 렌더링 (Screenshot 3 카테고리 칩 연동)
    if (filter === 'song') {
      html += `
        <div class="section-container" style="margin-bottom: 24px;">
          <div class="search-songs-list">
            ${(songs.length > 0 ? songs : tracks).map(t => this._createSearchTrackRow(t, false)).join('')}
          </div>
        </div>
      `;
    } else if (filter === 'video') {
      const displayVideos = videos.length > 0 ? videos : tracks.filter(t => t.videoId || t.isCompilation);
      html += `
        <div class="section-container" style="margin-bottom: 24px;">
          <div class="search-videos-list">
            ${displayVideos.map(t => this._createSearchTrackRow(t, true)).join('')}
          </div>
        </div>
      `;
    } else if (filter === 'playlist') {
      const playlists = tracks.filter(t => t.isCompilation || (t.title || '').toLowerCase().includes('playlist') || (t.channel || '').toLowerCase().includes('playlist'));
      const displayPlaylists = playlists.length > 0 ? playlists : videos;
      html += `
        <div class="section-container" style="margin-bottom: 24px;">
          <div class="search-videos-list">
            ${displayPlaylists.map(t => this._createSearchTrackRow(t, true)).join('')}
          </div>
        </div>
      `;
    } else if (filter === 'album') {
      // 앨범별 그룹화
      const albumMap = new Map();
      tracks.forEach(t => {
        const albumName = t.album || '싱글 및 EP';
        if (!albumMap.has(albumName)) {
          albumMap.set(albumName, { title: albumName, artist: t.artist, cover: t.cover, track: t });
        }
      });
      html += `
        <div class="section-container" style="margin-bottom: 24px;">
          <div class="cards-horizontal-scroll" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px;">
            ${Array.from(albumMap.values()).map(alb => `
              <div class="music-card" data-track-id="${alb.track.id}">
                <div class="card-cover-wrapper">
                  <img referrerpolicy="no-referrer" src="${alb.cover}" alt="${alb.title}" loading="lazy" data-title="${encodeURIComponent(alb.title || '')}" data-artist="${encodeURIComponent(alb.artist || '')}" onload="if(typeof window.validateTrackImg==='function')window.validateTrackImg(this);" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
                  <div class="card-float-play-btn" data-action="play" title="재생">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="7 5 19 12 7 19 7 5"></polygon></svg>
                  </div>
                </div>
                <div class="card-title">${alb.title}</div>
                <div class="card-subtitle">앨범 • ${alb.artist}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      // 전체 (all) 모드
      if (artistInfo && artistInfo.name) {
        const topArtistTracks = (songs.length > 0 ? songs : tracks).slice(0, 3);
        html += `
          <div class="section-container" style="margin-bottom: 28px;">
            <h2 class="section-title" style="font-size: 1.2rem; margin-bottom: 14px;">상위 검색결과</h2>
            <div class="artist-top-card" id="artist-top-card" data-artist="${artistInfo.name}">
              <div class="artist-top-header" id="btn-search-artist-header" title="${artistInfo.name}의 모든 노래 보러가기">
                <img referrerpolicy="no-referrer" src="${artistInfo.avatar || topArtistTracks[0]?.cover || ''}" alt="${artistInfo.name}" class="artist-top-avatar" onerror="this.onerror=null;if(typeof window.handleArtistImgError==='function'){window.handleArtistImgError(this, '${(artistInfo.name || '').replace(/'/g, "\\'")}');}">
                <div class="artist-top-info">
                  <div class="artist-top-name" id="btn-search-artist-name-title">${artistInfo.name}</div>
                  <div class="artist-top-subs">${artistInfo.subscribers || '아티스트'} • 채널 보기</div>
                </div>
              </div>
              <div class="artist-top-actions">
                <button class="btn-artist-action btn-shuffle" id="btn-search-artist-shuffle" title="아티스트 음악 전체 셔플">
                  <i data-lucide="shuffle" style="width: 16px; height: 16px;"></i>
                  <span>셔플</span>
                </button>
                <button class="btn-artist-action btn-station" id="btn-search-artist-station" title="아티스트 뮤직 스테이션 라디오">
                  <span style="font-size: 1.1rem; line-height: 1;">((•))</span>
                  <span>뮤직 스테이션</span>
                </button>
              </div>
              <div class="artist-top-tracks">
                ${topArtistTracks.map(t => this._createSearchTrackRow(t, false)).join('')}
              </div>
              <button class="btn-view-all-artist-songs" id="btn-view-all-artist-songs" title="${artistInfo.name} 노래 전체보기">
                <span>${artistInfo.name} 노래 전체보기</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
        `;
        
        const restSongs = songs.slice(3);
        if (restSongs.length > 0) {
          html += `
            <div class="section-container" style="margin-bottom: 28px;">
              <div class="section-header" style="margin-bottom: 12px;">
                <h2 class="section-title">노래</h2>
              </div>
              <div class="search-songs-list">
                ${restSongs.map(t => this._createSearchTrackRow(t, false)).join('')}
              </div>
            </div>
          `;
        }
      } else {
        html += `
          <div class="section-container" style="margin-bottom: 28px;">
            <div class="section-header" style="margin-bottom: 12px;">
              <h2 class="section-title">노래</h2>
            </div>
            <div class="search-songs-list">
              ${(songs.length > 0 ? songs : tracks).map(t => this._createSearchTrackRow(t, false)).join('')}
            </div>
          </div>
        `;
      }

      if (videos.length > 0) {
        html += `
          <div class="section-container" style="margin-top: 24px;">
            <div class="section-header" style="margin-bottom: 12px;">
              <h2 class="section-title">동영상</h2>
            </div>
            <div class="search-videos-list">
              ${videos.map(t => this._createSearchTrackRow(t, true)).join('')}
            </div>
          </div>
        `;
      }
    }

    this.dom.searchResultsList.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();

    // 아티스트 이름 또는 카드 헤더 클릭 시 아티스트 상세 곡 목록 뷰로 이동 (사용자 요청 2번)
    const artistTopCard = document.getElementById('artist-top-card');
    if (artistTopCard && artistInfo) {
      const allArtistSongs = (artistOfficialSongs && artistOfficialSongs.length > 0) ? artistOfficialSongs : (songs.length > 0 ? songs : tracks);
      const onOpenArtist = (e) => {
        // 셔플/스테이션/트랙 클릭 제외
        if (e.target.closest('#btn-search-artist-shuffle') || e.target.closest('#btn-search-artist-station') || e.target.closest('.search-card-wide') || e.target.closest('.track-row-card')) {
          return;
        }
        e.stopPropagation();
        this.openArtistView(artistInfo, allArtistSongs);
      };

      const btnHeader = document.getElementById('btn-search-artist-header');
      const btnViewAll = document.getElementById('btn-view-all-artist-songs');
      if (btnHeader) btnHeader.addEventListener('click', onOpenArtist);
      if (btnViewAll) btnViewAll.addEventListener('click', onOpenArtist);
    }
  }

  // 11. 둘러보기 분위기/장르 상세 패널 렌더링
  renderGenreDetail(genreName, genreColor, tracks) {
    if (!this.dom.exploreGenreDetail || !this.dom.exploreMainGenres) return;
    this.dom.exploreMainGenres.style.display = 'none';
    this.dom.exploreGenreDetail.style.display = 'block';

    if (this.dom.genreDetailTitle) this.dom.genreDetailTitle.textContent = genreName;
    if (this.dom.genreDetailDesc) this.dom.genreDetailDesc.textContent = `${genreName} 분위기에 맞춘 실시간 추천 트랙 컬렉션입니다.`;

    const hero = document.getElementById('genre-detail-hero');
    if (hero && genreColor) {
      hero.style.background = `linear-gradient(135deg, ${genreColor} 0%, rgba(20, 20, 30, 0.95) 100%)`;
    }

    if (this.dom.genreTracksList) {
      if (!tracks || tracks.length === 0) {
        this.dom.genreTracksList.innerHTML = `<p class="lyrics-placeholder">추천 곡을 불러오는 중입니다...</p>`;
      } else {
        this.dom.genreTracksList.innerHTML = tracks.map(track => this._createSearchTrackRow(track)).join('');
      }
    }
    if (window.lucide) window.lucide.createIcons();
  }

  closeGenreDetail() {
    if (this.dom.exploreGenreDetail) this.dom.exploreGenreDetail.style.display = 'none';
    if (this.dom.exploreMainGenres) this.dom.exploreMainGenres.style.display = 'block';
  }

  // 현재 재생 중인 트랙 UI 업데이트
  updateCurrentTrackUI(track) {
    if (!track) return;

    if (this.dom.coverImg) {
      this.dom.coverImg.src = track.cover;
      this.dom.coverImg.dataset.title = encodeURIComponent(track.title || '');
      this.dom.coverImg.dataset.artist = encodeURIComponent(track.artist || '');
      this.dom.coverImg.dataset.vid = track.videoId || '';
      delete this.dom.coverImg.dataset.fallbackApplied;
      delete this.dom.coverImg.dataset.itunesAttempted;
    }
    if (this.dom.titleText) this.dom.titleText.textContent = track.title;
    if (this.dom.artistText) this.dom.artistText.textContent = `${track.artist} • ${track.album}`;
    if (this.dom.durationTimeText) this.dom.durationTimeText.textContent = this.formatTime(track.duration);

    if (this.dom.modalCover) {
      this.dom.modalCover.src = track.cover;
      this.dom.modalCover.dataset.title = encodeURIComponent(track.title || '');
      this.dom.modalCover.dataset.artist = encodeURIComponent(track.artist || '');
      this.dom.modalCover.dataset.vid = track.videoId || '';
      delete this.dom.modalCover.dataset.fallbackApplied;
      delete this.dom.modalCover.dataset.itunesAttempted;
    }
    if (this.dom.modalTitle) this.dom.modalTitle.textContent = track.title;
    if (this.dom.modalArtist) this.dom.modalArtist.textContent = track.artist;

    this.updateLikeButtons(track.id);

    // 텍스트 Marquee 오버플로우 감지 및 부드러운 가로 스크롤 적용 (사용자 요청 3번)
    this.applyMarqueeIfOverflow(this.dom.titleText);
    this.applyMarqueeIfOverflow(this.dom.modalTitle);
    const sheetTitle = document.getElementById('sheet-track-title');
    if (sheetTitle) this.applyMarqueeIfOverflow(sheetTitle);

    // 유튜브 실시간 좋아요 수 및 댓글 수 갱신 (사용자 요청 6번)
    let vid = track.videoId;
    if (!vid && track.id) {
      if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
        const found = window.allTracks.find(t => t.id === track.id);
        if (found && found.videoId) vid = found.videoId;
      }
      if (!vid && typeof track.id === 'string') {
        vid = track.id.replace(/^yt-/, '');
      }
    }
    this.updateVideoDetails(vid);

    // 시청 / 감상 기록 중복 제거 및 최상단 등록 후 localStorage 영구 보관 (가사 대용량 배열 제외하여 쿼터 안전 보장)
    const existingIndex = this.playHistory.findIndex(t => t.id === track.id || (t.videoId && t.videoId === track.videoId));
    if (existingIndex >= 0) {
      this.playHistory.splice(existingIndex, 1);
    }
    const cleanHistoryTrack = {
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
    };
    this.playHistory.unshift(cleanHistoryTrack);
    if (this.playHistory.length > 50) this.playHistory.pop();
    try {
      localStorage.setItem('streamvance_play_history', JSON.stringify(this.playHistory));
    } catch (e) {}

    // 보관함의 최근 재생한 곡 탭을 보고 있다면 실시간 갱신
    if (this.currentView === 'library') {
      const activeTab = document.querySelector('.lib-tab.active');
      if (activeTab && activeTab.getAttribute('data-lib') === 'history') {
        this.renderLibrary('history');
      }
    }
  }

  // 텍스트 길이 초과 시 매끄러운 Marquee 단방향 흐름 애니메이션 적용 (글자 잘림 없이 전체 텍스트 온전히 노출)
  applyMarqueeIfOverflow(el) {
    if (!el) return;
    el.classList.remove('marquee-active');
    el.style.removeProperty('--marquee-distance');
    requestAnimationFrame(() => {
      const parent = el.parentElement;
      const parentWidth = parent ? parent.clientWidth : el.clientWidth;
      const scrollWidth = el.scrollWidth;
      if (scrollWidth > parentWidth + 2) {
        const diff = Math.max(20, scrollWidth - parentWidth + 30);
        el.style.setProperty('--marquee-distance', `-${diff}px`);
        el.classList.add('marquee-active');
      }
    });
  }

  // 아티스트 전용 상세 뷰 열기 (사용자 요청 2번)
  openArtistView(artistInfo, initialTracks = []) {
    if (!artistInfo || !artistInfo.name) return;

    const heroAvatar = document.getElementById('artist-hero-avatar');
    const heroName = document.getElementById('artist-hero-name');
    const heroSubs = document.getElementById('artist-hero-subs');
    const tracksList = document.getElementById('artist-full-tracks-list');
    const countBadge = document.getElementById('artist-track-count-badge');

    if (heroAvatar) heroAvatar.src = artistInfo.avatar || initialTracks[0]?.cover || '';
    if (heroName) heroName.textContent = artistInfo.name;
    if (heroSubs) heroSubs.textContent = artistInfo.subscribers || '아티스트';

    this.currentArtist = artistInfo;
    this.currentArtistTracks = [...initialTracks];

    if (tracksList) {
      tracksList.innerHTML = this.currentArtistTracks.map(t => this._createSearchTrackRow(t, false)).join('');
    }
    if (countBadge) countBadge.textContent = `${this.currentArtistTracks.length}곡`;

    this.switchView('artist');

    // 비동기 추가 곡 25~30곡 보강
    if (this.onFetchMoreArtistSongs && typeof this.onFetchMoreArtistSongs === 'function') {
      this.onFetchMoreArtistSongs(artistInfo.name, (moreTracks) => {
        if (!moreTracks || moreTracks.length === 0) return;
        moreTracks.forEach(t => {
          if (!this.currentArtistTracks.find(item => item.id === t.id || (item.videoId && item.videoId === t.videoId))) {
            this.currentArtistTracks.push(t);
          }
        });
        if (tracksList) {
          tracksList.innerHTML = this.currentArtistTracks.map(t => this._createSearchTrackRow(t, false)).join('');
        }
        if (countBadge) countBadge.textContent = `${this.currentArtistTracks.length}곡`;
      });
    }
  }

  // 유튜브 실시간 영상 메타 (좋아요 수, 댓글 수) 갱신
  async updateVideoDetails(videoId) {
    const likeCountEl = document.getElementById('pill-like-count');
    const commentCountEl = document.getElementById('pill-comment-count');
    const barLikeCountEl = document.getElementById('player-bar-like-count');
    const barCommentCountEl = document.getElementById('player-bar-comment-count');
    const modalLikeCountEl = document.getElementById('modal-like-count');
    const sheetCount = document.getElementById('comments-sheet-total-count');

    // 커스텀 ID(track-xxx) 방어: allTracks에서 실제 유튜브 videoId 조회
    if (videoId && (videoId.startsWith('track-') || !videoId.match(/^[a-zA-Z0-9_-]{11}$/))) {
      if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
        const found = window.allTracks.find(t => t.id === videoId || t.videoId === videoId);
        if (found && found.videoId) videoId = found.videoId;
      }
    }

    if (modalLikeCountEl) {
      modalLikeCountEl.textContent = '';
      modalLikeCountEl.style.display = 'none';
    }

    if (!videoId) {
      if (likeCountEl) likeCountEl.textContent = '좋아요';
      if (barLikeCountEl) {
        barLikeCountEl.textContent = '';
        barLikeCountEl.style.display = 'none';
      }
      if (commentCountEl) commentCountEl.textContent = '댓글';
      if (barCommentCountEl) {
        barCommentCountEl.textContent = '';
        barCommentCountEl.style.display = 'none';
      }
      if (sheetCount) sheetCount.textContent = '0';
      return;
    }

    try {
      // Cloudflare Pages 및 Python 서버 양쪽 모두 100% 호환되도록 id와 videoId 둘 다 전송
      const res = await fetch(`/api/video-details?id=${encodeURIComponent(videoId)}&videoId=${encodeURIComponent(videoId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.likeCount && data.likeCount !== '좋아요') {
          if (likeCountEl) likeCountEl.textContent = data.likeCount;
          if (barLikeCountEl) {
            barLikeCountEl.textContent = data.likeCount;
            barLikeCountEl.style.display = 'inline-block';
          }
        } else {
          if (likeCountEl) likeCountEl.textContent = '좋아요';
          if (barLikeCountEl) barLikeCountEl.style.display = 'none';
        }

        if (data.commentCount && data.commentCount !== '댓글') {
          if (commentCountEl) commentCountEl.textContent = data.commentCount;
          if (barCommentCountEl) {
            barCommentCountEl.textContent = data.commentCount;
            barCommentCountEl.style.display = 'inline-block';
          }
          if (sheetCount) sheetCount.textContent = data.commentCount;
        } else {
          if (commentCountEl) commentCountEl.textContent = '댓글';
          if (barCommentCountEl) barCommentCountEl.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn("Video details load error:", e);
    }
  }

  // 유튜브 실시간 댓글 바텀시트 열기
  async openCommentsSheet(videoId, sort = 'top') {
    const modal = document.getElementById('comments-sheet-modal');
    if (!modal) return;
    modal.classList.add('open');

    // 커스텀 ID(track-xxx) 방어: allTracks에서 실제 유튜브 videoId 조회
    if (videoId && (videoId.startsWith('track-') || !videoId.match(/^[a-zA-Z0-9_-]{11}$/))) {
      if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
        const found = window.allTracks.find(t => t.id === videoId || t.videoId === videoId);
        if (found && found.videoId) videoId = found.videoId;
      }
    }

    this.currentCommentsVideoId = videoId;
    this.currentCommentsSort = sort;

    const btnTop = document.getElementById('btn-comments-sort-top');
    const btnNew = document.getElementById('btn-comments-sort-new');
    if (btnTop && btnNew) {
      btnTop.classList.toggle('active', sort === 'top');
      btnNew.classList.toggle('active', sort === 'new');
    }

    const loading = document.getElementById('comments-loading');
    const list = document.getElementById('comments-items-list');
    if (loading) loading.style.display = 'flex';
    if (list) list.innerHTML = '';

    if (!videoId) {
      if (loading) loading.style.display = 'none';
      if (list) list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">유튜브 영상 트랙이 아닙니다.</p>';
      return;
    }

    try {
      const res = await fetch(`/api/comments?id=${encodeURIComponent(videoId)}&sort=${sort}`);
      if (loading) loading.style.display = 'none';
      if (res.ok) {
        const data = await res.json();
        if (data.disabled) {
          if (list) {
            list.innerHTML = `
              <div style="text-align: center; color: var(--text-muted); padding: 50px 20px;">
                <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto;">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><circle cx="12" cy="10" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                </div>
                <p style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 6px;">댓글 사용 중지됨</p>
                <p style="font-size: 13px; line-height: 1.5; color: var(--text-muted);">${data.disabledMessage || '이 동영상(음원)은 유튜브 정책에 의해 댓글이 사용 중지되어 있습니다.'}</p>
              </div>
            `;
          }
        } else {
          this.renderCommentsList(data.comments || []);
        }
        if (data.commentCount) {
          const sheetCount = document.getElementById('comments-sheet-total-count');
          const pillCount = document.getElementById('pill-comment-count');
          const barCommentCount = document.getElementById('player-bar-comment-count');
          if (sheetCount) sheetCount.textContent = data.commentCount;
          if (pillCount) pillCount.textContent = data.commentCount;
          if (barCommentCount) {
            barCommentCount.textContent = data.commentCount;
            barCommentCount.style.display = 'inline-block';
          }
        }
      } else {
        if (list) list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">댓글을 불러오지 못했습니다.</p>';
      }
    } catch (e) {
      if (loading) loading.style.display = 'none';
      if (list) list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">댓글을 불러오는 중 오류가 발생했습니다.</p>';
    }
  }

  // 모바일 Pull-to-Refresh 당겨서 새로고침 제스처 바인딩 (YouTube Music UI 일치)
  initPullToRefresh(onRefresh) {
    const bar = document.getElementById('pull-to-refresh-bar');
    const icon = document.getElementById('pull-refresh-icon');
    const scrollContainer = document.getElementById('content-scroll-area');
    if (!bar || !icon || !scrollContainer) return;

    let startY = 0;
    let isPulling = false;
    let isRefreshing = false;
    let pullDistance = 0;
    const threshold = 55;

    const onTouchStart = (e) => {
      if (isRefreshing) return;
      if (scrollContainer.scrollTop <= 2 && window.scrollY <= 2) {
        startY = e.touches[0].pageY;
        isPulling = true;
      }
    };

    const onTouchMove = (e) => {
      if (!isPulling || isRefreshing) return;
      const currentY = e.touches[0].pageY;
      const diff = currentY - startY;

      if (diff > 0 && scrollContainer.scrollTop <= 2) {
        pullDistance = Math.min(80, diff * 0.45);
        bar.classList.add('pulling');
        bar.style.height = `${pullDistance}px`;
        bar.style.opacity = `${Math.min(1, pullDistance / 35)}`;
        bar.style.transform = `translateY(${Math.min(0, pullDistance - 45)}px)`;
        icon.style.transform = `rotate(${pullDistance * 4.5}deg)`;
        if (e.cancelable && diff > 10) {
          e.preventDefault();
        }
      } else {
        isPulling = false;
        bar.classList.remove('pulling');
        bar.style.height = '0px';
      }
    };

    const onTouchEnd = async () => {
      if (!isPulling || isRefreshing) return;
      isPulling = false;
      bar.classList.remove('pulling');

      if (pullDistance >= threshold) {
        isRefreshing = true;
        bar.classList.add('refreshing');
        bar.style.height = '52px';
        bar.style.opacity = '1';
        bar.style.transform = 'translateY(0)';

        try {
          if (typeof onRefresh === 'function') {
            await onRefresh();
          }
        } catch (err) {
          console.warn("Pull-to-refresh error:", err);
        }

        setTimeout(() => {
          bar.classList.remove('refreshing');
          bar.style.height = '0px';
          bar.style.opacity = '0';
          bar.style.transform = 'translateY(-20px)';
          icon.style.transform = 'rotate(0deg)';
          isRefreshing = false;
          this.showToast('최신 음악 피드를 새로고침했습니다.');
        }, 600);
      } else {
        bar.style.height = '0px';
        bar.style.opacity = '0';
        bar.style.transform = 'translateY(-20px)';
        icon.style.transform = 'rotate(0deg)';
      }
      pullDistance = 0;
    };

    scrollContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollContainer.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollContainer.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  renderCommentsList(comments) {
    const list = document.getElementById('comments-items-list');
    if (!list) return;

    if (!comments || comments.length === 0) {
      list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">작성된 댓글이 없거나 로드할 수 없습니다.</p>';
      return;
    }

    list.innerHTML = comments.map(c => `
      <div class="comment-card-item">
        <img referrerpolicy="no-referrer" src="${c.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80'}" alt="${c.author}" class="comment-card-avatar" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80';">
        <div class="comment-card-main">
          <div class="comment-card-header">
            <span class="comment-card-author">${c.author || '@user'}</span>
            <span class="comment-card-time">• ${c.publishedText || '최근'}</span>
          </div>
          <div class="comment-card-content">${this.escapeHTML(c.content || '')}</div>
          <div class="comment-card-actions">
            <div class="comment-like-wrap">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
              <span>${c.likeCount || '0'}</span>
            </div>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor: pointer;"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
            ${c.replyCount > 0 ? `<span class="comment-replies-link">답글 ${c.replyCount}개 모두 보기</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // 재생 / 일시정지 상태 아이콘 변경 (삼각형 ▶ vs 젓가락 두 개 ⏸ 완벽 렌더링)
  updatePlayStateUI(isPlaying) {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) {
      if (isPlaying) {
        // 일시정지: 젓가락처럼 일자 두 개 (Pause ⏸)
        playBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"></rect>
            <rect x="14" y="4" width="4" height="16" rx="1"></rect>
          </svg>
        `;
        playBtn.setAttribute('title', '일시정지 (스페이스바)');
      } else {
        // 재생: 삼각형 (Play ▶)
        playBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        `;
        playBtn.setAttribute('title', '재생 (스페이스바)');
      }
    }

    if (this.dom.eqBars) {
      this.dom.eqBars.classList.toggle('active', isPlaying);
    }

    // 모든 트랙 카드의 플레이 오버레이 아이콘도 일관되게 갱신
    document.querySelectorAll('.track-row-card').forEach(card => {
      const cardTrackId = card.getAttribute('data-track-id');
      const isCurrent = cardTrackId === this.player.getCurrentTrack()?.id;
      card.classList.toggle('playing', isCurrent);
      const overlay = card.querySelector('.cover-play-overlay');
      if (overlay) {
        if (isCurrent && isPlaying) {
          overlay.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;
        } else {
          overlay.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;
        }
      }
    });
  }

  updateProgressUI(currentTime, duration, percent, bufferPercent = 0) {
    if (this.dom.currentTimeText) this.dom.currentTimeText.textContent = this.formatTime(currentTime);
    if (this.dom.durationTimeText && duration > 0) this.dom.durationTimeText.textContent = this.formatTime(duration);
    if (this.dom.progressBar) this.dom.progressBar.style.width = `${percent}%`;
    
    // 버퍼 진행 바 갱신
    const bufferBar = document.getElementById('seek-buffer-bar');
    if (bufferBar && bufferPercent > 0) {
      bufferBar.style.width = `${Math.min(100, Math.max(0, bufferPercent))}%`;
    }

    if (this.dom.seekSlider && !this.isSeeking) {
      this.dom.seekSlider.value = percent;
    }

    const currentTrack = this.player.getCurrentTrack();
    if (currentTrack?.lyrics) {
      this.updateLyricsSync(currentTime, currentTrack.lyrics);
    }
  }
}
