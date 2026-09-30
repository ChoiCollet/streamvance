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
    if (ui.currentView === 'home') {
      updatePersonalizedQuickPicks();
    }
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

  player.callbacks.onTimeUpdate = (current, duration, percent) => {
    ui.updateProgressUI(current, duration, percent);

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
    if (ui.dom.volumeIcon) {
      if (isMuted || volume === 0) {
        ui.dom.volumeIcon.setAttribute('data-lucide', 'volume-x');
      } else if (volume < 0.5) {
        ui.dom.volumeIcon.setAttribute('data-lucide', 'volume-1');
      } else {
        ui.dom.volumeIcon.setAttribute('data-lucide', 'volume-2');
      }
      if (window.lucide) window.lucide.createIcons();
    }
  };

  // ==========================================================================
  // 실시간 사용자 취향 기반 빠른 선곡 (Dynamic Taste-based Quick Picks)
  // ==========================================================================
  function getPersonalizedQuickPicks() {
    const taste = auth.analyzeUserTaste(allTracks);
    const topGenres = new Set(taste.genres.slice(0, 3).map(g => g.genre));
    const topArtists = new Set(taste.artists.map(a => a.artist.toLowerCase()));

    // 개인 맞춤 스코어링 (좋아요: +25점, 히스토리: +15점, 선호 장르: +10점, 최애 아티스트: +15점)
    const scored = allTracks.map(track => {
      let score = 0;
      if (ui.likedTrackIds.has(track.id)) score += 25;
      if (ui.playHistory.some(t => t.id === track.id)) score += 15;
      if (topGenres.has(track.genre)) score += 10;
      if (topArtists.has((track.artist || '').toLowerCase())) score += 15;
      if (track.mood === taste.topMood) score += 8;
      // 새로고침 시 신선한 추천을 위한 미세 가중치
      score += Math.random() * 6;
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
  ui.renderSpotlight(allTracks.filter(t => t.artist.includes('NewJeans') || t.genre === 'pop'));
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

  // 브랜드 로고 클릭 시 홈으로
  const brandHomeLink = document.getElementById('brand-home-link');
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
      ui.switchView('home');
    });
  }

  // 6. Mood Filter Chips
  document.querySelectorAll('.mood-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentMood = chip.getAttribute('data-mood');

      let filtered = allTracks;
      if (currentMood !== 'all') {
        filtered = allTracks.filter(t => t.mood === currentMood || t.genre === currentMood);
        if (filtered.length === 0) filtered = allTracks; // fallback
      }
      ui.renderQuickPicks(filtered);
      if (window.lucide) window.lucide.createIcons();
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

    // 앨범 카드 재생 버튼 클릭
    const albumCard = e.target.closest('.music-card');
    if (albumCard) {
      const albumId = albumCard.getAttribute('data-album-id');
      const album = sampleAlbums.find(a => a.id === albumId);
      if (album) {
        const albumTracks = allTracks.filter(t => album.trackIds.includes(t.id));
        if (albumTracks.length > 0) {
          player.setQueue(albumTracks, 0, true);
          ui.showToast(`앨범 '${album.title}' 재생 시작`);
        }
      }
    }

    // 둘러보기 히어로 배너 재생 버튼
    if (e.target.closest('#btn-hero-play')) {
      const track = allTracks[0];
      if (track) {
        player.setQueue([track, ...allTracks.slice(1)], 0, true);
        ui.showToast(`'${track.title}' 재생 시작`);
      }
    }

    // 둘러보기 장르 카드 클릭
    const genreCard = e.target.closest('.genre-card');
    if (genreCard) {
      const mood = genreCard.getAttribute('data-genre-mood');
      ui.switchView('home');
      const matchingChip = document.querySelector(`.mood-chip[data-mood="${mood}"]`);
      if (matchingChip) matchingChip.click();
    }
  });

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

  const btnShuffle = document.getElementById('btn-shuffle');
  if (btnShuffle) {
    btnShuffle.addEventListener('click', () => {
      const active = player.toggleShuffle();
      btnShuffle.classList.toggle('active', active);
      ui.showToast(active ? '셔플 모드 켜짐' : '셔플 모드 꺼짐');
    });
  }

  const btnRepeat = document.getElementById('btn-repeat');
  if (btnRepeat) {
    btnRepeat.addEventListener('click', () => {
      const mode = player.cycleRepeat();
      btnRepeat.classList.toggle('active', mode !== 'off');
      const labels = { off: '반복 꺼짐', all: '전체 반복', one: '한 곡 반복' };
      ui.showToast(labels[mode]);
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
  if (btnMobileShuffle) btnMobileShuffle.addEventListener('click', () => player.toggleShuffle());

  const btnMobileRepeat = document.getElementById('btn-mobile-repeat');
  if (btnMobileRepeat) btnMobileRepeat.addEventListener('click', () => player.toggleRepeat());

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
      if (player.audio) {
        ui.updateLyricsSync(player.audio.currentTime || 0, current.lyrics);
      }
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

  if (ui.dom.searchInput) {
    const executeSearch = async (val) => {
      clearTimeout(searchDebounceTimer);
      if (!val) {
        closeModal();
        ui.switchView('home');
        return;
      }

      closeModal();
      ui.switchView('search');

      // 1) 즉시 로컬 카탈로그 필터링 결과 표시 (0.01초 반응)
      const localFiltered = allTracks.filter(t => 
        t.title.toLowerCase().includes(val.toLowerCase()) ||
        t.artist.toLowerCase().includes(val.toLowerCase()) ||
        t.album.toLowerCase().includes(val.toLowerCase())
      );
      ui.renderSearchResults(val, localFiltered, true);

      // 2) 고속 실시간 라이브 검색 비동기 실행
      try {
        const onlineResults = await searchService.searchOnline(val);
        
        // 기존 결과와 합치기 (중복 비디오 제거)
        const existingVideoIds = new Set(allTracks.map(t => t.videoId).filter(Boolean));
        const newOnlineTracks = onlineResults.filter(t => !existingVideoIds.has(t.videoId));

        // 전역 풀에 새 트랙 등록 (클릭 시 재생 가능하도록)
        newOnlineTracks.forEach(t => {
          if (!allTracks.find(item => item.id === t.id)) {
            allTracks.push(t);
          }
        });

        const combined = [...localFiltered, ...newOnlineTracks];
        ui.renderSearchResults(val, combined, false);
      } catch (err) {
        console.warn("Online search error:", err);
        ui.renderSearchResults(val, localFiltered, false);
      }
    };

    ui.dom.searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (ui.dom.searchClearBtn) {
        ui.dom.searchClearBtn.style.display = val ? 'block' : 'none';
      }

      if (val.length === 0) {
        clearTimeout(searchDebounceTimer);
        ui.switchView('home');
        return;
      }

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => executeSearch(val), 250);
    });

    // 엔터키 입력 시 유튜브 URL이면 다이렉트 재생, 일반 검색어면 지연 없이 0ms 즉시 검색 실행
    ui.dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = ui.dom.searchInput.value.trim();
        if (!val) return;

        // 유튜브 링크 직접 붙여넣기 지원 (예: youtube.com/watch?v=XXXXX or youtu.be/XXXXX)
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

        // 일반 검색어: 디바운스 대기 없이 즉시 실행
        executeSearch(val);
      }
    });

    if (ui.dom.searchClearBtn) {
      ui.dom.searchClearBtn.addEventListener('click', () => {
        ui.dom.searchInput.value = '';
        ui.dom.searchClearBtn.style.display = 'none';
        ui.switchView('home');
      });
    }
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

  const headerUploadBtn = document.getElementById('header-upload-btn');
  if (headerUploadBtn) headerUploadBtn.addEventListener('click', triggerLocalUpload);

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
