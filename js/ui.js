// ==========================================================================
// UI Rendering, Interactions, and View Management
// ==========================================================================

export class UIManager {
  constructor(player) {
    this.player = player;
    this.currentView = 'home';
    this.likedTrackIds = new Set(['track-apt', 'track-ditto', 'track-supernova', 'track-seven']);
    this.playHistory = [];
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
      // Bottom Player
      playerBar: document.getElementById('player-bar'),
      coverImg: document.getElementById('player-cover-img'),
      titleText: document.getElementById('player-title'),
      artistText: document.getElementById('player-artist'),
      playPauseIcon: document.getElementById('icon-play-pause'),
      eqBars: document.getElementById('audio-eq-bars'),
      likeBtn: document.getElementById('btn-like-track'),
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

    // Sidebar & Mobile Nav active state update
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === viewName);
    });

    // 뷰 전환 시 스크롤 상단으로 이동
    const scrollArea = document.getElementById('content-scroll-area');
    if (scrollArea) scrollArea.scrollTop = 0;
  }

  toggleLike(track) {
    if (!track) return;
    if (this.likedTrackIds.has(track.id)) {
      this.likedTrackIds.delete(track.id);
      this.showToast(`'${track.title}' 보관함에서 삭제됨`);
    } else {
      this.likedTrackIds.add(track.id);
      this.showToast(`'${track.title}' 좋아요 표시한 음악에 추가됨`);
    }
    this.updateLikeButtons(track.id);
    this.updateLikesCount();
    if (this.currentView === 'library') {
      this.renderLibrary('likes');
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

  // 1. Quick Picks 렌더링
  renderQuickPicks(tracks) {
    if (!this.dom.quickPicksList) return;
    this.dom.quickPicksList.innerHTML = tracks.map(track => {
      const isCurrent = this.player.getCurrentTrack()?.id === track.id;
      const isLiked = this.likedTrackIds.has(track.id);
      return `
        <div class="track-row-card ${isCurrent ? 'playing' : ''}" data-track-id="${track.id}">
          <div class="track-row-cover">
            <img src="${track.cover}" alt="${track.title}" loading="lazy">
            <div class="cover-play-overlay">
              <i data-lucide="${isCurrent && this.player.isPlaying ? 'pause' : 'play'}"></i>
            </div>
          </div>
          <div class="track-row-info">
            <div class="track-row-title">${track.title}</div>
            <div class="track-row-artist">${track.artist}</div>
          </div>
          <span class="track-row-duration">${this.formatTime(track.duration)}</span>
          <div class="track-row-actions">
            <button class="btn-track-action btn-inline-like ${isLiked ? 'liked' : ''}" data-action="like" title="좋아요">
              <i data-lucide="heart"></i>
            </button>
            <button class="btn-track-action" data-action="queue" title="대기열에 추가">
              <i data-lucide="list-plus"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. 추천 앨범 렌더링
  renderRecommendedAlbums(albums, allTracks) {
    if (!this.dom.recommendedAlbumsList) return;
    this.dom.recommendedAlbumsList.innerHTML = albums.map(album => `
      <div class="music-card" data-album-id="${album.id}">
        <div class="card-cover-wrapper">
          <img src="${album.cover}" alt="${album.title}" loading="lazy">
          <button class="card-float-play-btn" data-action="play-album" title="앨범 재생">
            <i data-lucide="play"></i>
          </button>
        </div>
        <div class="card-title">${album.title}</div>
        <div class="card-subtitle">${album.artist} · 추천 믹스</div>
      </div>
    `).join('');
  }

  // 3. TOP 차트 렌더링
  renderTopCharts(tracks) {
    if (!this.dom.topChartsList) return;
    this.dom.topChartsList.innerHTML = tracks.slice(0, 5).map((track, idx) => `
      <div class="chart-item" data-track-id="${track.id}">
        <span class="chart-rank">${idx + 1}</span>
        <img class="chart-cover" src="${track.cover}" alt="${track.title}" loading="lazy">
        <div class="chart-meta">
          <div class="chart-song-title">${track.title}</div>
          <div class="chart-song-artist">${track.artist} · ${track.album}</div>
        </div>
        <button class="ctrl-btn" data-action="play" title="재생">
          <i data-lucide="play"></i>
        </button>
      </div>
    `).join('');
  }

  // 4. 장르 카드 렌더링 (둘러보기)
  renderGenres(genres) {
    if (!this.dom.genreGrid) return;
    this.dom.genreGrid.innerHTML = genres.map(g => `
      <div class="genre-card" style="background: ${g.color};" data-genre-mood="${g.mood}">
        <span>${g.name}</span>
      </div>
    `).join('');
  }

  // 5. 보관함 렌더링
  renderLibrary(tabType, allTracks) {
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
          <p style="font-size: 0.88rem; margin-top: 6px;">좋아하는 곡에 하트를 누르거나 내 PC의 음악 파일을 추가해보세요.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.dom.libraryContent.innerHTML = `
      <div class="quick-picks-grid">
        ${targetTracks.map(track => `
          <div class="track-row-card" data-track-id="${track.id}">
            <div class="track-row-cover">
              <img src="${track.cover}" alt="${track.title}" loading="lazy">
              <div class="cover-play-overlay">
                <i data-lucide="play"></i>
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

  // 6. 재생 대기열 (Queue) 렌더링
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
              <i data-lucide="${isPlaying && this.player.isPlaying ? 'volume-2' : 'play'}"></i>
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

  // 7. 가사(Lyrics) 렌더링 및 동기화
  renderLyrics(lyrics) {
    if (!this.dom.lyricsContainer) return;
    if (!lyrics || lyrics.length === 0) {
      this.dom.lyricsContainer.innerHTML = `<p class="lyrics-placeholder">등록된 가사가 없습니다.</p>`;
      return;
    }

    this.dom.lyricsContainer.innerHTML = lyrics.map((line, idx) => `
      <div class="lyric-line" id="lyric-${idx}" data-time="${line.time}">${line.text}</div>
    `).join('');
  }

  updateLyricsSync(currentTime, lyrics) {
    if (!lyrics || lyrics.length === 0) return;
    let activeIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        activeIndex = i;
      } else {
        break;
      }
    }

    document.querySelectorAll('.lyric-line').forEach((el, idx) => {
      const isMatch = (idx === activeIndex);
      el.classList.toggle('active', isMatch);
      if (isMatch) {
        // 활성 가사 라인으로 부드럽게 스크롤
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  // 8. 관련 음악(Related) 렌더링
  renderRelated(currentTrack, allTracks) {
    if (!this.dom.relatedList) return;
    const related = allTracks.filter(t => t.id !== currentTrack?.id).slice(0, 5);
    this.dom.relatedList.innerHTML = related.map(track => `
      <div class="track-row-card" data-track-id="${track.id}">
        <div class="track-row-cover" style="width: 44px; height: 44px;">
          <img src="${track.cover}" alt="${track.title}">
          <div class="cover-play-overlay">
            <i data-lucide="play"></i>
          </div>
        </div>
        <div class="track-row-info">
          <div class="track-row-title">${track.title}</div>
          <div class="track-row-artist">${track.artist} · ${track.genre.toUpperCase()}</div>
        </div>
        <button class="btn-track-action" data-action="play-related" title="재생">
          <i data-lucide="play"></i>
        </button>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  // 9. 검색 결과 렌더링
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
          <p style="font-size: 0.85rem; margin-top: 6px;">유튜브 실시간 검색 또는 다른 아티스트 이름을 입력해 보세요.</p>
        </div>
      `;
      return;
    }

    this.dom.searchResultsList.innerHTML = tracks.map(track => {
      const isOnlineResult = track.id.startsWith('yt-');
      return `
        <div class="track-row-card" data-track-id="${track.id}">
          <div class="track-row-cover">
            <img src="${track.cover}" alt="${track.title}">
            <div class="cover-play-overlay">
              <i data-lucide="play"></i>
            </div>
          </div>
          <div class="track-row-info">
            <div class="track-row-title">
              ${track.title}
              ${isOnlineResult ? '<span style="display:inline-block; font-size:0.68rem; padding:2px 6px; background:#ff0000; border-radius:4px; margin-left:6px; font-weight:700;">YouTube</span>' : ''}
            </div>
            <div class="track-row-artist">${track.artist} · ${track.album}</div>
          </div>
          <span class="track-row-duration">${this.formatTime(track.duration)}</span>
          <div class="track-row-actions">
            <button class="btn-track-action" data-action="queue" title="대기열에 추가">
              <i data-lucide="list-plus"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  // 현재 재생 중인 트랙 UI 업데이트
  updateCurrentTrackUI(track) {
    if (!track) return;

    // 하단 바
    if (this.dom.coverImg) this.dom.coverImg.src = track.cover;
    if (this.dom.titleText) this.dom.titleText.textContent = track.title;
    if (this.dom.artistText) this.dom.artistText.textContent = track.artist;
    if (this.dom.durationTimeText) this.dom.durationTimeText.textContent = this.formatTime(track.duration);

    // 전체 모달
    if (this.dom.modalCover) this.dom.modalCover.src = track.cover;
    if (this.dom.modalTitle) this.dom.modalTitle.textContent = track.title;
    if (this.dom.modalArtist) this.dom.modalArtist.textContent = track.artist;

    // 좋아요 버튼 상태 갱신
    this.updateLikeButtons(track.id);

    // 가사 및 대기열 갱신
    this.renderLyrics(track.lyrics);

    // 히스토리에 추가 (중복 방지)
    if (!this.playHistory.find(t => t.id === track.id)) {
      this.playHistory.unshift(track);
      if (this.playHistory.length > 20) this.playHistory.pop();
    }
  }

  updatePlayStateUI(isPlaying) {
    // 플레이/일시정지 아이콘 변경
    if (this.dom.playPauseIcon) {
      this.dom.playPauseIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
    }
    // 이퀄라이저 애니메이션
    if (this.dom.eqBars) {
      this.dom.eqBars.classList.toggle('active', isPlaying);
    }
    // 카드들의 재생 하이라이트 갱신
    document.querySelectorAll('.track-row-card').forEach(card => {
      const cardTrackId = card.getAttribute('data-track-id');
      const isCurrent = cardTrackId === this.player.getCurrentTrack()?.id;
      card.classList.toggle('playing', isCurrent);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  updateProgressUI(currentTime, duration, percent) {
    if (this.dom.currentTimeText) this.dom.currentTimeText.textContent = this.formatTime(currentTime);
    if (this.dom.durationTimeText && duration > 0) this.dom.durationTimeText.textContent = this.formatTime(duration);
    if (this.dom.progressBar) this.dom.progressBar.style.width = `${percent}%`;
    if (this.dom.seekSlider && !this.isSeeking) {
      this.dom.seekSlider.value = percent;
    }

    // 가사 동기화
    const currentTrack = this.player.getCurrentTrack();
    if (currentTrack?.lyrics) {
      this.updateLyricsSync(currentTime, currentTrack.lyrics);
    }
  }
}
