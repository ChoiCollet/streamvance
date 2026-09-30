// ==========================================================================
// UI Rendering, Interactions, and View Management (YouTube Music PC 100% Match)
// ==========================================================================

export class UIManager {
  constructor(player) {
    this.player = player;
    this.currentView = 'home';
    this.likedTrackIds = new Set(['track-hypeboy', 'track-blue-flame', 'track-apt', 'track-supernova']);
    this.playHistory = [];
    this.localFiles = [];
    this._lastActiveLyricIndex = -1;

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
      likesCount: document.getElementById('likes-count')
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

  switchView(viewName) {
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

    const scrollArea = document.getElementById('content-scroll-area');
    if (scrollArea) scrollArea.scrollTop = 0;
  }

  toggleLike(track) {
    if (!track) return;
    if (this.likedTrackIds.has(track.id)) {
      this.likedTrackIds.delete(track.id);
      this.showToast(`'${track.title}' 좋아요 취소됨`);
    } else {
      this.likedTrackIds.add(track.id);
      this.showToast(`'${track.title}' 좋아요 표시한 음악에 추가됨`);
    }
    this.updateLikeButtons(track.id);
    this.updateLikesCount();
    if (this.currentView === 'library') {
      this.renderLibrary('likes', this.player.queue);
    }
  }

  updateLikesCount() {
    if (this.dom.likesCount) {
      this.dom.likesCount.textContent = this.likedTrackIds.size;
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
            <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(this.src.includes('maxresdefault.jpg'))this.src=this.src.replace('maxresdefault.jpg','hqdefault.jpg');">
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
          <img src="${album.cover}" alt="${album.title}" loading="lazy" onerror="this.onerror=null;if(this.src.includes('maxresdefault.jpg'))this.src=this.src.replace('maxresdefault.jpg','hqdefault.jpg');">
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
    this.dom.spotlightTracksList.innerHTML = artistTracks.slice(0, 6).map(track => `
      <div class="music-card" data-track-id="${track.id}">
        <div class="card-cover-wrapper">
          <img src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.onerror=null;if(this.src.includes('maxresdefault.jpg'))this.src=this.src.replace('maxresdefault.jpg','hqdefault.jpg');">
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

  // 6. 보관함 렌더링
  renderLibrary(tabType, allTracks = []) {
    if (!this.dom.libraryContent) return;
    let targetTracks = [];

    if (tabType === 'likes') {
      targetTracks = allTracks.filter(t => this.likedTrackIds.has(t.id));
    } else if (tabType === 'history') {
      targetTracks = this.playHistory;
    } else if (tabType === 'local') {
      targetTracks = this.localFiles;
    }

    if (targetTracks.length === 0) {
      this.dom.libraryContent.innerHTML = `
        <div style="padding: 48px 16px; text-align: center; color: var(--text-muted);">
          <i data-lucide="music" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
          <p style="font-size: 1.1rem; font-weight: 600;">아직 보관된 음악이 없습니다.</p>
          <p style="font-size: 0.88rem; margin-top: 6px;">좋아하는 곡에 좋아요를 누르거나 음악 파일을 추가해보세요.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.dom.libraryContent.innerHTML = `
      <div class="quick-picks-grid-ytm" style="grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
        ${targetTracks.map(track => `
          <div class="track-row-card" data-track-id="${track.id}">
            <div class="track-row-cover">
              <img src="${track.cover}" alt="${track.title}" loading="lazy">
              <div class="cover-play-overlay">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <polygon points="6 4 20 12 6 20 6 4"></polygon>
                </svg>
              </div>
            </div>
            <div class="track-row-info">
              <div class="track-row-title">${track.title}</div>
              <div class="track-row-artist">${track.artist}</div>
            </div>
            <span class="track-row-duration">${this.formatTime(track.duration)}</span>
          </div>
        `).join('')}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  // 7. 대기열 렌더링
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
        <div class="track-row-card ${isPlaying ? 'playing' : ''}" data-queue-index="${index}">
          <div class="track-row-cover" style="width: 42px; height: 42px;">
            <img src="${track.cover}" alt="${track.title}">
            <div class="cover-play-overlay" style="opacity: ${isPlaying ? '1' : ''};">
              ${isPlaying && this.player.isPlaying 
                ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
                : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>'
              }
            </div>
          </div>
          <div class="track-row-info">
            <div class="track-row-title" style="font-size: 0.9rem;">${track.title}</div>
            <div class="track-row-artist" style="font-size: 0.78rem;">${track.artist}</div>
          </div>
          <span class="track-row-duration">${this.formatTime(track.duration)}</span>
          <button class="btn-track-action" data-action="remove-queue" data-index="${index}" title="삭제">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
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

  renderLyrics(lyrics) {
    if (!this.dom.lyricsContainer) return;
    this._lastActiveLyricIndex = -1;

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
        const track = this.player.getCurrentTrack();
        if (!isNaN(time) && track && track.duration) {
          const percent = Math.min(100, Math.max(0, (time / track.duration) * 100));
          this.player.seekToPercent(percent);
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

  // 9. 관련 음악(Related) 렌더링
  renderRelated(currentTrack, allTracks) {
    if (!this.dom.relatedList) return;
    const related = allTracks.filter(t => t.id !== currentTrack?.id).slice(0, 6);
    this.dom.relatedList.innerHTML = related.map(track => `
      <div class="track-row-card" data-track-id="${track.id}">
        <div class="track-row-cover" style="width: 44px; height: 44px;">
          <img src="${track.cover}" alt="${track.title}">
          <div class="cover-play-overlay">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4"></polygon>
            </svg>
          </div>
        </div>
        <div class="track-row-info">
          <div class="track-row-title">${track.title}</div>
          <div class="track-row-artist">${track.artist}</div>
        </div>
      </div>
    `).join('');
  }

  // 10. 검색 결과 렌더링
  renderSearchResults(query, tracks, isSearchingOnline = false) {
    if (!this.dom.searchResultsList) return;
    if (this.dom.searchQueryText) this.dom.searchQueryText.textContent = query;

    if (tracks.length === 0) {
      if (isSearchingOnline) {
        this.dom.searchResultsList.innerHTML = `
          <div style="padding: 48px; text-align: center; color: var(--text-muted);">
            <div class="audio-equalizer-bars active" style="position: static; margin: 0 auto 16px auto; height: 24px;">
              <span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span>
            </div>
            <p style="font-size: 1.1rem; color: #fff;">YouTube에서 전 세계 음원을 실시간 검색하는 중...</p>
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

    this.dom.searchResultsList.innerHTML = tracks.map(track => `
      <div class="track-row-card" data-track-id="${track.id}">
        <div class="track-row-cover">
          <img src="${track.cover}" alt="${track.title}">
          <div class="cover-play-overlay">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4"></polygon>
            </svg>
          </div>
        </div>
        <div class="track-row-info">
          <div class="track-row-title">${track.title}</div>
          <div class="track-row-artist">${track.artist} • ${track.album}</div>
        </div>
        <span class="track-row-duration">${this.formatTime(track.duration)}</span>
        <button class="btn-track-action" data-action="queue" title="대기열에 추가">
          <i data-lucide="list-plus"></i>
        </button>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
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

    if (!this.playHistory.find(t => t.id === track.id)) {
      this.playHistory.unshift(track);
      if (this.playHistory.length > 20) this.playHistory.pop();
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

  updateProgressUI(currentTime, duration, percent) {
    if (this.dom.currentTimeText) this.dom.currentTimeText.textContent = this.formatTime(currentTime);
    if (this.dom.durationTimeText && duration > 0) this.dom.durationTimeText.textContent = this.formatTime(duration);
    if (this.dom.progressBar) this.dom.progressBar.style.width = `${percent}%`;
    if (this.dom.seekSlider && !this.isSeeking) {
      this.dom.seekSlider.value = percent;
    }

    const currentTrack = this.player.getCurrentTrack();
    if (currentTrack?.lyrics) {
      this.updateLyricsSync(currentTime, currentTrack.lyrics);
    }
  }
}
