// ==========================================================================
// Picture-in-Picture (PiP) Manager: Document PiP + In-Page Floating Mini Player
// Chrome 116+ Document PiP API 및 인페이지 플로팅 미니 플레이어 완벽 지원
// ==========================================================================

export class PiPManager {
  constructor(player, ui, lyricsService) {
    this.player = player;
    this.ui = ui;
    this.lyricsService = lyricsService;
    this.pipWindow = null;
    this.isFloatingOpen = false;

    this.initInPageFloatingPip();
  }

  // 브라우저 공식 Document Picture-in-Picture 지원 여부 확인
  isDocPiPSupported() {
    return 'documentPictureInPicture' in window;
  }

  // PiP 열기/닫기 토글
  async togglePiP() {
    if (this.pipWindow) {
      this.pipWindow.close();
      this.pipWindow = null;
      return;
    }

    if (this.isDocPiPSupported()) {
      try {
        await this.openDocumentPiP();
        return;
      } catch (err) {
        console.warn("Document PiP failed, falling back to in-page floating PiP:", err);
      }
    }

    // 폴백: 인페이지 플로팅 미니 플레이어 토글
    this.toggleInPageFloating();
  }

  // 1. 브라우저 창 밖으로 띄우는 공식 Document PiP 팝업
  async openDocumentPiP() {
    const track = this.player.getCurrentTrack();
    if (!track) {
      this.ui.showToast('재생 중인 곡이 없습니다.');
      return;
    }

    // 모달이 열려있다면 닫아줌
    const modal = document.getElementById('full-player-modal');
    if (modal?.classList.contains('open')) {
      modal.classList.remove('open');
      document.body.classList.remove('player-modal-open');
    }

    this.pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 340,
      height: 440
    });

    // 부모 창의 모든 스타일시트 복사
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleEl) => {
      this.pipWindow.document.head.appendChild(styleEl.cloneNode(true));
    });

    // PiP 전용 컴팩트 스타일 주입
    const pipStyle = this.pipWindow.document.createElement('style');
    pipStyle.textContent = `
      body {
        margin: 0;
        padding: 16px;
        background: #0f0f0f;
        color: #fff;
        font-family: 'Roboto', 'Outfit', sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        height: 100vh;
        box-sizing: border-box;
        overflow: hidden;
        user-select: none;
      }
      .pip-cover-wrap {
        width: 140px;
        height: 140px;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        margin-bottom: 12px;
        flex-shrink: 0;
      }
      .pip-cover-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .pip-info {
        text-align: center;
        width: 100%;
        margin-bottom: 8px;
        flex-shrink: 0;
      }
      .pip-title {
        font-size: 1rem;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin: 0 0 4px 0;
      }
      .pip-artist {
        font-size: 0.85rem;
        color: #aaa;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pip-lyrics-box {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 4px 8px;
        font-size: 0.95rem;
        font-weight: 600;
        color: #ff0055;
        min-height: 48px;
        line-height: 1.4;
      }
      .pip-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        width: 100%;
        margin-top: 6px;
        flex-shrink: 0;
      }
      .pip-btn {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 8px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s, background 0.15s;
      }
      .pip-btn:hover {
        background: rgba(255,255,255,0.1);
        transform: scale(1.08);
      }
      .pip-btn-play {
        background: #fff;
        color: #000;
        width: 44px;
        height: 44px;
      }
      .pip-btn-play:hover {
        background: #eee;
        transform: scale(1.08);
      }
      .pip-progress-row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.75rem;
        color: #888;
        margin-top: 6px;
        flex-shrink: 0;
      }
      .pip-seek-track {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        overflow: hidden;
        position: relative;
        cursor: pointer;
      }
      .pip-seek-fill {
        height: 100%;
        width: 0%;
        background: #ff0055;
        border-radius: 2px;
      }
    `;
    this.pipWindow.document.head.appendChild(pipStyle);

    // PiP 마크업 구성
    this.pipWindow.document.body.innerHTML = `
      <div class="pip-cover-wrap">
        <img class="pip-cover-img" id="pip-cover" src="${track.cover || ''}" alt="Cover">
      </div>
      <div class="pip-info">
        <h4 class="pip-title" id="pip-title">${track.title || ''}</h4>
        <p class="pip-artist" id="pip-artist">${track.artist || ''}</p>
      </div>
      <div class="pip-lyrics-box" id="pip-lyrics">
        <span>가사를 불러오는 중...</span>
      </div>
      <div class="pip-progress-row">
        <span id="pip-time-cur">0:00</span>
        <div class="pip-seek-track" id="pip-seek">
          <div class="pip-seek-fill" id="pip-seek-fill"></div>
        </div>
        <span id="pip-time-dur">0:00</span>
      </div>
      <div class="pip-controls">
        <button class="pip-btn" id="pip-btn-prev" title="이전 곡">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"></polygon>
            <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></line>
          </svg>
        </button>
        <button class="pip-btn pip-btn-play" id="pip-btn-play" title="재생/일시정지">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" id="pip-play-icon">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        </button>
        <button class="pip-btn" id="pip-btn-next" title="다음 곡">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></line>
          </svg>
        </button>
      </div>
    `;

    // 이벤트 리스너 바인딩
    const btnPlay = this.pipWindow.document.getElementById('pip-btn-play');
    const btnPrev = this.pipWindow.document.getElementById('pip-btn-prev');
    const btnNext = this.pipWindow.document.getElementById('pip-btn-next');
    const seekTrack = this.pipWindow.document.getElementById('pip-seek');

    btnPlay.addEventListener('click', () => this.player.togglePlayPause());
    btnPrev.addEventListener('click', () => this.player.prevTrack());
    btnNext.addEventListener('click', () => this.player.nextTrack(true));

    if (seekTrack) {
      seekTrack.addEventListener('click', (e) => {
        const rect = seekTrack.getBoundingClientRect();
        const percent = ((e.clientX - rect.left) / rect.width) * 100;
        this.player.seekToPercent(percent);
      });
    }

    this.pipWindow.addEventListener('pagehide', () => {
      this.pipWindow = null;
      this.ui.showToast('미니 플레이어 (PIP) 창이 닫혔습니다.');
    });

    this.updatePiPContent();
    this.ui.showToast('화면 속 화면 (PIP 미니 플레이어)이 실행되었습니다.');
  }

  // 2. 인페이지 플로팅 미니 플레이어 (Document PiP 미지원 브라우저/모바일용)
  initInPageFloatingPip() {
    let wrap = document.getElementById('in-page-mini-pip');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'in-page-mini-pip';
      wrap.className = 'in-page-floating-pip';
      wrap.style.display = 'none';
      wrap.innerHTML = `
        <button class="floating-pip-close" id="btn-close-floating-pip" title="닫기">
          <i data-lucide="x"></i>
        </button>
        <div class="floating-pip-body">
          <img src="" class="floating-pip-cover" id="floating-pip-cover" alt="Cover">
          <div class="floating-pip-meta">
            <span class="floating-pip-title" id="floating-pip-title">곡 제목</span>
            <span class="floating-pip-artist" id="floating-pip-artist">아티스트</span>
            <div class="floating-pip-lyrics" id="floating-pip-lyrics">가사 동기화 중...</div>
          </div>
          <div class="floating-pip-actions">
            <button class="floating-pip-btn" id="floating-pip-prev">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="19 20 9 12 19 4 19 20"></polygon>
                <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5"></line>
              </svg>
            </button>
            <button class="floating-pip-btn btn-play" id="floating-pip-play">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" id="svg-floating-play">
                <polygon points="6 4 20 12 6 20 6 4"></polygon>
              </svg>
            </button>
            <button class="floating-pip-btn" id="floating-pip-next">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="5 4 15 12 5 20 5 4"></polygon>
                <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      // 이벤트 연결
      document.getElementById('btn-close-floating-pip')?.addEventListener('click', () => {
        wrap.style.display = 'none';
        this.isFloatingOpen = false;
      });
      document.getElementById('floating-pip-play')?.addEventListener('click', () => this.player.togglePlayPause());
      document.getElementById('floating-pip-prev')?.addEventListener('click', () => this.player.prevTrack());
      document.getElementById('floating-pip-next')?.addEventListener('click', () => this.player.nextTrack(true));

      wrap.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          document.getElementById('btn-expand-player')?.click();
        }
      });
    }
  }

  toggleInPageFloating() {
    const wrap = document.getElementById('in-page-mini-pip');
    if (!wrap) return;
    this.isFloatingOpen = !this.isFloatingOpen;
    wrap.style.display = this.isFloatingOpen ? 'flex' : 'none';
    if (this.isFloatingOpen) {
      this.updatePiPContent();
      this.ui.showToast('플로팅 미니 플레이어로 전환되었습니다.');
    }
  }

  // 곡 변경 또는 재생/일시정지 상태 변경 시 PiP UI 동기화
  updatePiPContent() {
    const track = this.player.getCurrentTrack();
    if (!track) return;

    // Document PiP 창 업데이트
    if (this.pipWindow && !this.pipWindow.closed) {
      const doc = this.pipWindow.document;
      const img = doc.getElementById('pip-cover');
      const title = doc.getElementById('pip-title');
      const artist = doc.getElementById('pip-artist');
      const playIcon = doc.getElementById('pip-play-icon');

      if (img && track.cover) img.src = track.cover;
      if (title) title.textContent = track.title || '';
      if (artist) artist.textContent = track.artist || '';

      if (playIcon) {
        if (this.player.isPlaying) {
          playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        } else {
          playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
        }
      }
    }

    // 인페이지 플로팅 창 업데이트
    const floating = document.getElementById('in-page-mini-pip');
    if (floating && this.isFloatingOpen) {
      const fCover = document.getElementById('floating-pip-cover');
      const fTitle = document.getElementById('floating-pip-title');
      const fArtist = document.getElementById('floating-pip-artist');
      const fPlayIcon = document.getElementById('svg-floating-play');

      if (fCover && track.cover) fCover.src = track.cover;
      if (fTitle) fTitle.textContent = track.title || '';
      if (fArtist) fArtist.textContent = track.artist || '';

      if (fPlayIcon) {
        if (this.player.isPlaying) {
          fPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        } else {
          fPlayIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
        }
      }
    }
  }

  // 실시간 재생시간 및 가사 PiP 화면에 동기화
  syncPiPProgress(currentTime, duration, percent, currentLyricText = '') {
    // 1. Document PiP 진행률 & 가사
    if (this.pipWindow && !this.pipWindow.closed) {
      const doc = this.pipWindow.document;
      const fill = doc.getElementById('pip-seek-fill');
      const cur = doc.getElementById('pip-time-cur');
      const dur = doc.getElementById('pip-time-dur');
      const lyricsBox = doc.getElementById('pip-lyrics');

      if (fill) fill.style.width = `${percent}%`;
      if (cur) cur.textContent = this.ui.formatTime(currentTime);
      if (dur) dur.textContent = this.ui.formatTime(duration);

      if (lyricsBox && currentLyricText) {
        lyricsBox.textContent = currentLyricText;
      }
    }

    // 2. 인페이지 플로팅 진행률 & 가사
    if (this.isFloatingOpen) {
      const fLyrics = document.getElementById('floating-pip-lyrics');
      if (fLyrics && currentLyricText) {
        fLyrics.textContent = currentLyricText;
      }
    }
  }
}
