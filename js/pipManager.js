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

    this.isNativePiPActive = false;
    this.pipCanvasTimer = null;
    this.cachedCoverImg = null;
    this.cachedCoverUrl = null;
    this.currentLyricText = '';

    this.initInPageFloatingPip();
  }

  // 브라우저 공식 Document Picture-in-Picture 지원 여부 확인 (PC 크롬 116+)
  isDocPiPSupported() {
    return 'documentPictureInPicture' in window;
  }

  // HTML5 Video Picture-in-Picture 지원 여부 확인 (모바일 안드로이드, 삼성인터넷, 크롬)
  isVideoPiPSupported() {
    return (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled) ||
           (typeof HTMLVideoElement !== 'undefined' && 'requestPictureInPicture' in HTMLVideoElement.prototype);
  }

  // PiP 열기/닫기 토글
  async togglePiP() {
    // 1. 이미 네이티브 Video PiP가 활성화되어 있다면 닫기
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        this.ui.showToast('화면 속 화면 (PIP)이 종료되었습니다.');
        return;
      } catch (e) {}
    }

    if (this.pipWindow) {
      this.pipWindow.close();
      this.pipWindow = null;
      return;
    }

    // 2. 모바일 브라우저(삼성인터넷, 모바일 크롬 등) 환경에서는 실제 안드로이드 시스템 PIP를 띄우는 네이티브 Canvas Video PiP 우선 실행!
    const isMobile = /Android|iPhone|iPad|iPod|SamsungBrowser/i.test(navigator.userAgent) || window.innerWidth <= 768;
    if (isMobile && this.isVideoPiPSupported()) {
      try {
        await this.openNativeVideoPiP();
        return;
      } catch (err) {
        console.warn("Mobile native video PiP failed, trying fallback:", err);
      }
    }

    // 3. 데스크톱 환경에서는 Document Picture-in-Picture 실행
    if (this.isDocPiPSupported()) {
      try {
        await this.openDocumentPiP();
        return;
      } catch (err) {
        console.warn("Document PiP failed, falling back to Video/Floating PiP:", err);
      }
    }

    // 4. Document PiP 미지원 시 네이티브 Video PiP 시도
    if (this.isVideoPiPSupported()) {
      try {
        await this.openNativeVideoPiP();
        return;
      } catch (e) {}
    }

    // 5. 최후 폴백: 웹페이지 내부 인페이지 플로팅 미니 플레이어 토글
    this.toggleInPageFloating();
  }

  // 모바일 삼성인터넷/크롬용 네이티브 Video PiP (실제 안드로이드 OS 시스템 플로팅 창 생성)
  async openNativeVideoPiP() {
    const track = this.player.getCurrentTrack();
    if (!track) {
      this.ui.showToast('재생 중인 곡이 없습니다.');
      return;
    }

    let video = document.getElementById('native-pip-video');
    let canvas = document.getElementById('native-pip-canvas');
    if (!video) {
      video = document.createElement('video');
      video.id = 'native-pip-video';
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-999;';
      document.body.appendChild(video);
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'native-pip-canvas';
      canvas.width = 512;
      canvas.height = 512;
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
    }

    // 캔버스 초기 드로잉
    this.renderPiPCanvas(canvas, track, this.currentLyricText);

    // Canvas Video Stream 바인딩
    if (!video.srcObject && canvas.captureStream) {
      try {
        video.srcObject = canvas.captureStream(15);
      } catch (e) {
        console.warn("captureStream error:", e);
      }
    }

    try {
      await video.play();
    } catch (e) {}

    try {
      await video.requestPictureInPicture();
      this.isNativePiPActive = true;
      this.ui.showToast('삼성인터넷 시스템 PIP(화면 속 화면)이 실행되었습니다.');

      video.addEventListener('leavepictureinpicture', () => {
        this.isNativePiPActive = false;
        this.stopPiPCanvasLoop();
      }, { once: true });

      this.startPiPCanvasLoop();
    } catch (err) {
      console.warn("requestPictureInPicture failed:", err);
      this.toggleInPageFloating();
    }
  }

  startPiPCanvasLoop() {
    this.stopPiPCanvasLoop();
    this.pipCanvasTimer = setInterval(() => {
      if (!this.isNativePiPActive) {
        this.stopPiPCanvasLoop();
        return;
      }
      const canvas = document.getElementById('native-pip-canvas');
      const track = this.player.getCurrentTrack();
      if (canvas && track) {
        this.renderPiPCanvas(canvas, track, this.currentLyricText);
      }
    }, 120);
  }

  stopPiPCanvasLoop() {
    if (this.pipCanvasTimer) {
      clearInterval(this.pipCanvasTimer);
      this.pipCanvasTimer = null;
    }
  }

  renderPiPCanvas(canvas, track, lyricText = '') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    // 배경: 짙은 다크 네이비 그라데이션
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#0c0d14');
    bgGrad.addColorStop(1, '#181926');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 앨범 커버 이미지 드로잉
    if (track && track.cover) {
      if (this.cachedCoverUrl !== track.cover) {
        this.cachedCoverUrl = track.cover;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.cachedCoverImg = img;
        };
        img.src = track.cover;
      }

      if (this.cachedCoverImg && this.cachedCoverImg.complete) {
        ctx.save();
        const imgSize = 240;
        const imgX = (w - imgSize) / 2;
        const imgY = 40;
        const r = 24;
        ctx.beginPath();
        ctx.moveTo(imgX + r, imgY);
        ctx.arcTo(imgX + imgSize, imgY, imgX + imgSize, imgY + imgSize, r);
        ctx.arcTo(imgX + imgSize, imgY + imgSize, imgX, imgY + imgSize, r);
        ctx.arcTo(imgX, imgY + imgSize, imgX, imgY, r);
        ctx.arcTo(imgX, imgY, imgX + imgSize, imgY, r);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(this.cachedCoverImg, imgX, imgY, imgSize, imgSize);
        ctx.restore();
      }
    }

    // 움직이는 이퀄라이저 비주얼라이저 바 (재생 중일 때 실시간 파동)
    const isPlaying = this.player && this.player.isPlaying;
    const now = Date.now() / 150;
    const barCount = 18;
    const barWidth = 6;
    const barGap = 6;
    const totalBarWidth = barCount * (barWidth + barGap);
    const startX = (w - totalBarWidth) / 2;
    const baseBarY = 320;

    ctx.fillStyle = '#ff0055';
    for (let i = 0; i < barCount; i++) {
      const height = isPlaying ? Math.abs(Math.sin(now + i * 0.4)) * 26 + 6 : 4;
      const x = startX + i * (barWidth + barGap);
      const y = baseBarY - height / 2;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, height, 3);
      } else {
        ctx.rect(x, y, barWidth, height);
      }
      ctx.fill();
    }

    // 곡 제목 텍스트
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    const title = track?.title || '재생 중인 곡 없음';
    ctx.fillText(title.length > 22 ? title.slice(0, 20) + '...' : title, w / 2, 375);

    // 아티스트 텍스트
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const artist = track?.artist || 'Streamvance';
    ctx.fillText(artist.length > 26 ? artist.slice(0, 24) + '...' : artist, w / 2, 415);

    // 실시간 싱크 가사
    ctx.fillStyle = '#ff4d79';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const lyric = lyricText || 'Streamvance Music';
    ctx.fillText(lyric.length > 28 ? lyric.slice(0, 26) + '...' : lyric, w / 2, 470);
  }

  // 1. 브라우저 창 밖으로 띄우는 공식 Document PiP 팝업 (PC)
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
    this.currentLyricText = currentLyricText;

    // 1. Native Video Canvas PiP 업데이트
    if (this.isNativePiPActive) {
      const canvas = document.getElementById('native-pip-canvas');
      const track = this.player.getCurrentTrack();
      if (canvas && track) {
        this.renderPiPCanvas(canvas, track, currentLyricText);
      }
    }

    // 2. Document PiP 진행률 & 가사
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

    // 3. 인페이지 플로팅 진행률 & 가사
    if (this.isFloatingOpen) {
      const fLyrics = document.getElementById('floating-pip-lyrics');
      if (fLyrics && currentLyricText) {
        fLyrics.textContent = currentLyricText;
      }
    }
  }
}
