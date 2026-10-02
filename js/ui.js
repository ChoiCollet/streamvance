// ==========================================================================
// UI Rendering, Interactions, and View Management (YouTube Music PC 100% Match)
// ==========================================================================

import { sampleTracks } from './data.js';

// 전역 썸네일 장애 방지 복구 핸들러 (hqdefault -> mqdefault -> SVG fallback)
if (typeof window !== 'undefined') {
  window.handleTrackImgError = function(img) {
    if (!img) return;
    const src = img.src || '';
    if (src.includes('maxresdefault.jpg')) {
      img.src = src.replace('maxresdefault.jpg', 'hqdefault.jpg');
    } else if (src.includes('hqdefault.jpg')) {
      img.src = src.replace('hqdefault.jpg', 'mqdefault.jpg');
    } else if (!img.dataset.fallbackApplied) {
      img.dataset.fallbackApplied = 'true';
      img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100%25' height='100%25'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%231f1c2c'/%3E%3Cstop offset='100%25' stop-color='%23928dab'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3Cpath d='M40 68a8 8 0 1 1-4-6.9V32l24-6v30a8 8 0 1 1-4-6.9V37l-16 4v27z' fill='%23ffffff' opacity='0.85'/%3E%3C/svg%3E";
    }
  };
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
        search: document.getElementById('view-search')
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
      btnVideoTheater: document.getElementById('btn-video-theater'),
      btnVideoFs: document.getElementById('btn-video-fs'),
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
      this.showToast(`'${track.title}' 좋아요 표시한 음악에 추가됨`);
    }
    try {
      localStorage.setItem('streamvance_liked_tracks', JSON.stringify(Array.from(this.likedTracksMap.values())));
    } catch (e) {}

    this.updateLikeButtons(track.id);
    this.updateLikesCount();
    if (this.currentView === 'library') {
      const activeTab = document.querySelector('.lib-tab.active');
      const tabType = activeTab ? activeTab.getAttribute('data-lib') : 'likes';
      this.renderLibrary(tabType);
    }
  }

  updateLikesCount() {
    if (this.dom.likesCount) {
      this.dom.likesCount.textContent = this.likedTracksMap.size;
    }
  }

  updateLikeButtons(currentTrackId) {
    const isLiked = this.likedTrackIds.has(currentTrackId);
    if (this.dom.likeBtn) {
      this.dom.likeBtn.classList.toggle('liked', isLiked);
    }
    if (this.dom.modalLikeBtn) {
      this.dom.modalLikeBtn.classList.toggle('liked', isLiked);
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
            <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
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

  // 2. 다시 듣기 렌더링 (대형 정사각 앨범 카드 + 화이트 재생 삼각형 - 스크린샷 일치)
  renderRecommendedAlbums(albums, allTracks) {
    if (!this.dom.recommendedAlbumsList) return;
    this.dom.recommendedAlbumsList.innerHTML = albums.map(album => `
      <div class="music-card" data-album-id="${album.id}">
        <div class="card-cover-wrapper">
          <img src="${album.cover}" alt="${album.title}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
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
  }

  // 3. 아티스트 스포트라이트 (아래 아티스트를 좋아한다면)
  renderSpotlight(artistTracks) {
    if (!this.dom.spotlightTracksList) return;
    this.dom.spotlightTracksList.innerHTML = artistTracks.slice(0, 18).map(track => `
      <div class="music-card" data-track-id="${track.id}">
        <div class="card-cover-wrapper">
          <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
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
    this.dom.spotlightArtistChips.innerHTML = artists.map((artist, idx) => `
      <button class="artist-chip ${idx === currentIndex ? 'active' : ''}" data-artist-index="${idx}">
        <img class="artist-chip-avatar" src="${artist.image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" alt="${artist.name}" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100';">
        <span>${artist.name}</span>
      </button>
    `).join('');

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
        <img class="chart-cover" src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(this.src.includes('maxresdefault.jpg'))this.src=this.src.replace('maxresdefault.jpg','hqdefault.jpg');">
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
      <div class="genre-card" style="background: ${g.color}; padding: 24px; border-radius: 8px; font-weight: 700; font-size: 1.1rem; cursor: pointer;" data-genre-mood="${g.mood}">
        <span>${g.name}</span>
      </div>
    `).join('');
  }

  // 6. 보관함 렌더링 (좋아요 표시한 곡 & 시청/감상 기록 100% 실시간 반영)
  renderLibrary(tabType = 'likes', allTracks = []) {
    if (!this.dom.libraryContent) return;
    let targetTracks = [];

    if (tabType === 'likes') {
      targetTracks = Array.from(this.likedTracksMap.values());
    } else if (tabType === 'history') {
      targetTracks = this.playHistory;
    } else if (tabType === 'local') {
      targetTracks = this.localFiles;
    }

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
      <div class="quick-picks-grid-ytm" style="grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
        ${targetTracks.map(track => {
          const isCurrent = this.player.getCurrentTrack()?.id === track.id;
          const isLiked = this.likedTrackIds.has(track.id);
          return `
            <div class="track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
              <div class="track-row-cover">
                <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
                <div class="cover-play-overlay">
                  ${isCurrent && this.player.isPlaying 
                    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
                    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
                  }
                </div>
              </div>
              <div class="track-row-info">
                <div class="track-row-title">${track.title}</div>
                <div class="track-row-artist">${track.artist} • ${track.album || ''}</div>
              </div>
              <span class="track-row-duration">${this.formatTime(track.duration)}</span>
              <div class="track-row-actions">
                ${tabType === 'history' ? `
                  <button class="btn-track-action btn-delete-history" data-action="delete-history" data-track-id="${track.id}" title="기록에서 삭제">
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

    if (queue.length === 0) {
      this.dom.queueList.innerHTML = `<p class="lyrics-placeholder">대기열이 비어있습니다.</p>`;
      return;
    }

    this.dom.queueList.innerHTML = queue.map((track, index) => {
      const isPlaying = (index === currentIndex);
      return `
        <div class="track-row-card queue-card ${isPlaying ? 'playing active' : ''}" data-queue-index="${index}">
          <div class="track-row-cover" style="width: 44px; height: 44px; position: relative;">
            <img src="${track.cover}" alt="${track.title}">
            ${isPlaying ? `
              <div class="queue-speaker-overlay" style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; color: #fff;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" fill="none"></path>
                </svg>
              </div>
            ` : `
              <div class="cover-play-overlay">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
              </div>
            `}
          </div>
          <div class="track-row-info">
            <div class="track-row-title" style="font-weight: ${isPlaying ? '700' : '500'}; font-size: 0.92rem;">${track.title}</div>
            <div class="track-row-artist" style="font-size: 0.8rem; color: #aaa;">${track.artist}</div>
          </div>
          <span class="track-row-duration" style="font-size: 0.82rem; color: #888;">${this.formatTime(track.duration)}</span>
          <button class="btn-track-action" data-action="remove-queue" data-index="${index}" title="대기열에서 삭제">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;
    }).join('');

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
  }

  _createSearchTrackRow(track) {
    const isCurrent = this.player.getCurrentTrack()?.id === track.id;
    const isLiked = this.likedTrackIds.has(track.id);
    return `
      <div class="track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
        <div class="track-row-cover">
          <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(typeof window.handleTrackImgError==='function'){window.handleTrackImgError(this);}">
          <div class="cover-play-overlay">
            ${isCurrent && this.player.isPlaying 
              ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
              : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
            }
          </div>
        </div>
        <div class="track-row-info">
          <div class="track-row-title">${track.title}</div>
          <div class="track-row-artist">노래 • ${track.artist} ${track.duration ? '• ' + this.formatTime(track.duration) : ''}</div>
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
  renderSearchResults(query, searchData, isSearchingOnline = false) {
    if (!this.dom.searchResultsList) return;
    if (this.dom.searchQueryText) this.dom.searchQueryText.textContent = query;

    let tracks = [];
    let artistInfo = null;
    let songs = [];
    let videos = [];

    if (Array.isArray(searchData)) {
      tracks = searchData;
      songs = tracks.filter(t => !t.isCompilation);
      videos = tracks.filter(t => t.isCompilation);
      // 아티스트 검색 감지: 트랙들의 아티스트와 검색어 일치 여부 확인
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

    // 아티스트 검색 필터링 강화: 아티스트 검색 시 그 아티스트 공식 채널 및 레이블 공식 음원만 우선 선별
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

    // 1. 아티스트 상위 검색결과 카드 (스크린샷 2 100% 일치)
    if (artistInfo && artistInfo.name) {
      const topArtistTracks = (songs.length > 0 ? songs : tracks).slice(0, 3);
      html += `
        <div class="section-container" style="margin-bottom: 28px;">
          <h2 class="section-title" style="font-size: 1.2rem; margin-bottom: 14px;">상위 검색결과</h2>
          <div class="artist-top-card" id="artist-top-card" data-artist="${artistInfo.name}">
            <div class="artist-top-header">
              <img src="${artistInfo.avatar || topArtistTracks[0]?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" alt="${artistInfo.name}" class="artist-top-avatar" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100';">
              <div class="artist-top-info">
                <div class="artist-top-name">${artistInfo.name}</div>
                <div class="artist-top-subs">${artistInfo.subscribers || '아티스트'}</div>
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
              ${topArtistTracks.map(t => this._createSearchTrackRow(t)).join('')}
            </div>
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
              ${restSongs.map(t => this._createSearchTrackRow(t)).join('')}
            </div>
          </div>
        `;
      }
    } else {
      // 일반 곡 검색: 노래 섹션
      html += `
        <div class="section-container" style="margin-bottom: 28px;">
          <div class="section-header" style="margin-bottom: 12px;">
            <h2 class="section-title">노래</h2>
          </div>
          <div class="search-songs-list">
            ${(songs.length > 0 ? songs : tracks).map(t => this._createSearchTrackRow(t)).join('')}
          </div>
        </div>
      `;
    }

    // 동영상 / 컴필레이션 섹션 (스크린샷 1 일치)
    if (videos.length > 0) {
      html += `
        <div class="section-container" style="margin-top: 24px;">
          <div class="section-header" style="margin-bottom: 12px;">
            <h2 class="section-title">동영상</h2>
          </div>
          <div class="search-videos-list">
            ${videos.map(t => this._createSearchTrackRow(t)).join('')}
          </div>
        </div>
      `;
    }

    this.dom.searchResultsList.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
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

    if (this.dom.coverImg) this.dom.coverImg.src = track.cover;
    if (this.dom.titleText) this.dom.titleText.textContent = track.title;
    if (this.dom.artistText) this.dom.artistText.textContent = `${track.artist} • ${track.album}`;
    if (this.dom.durationTimeText) this.dom.durationTimeText.textContent = this.formatTime(track.duration);

    if (this.dom.modalCover) this.dom.modalCover.src = track.cover;
    if (this.dom.modalTitle) this.dom.modalTitle.textContent = track.title;
    if (this.dom.modalArtist) this.dom.modalArtist.textContent = track.artist;

    this.updateLikeButtons(track.id);

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
