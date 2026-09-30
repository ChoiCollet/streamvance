// ==========================================================================
// Main Application Entry Point
// ==========================================================================

import { sampleTracks, sampleAlbums, genresData } from './data.js';
import { AudioPlayer } from './audioPlayer.js';
import { UIManager } from './ui.js';
import { YouTubeSearchService } from './searchService.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Core Engine & UI
  const audioElement = document.getElementById('main-audio');
  const player = new AudioPlayer(audioElement);
  const ui = new UIManager(player);

  let allTracks = [...sampleTracks];
  let currentMood = 'all';

  // 2. Setup Audio Player Callbacks
  player.callbacks.onTrackChange = (track, index) => {
    ui.updateCurrentTrackUI(track);
    ui.renderRelated(track, allTracks);
    ui.renderQueue(player.queue, player.currentIndex);
  };

  player.callbacks.onPlayStateChange = (isPlaying) => {
    ui.updatePlayStateUI(isPlaying);
  };

  player.callbacks.onTimeUpdate = (current, duration, percent) => {
    ui.updateProgressUI(current, duration, percent);
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

  // 3. Initial Queue & Data Setup
  player.setQueue(allTracks, 0, false); // 첫 번째 곡 세팅 (자동재생은 브라우저 정책 준수하여 false)
  ui.updateLikesCount();

  // 4. Initial Views Render
  ui.renderQuickPicks(allTracks);
  ui.renderRecommendedAlbums(sampleAlbums, allTracks);
  ui.renderTopCharts(allTracks);
  ui.renderGenres(genresData);
  ui.renderQueue(player.queue, 0);

  // 5. Navigation Tab Switching (Sidebar & Mobile)
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const navTarget = btn.getAttribute('data-nav');
      ui.switchView(navTarget);
      if (navTarget === 'library') {
        ui.renderLibrary('likes', allTracks);
      }
    });
  });

  // 브랜드 로고 클릭 시 홈으로
  const brandHomeLink = document.getElementById('brand-home-link');
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
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
          const target = allTracks.find(t => t.id === trackId);
          ui.toggleLike(target);
          return;
        } else if (action === 'queue') {
          e.stopPropagation();
          const target = allTracks.find(t => t.id === trackId);
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
          const targetTrack = allTracks.find(t => t.id === trackId);
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
    });
  }
  if (ui.dom.modalLikeBtn) {
    ui.dom.modalLikeBtn.addEventListener('click', () => {
      ui.toggleLike(player.getCurrentTrack());
    });
  }

  // 9. Full Modal Player Expand / Collapse
  const openModal = () => {
    ui.dom.fullModal.classList.add('open');
    if (window.lucide) window.lucide.createIcons();
  };
  const closeModal = () => {
    ui.dom.fullModal.classList.remove('open');
  };

  const btnExpandPlayer = document.getElementById('btn-expand-player');
  if (btnExpandPlayer) btnExpandPlayer.addEventListener('click', openModal);

  const playerTrackInfo = document.getElementById('player-track-info');
  if (playerTrackInfo) {
    playerTrackInfo.addEventListener('click', (e) => {
      if (e.target.closest('#btn-like-track')) return;
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

  // 10. Real-time YouTube Search Functionality (Zero Local Storage)
  const searchService = new YouTubeSearchService();
  let searchDebounceTimer = null;

  if (ui.dom.searchInput) {
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

      ui.switchView('search');

      // 1) 즉시 로컬 카탈로그 필터링 결과 표시 (0.01초 반응)
      const localFiltered = allTracks.filter(t => 
        t.title.toLowerCase().includes(val.toLowerCase()) ||
        t.artist.toLowerCase().includes(val.toLowerCase()) ||
        t.album.toLowerCase().includes(val.toLowerCase())
      );
      ui.renderSearchResults(val, localFiltered, true);

      // 2) 유튜브 실시간 라이브 검색 비동기 실행 (400ms 디바운스)
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
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
      }, 400);
    });

    // 엔터키 입력 시 유튜브 URL인지 체크 및 즉시 검색
    ui.dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = ui.dom.searchInput.value.trim();
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
        }
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

  // 13. Quick Picks "모두 재생" 버튼
  const btnPlayAllQuick = document.getElementById('btn-play-all-quick');
  if (btnPlayAllQuick) {
    btnPlayAllQuick.addEventListener('click', () => {
      player.setQueue(allTracks, 0, true);
      ui.showToast('모든 추천 곡 재생을 시작합니다.');
    });
  }

  // 14. Keyboard Shortcuts
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
