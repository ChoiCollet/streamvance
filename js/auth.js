// ==========================================================================
// Google OAuth & Music Taste Analyzer (AI Music DNA & Smart Recommendations)
// ==========================================================================

export const DEFAULT_GOOGLE_CLIENT_ID = '498281456710-j65e94rqobf3qih5gc9n0paghipckemb.apps.googleusercontent.com';

export class AuthManager {
  constructor(uiManager, player) {
    this.ui = uiManager;
    this.player = player;
    this.currentUser = null;
    // 공식 구글 클라이언트 ID 자동 적용
    const savedClientId = localStorage.getItem('streamvance_google_client_id');
    this.clientId = (savedClientId && !savedClientId.includes('YOUR_GOOGLE')) ? savedClientId : DEFAULT_GOOGLE_CLIENT_ID;
    localStorage.setItem('streamvance_google_client_id', this.clientId);
    
    this.allTracks = [];
    
    // 로컬 스토리지에서 이전 로그인 세션 복구
    this.loadSession();
    // UI 동기화
    this.updateUserUI();
    // Google OAuth 콜백 감지
    this.checkOAuthCallback();
  }

  setAllTracks(tracks) {
    if (Array.isArray(tracks)) {
      this.allTracks = tracks;
    }
  }

  loadSession() {
    try {
      const saved = localStorage.getItem('streamvance_user');
      if (saved) {
        this.currentUser = JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load user session", e);
    }
  }

  saveSession(user) {
    this.currentUser = user;
    try {
      localStorage.setItem('streamvance_user', JSON.stringify(user));
    } catch (e) {}
  }

  clearSession() {
    this.currentUser = null;
    try {
      localStorage.removeItem('streamvance_user');
    } catch (e) {}
  }

  // Google Identity Services (GIS) 초기화
  initGoogleAuth() {
    if (this.clientId && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.initialize({
          client_id: this.clientId,
          callback: (response) => {
            if (response?.credential) {
              try {
                const payload = JSON.parse(decodeURIComponent(escape(atob(response.credential.split('.')[1]))));
                const user = {
                  id: payload.sub,
                  name: payload.name || 'Google 사용자',
                  email: payload.email,
                  picture: payload.picture,
                  isGoogle: true,
                  connectedAt: Date.now()
                };
                this.saveSession(user);
                this.updateUserUI();
                this.ui.showToast(`환영합니다, ${user.name}님!`);
                this.closeSignInModal();
                if (this.onUserLogin) this.onUserLogin(user);
              } catch (e) {}
            }
          }
        });
      } catch (err) {
        console.warn("Google Auth Init Warning:", err);
      }
    }
  }

  // Google OAuth 리다이렉트 후 반환된 access_token 확인
  checkOAuthCallback() {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      if (accessToken) {
        window.history.replaceState(null, '', window.location.pathname);
        this.fetchGoogleUserProfile(accessToken);
      }
    }
  }

  // Google API로부터 실제 로그인한 사용자의 프로필 정보 수신 및 YouTube 음악 데이터 동기화
  async fetchGoogleUserProfile(accessToken) {
    try {
      this.ui.showToast('Google 인증 완료! 계정 정보를 연동 중입니다...');
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const profile = await res.json();
        const user = {
          id: profile.sub,
          name: profile.name || 'Google 사용자',
          email: profile.email,
          picture: profile.picture || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(profile.email || 'user')}`,
          isGoogle: true,
          accessToken: accessToken,
          connectedAt: Date.now()
        };
        this.saveSession(user);
        this.updateUserUI();
        this.ui.showToast(`환영합니다, ${user.name}님! YouTube 음악 데이터를 불러옵니다.`);
        if (this.onUserLogin) this.onUserLogin(user);

        // 실제 유튜브 계정의 '좋아요 표시한 음악' 및 '내 플레이리스트' 자동 동기화
        await this.fetchYouTubeLikedVideos(accessToken);
      }
    } catch (e) {
      console.error("Google userinfo fetch error:", e);
      this.ui.showToast('Google 계정 정보를 가져오는 중 오류가 발생했습니다.');
    }
  }

  // 실제 유튜브 '좋아요 표시한 동영상/음악' (Liked Videos/Music) API 연동
  async fetchYouTubeLikedVideos(accessToken) {
    if (!accessToken) return;
    try {
      const res = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=LL&maxResults=50', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        const syncedTracks = [];

        items.forEach(item => {
          const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
          const snip = item.snippet;
          if (!videoId || !snip) return;

          const title = snip.title;
          const channel = snip.videoOwnerChannelTitle?.replace(/ - Topic$/i, '') || snip.channelTitle || 'YouTube Music';
          const thumbs = snip.thumbnails || {};
          const cover = thumbs.high?.url || thumbs.medium?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          const trackObj = {
            id: `yt-${videoId}`,
            videoId: videoId,
            title: title,
            artist: channel,
            album: 'YouTube 좋아요 음악',
            genre: 'pop',
            mood: 'all',
            duration: 210,
            cover: cover,
            lyrics: [],
            isLiked: true
          };

          this.ui.likedTracksMap.set(trackObj.id, trackObj);
          this.ui.likedTrackIds.add(trackObj.id);
          if (!this.allTracks.find(t => t.id === trackObj.id || t.videoId === videoId)) {
            this.allTracks.unshift(trackObj);
          }
          syncedTracks.push(trackObj);
        });

        if (syncedTracks.length > 0) {
          this.ui.saveLibraryState();
          this.ui.updateLikesCount();
          this.ui.showToast(`YouTube 좋아요 음악 ${syncedTracks.length}곡이 보관함에 동기화되었습니다!`);

          const activeTab = document.querySelector('.lib-tab.active');
          if (activeTab && activeTab.getAttribute('data-lib') === 'likes') {
            this.ui.renderLibrary('likes', this.allTracks);
          }
        }
      } else {
        console.warn('YouTube Liked API response not ok:', res.status);
      }
    } catch (err) {
      console.warn('YouTube Liked Videos fetch error:', err);
    }
  }

  // 공식 Google OAuth 2.0 외부 로그인 페이지로 즉시 이동 (YouTube 읽기 권한 포함)
  launchRealGoogleOAuth(customClientId = '') {
    const clientId = (customClientId || this.clientId || DEFAULT_GOOGLE_CLIENT_ID).trim();
    
    // index.html 등 서브 파일명을 제거하고 일관된 루트 URI로 정규화
    let cleanPath = window.location.pathname.replace(/\/index\.html$/i, '');
    if (!cleanPath.endsWith('/')) cleanPath += '/';
    const redirectUri = window.location.origin + cleanPath;
    
    // openid, profile, email + YouTube Data API 읽기 권한(좋아요 음악, 재생목록) 요청
    const scope = encodeURIComponent('openid profile email https://www.googleapis.com/auth/youtube.readonly');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}&prompt=select_account`;

    this.ui.showToast('Google 공식 로그인 페이지로 이동합니다...');
    setTimeout(() => {
      window.location.href = authUrl;
    }, 250);
  }

  // 게스트로 즉시 로그인
  loginAsGuest() {
    const user = {
      id: "guest-" + Date.now(),
      name: "게스트 사용자",
      email: "guest@streamvance.io",
      picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      isGoogle: false,
      connectedAt: Date.now()
    };
    this.saveSession(user);
    this.updateUserUI();
    this.ui.showToast("게스트 계정으로 로그인되었습니다!");
    this.closeSignInModal();
    if (this.onUserLogin) this.onUserLogin(user);
  }

  setClientId(newId) {
    this.clientId = newId;
    try {
      localStorage.setItem('streamvance_google_client_id', newId);
    } catch (e) {}
    this.ui.showToast("Google OAuth Client ID가 저장되었습니다.");
  }

  logout() {
    this.clearSession();
    this.closeProfileDropdown();
    this.closeTasteModal();
    this.updateUserUI();
    this.ui.showToast('로그아웃되었습니다.');
  }

  // 상단 프로필 UI 업데이트 (헤더 아바타, 드롭다운 메뉴, 환영 배너 동기화)
  updateUserUI() {
    const avatarImg = document.getElementById('user-avatar-img') || document.querySelector('#user-profile-wrap img');
    const loginBtn = document.getElementById('header-login-btn');
    const profileWrap = document.getElementById('user-profile-wrap');

    // 드롭다운 요소
    const dropdownAvatarImg = document.getElementById('dropdown-avatar-img');
    const dropdownUserName = document.getElementById('dropdown-user-name');
    const dropdownUserEmail = document.getElementById('dropdown-user-email');

    // 개인화 환영 배너 (YouTube Music PC 스크린샷 100% 일치)
    const welcomeBanner = document.getElementById('user-welcome-banner');
    const welcomeAvatarImg = document.getElementById('welcome-avatar-img');
    const welcomeUserName = document.getElementById('welcome-user-name');

    if (this.currentUser) {
      const userPic = this.currentUser.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80';
      const userName = this.currentUser.name || '사용자';
      const userEmail = this.currentUser.email || '';

      if (avatarImg) avatarImg.src = userPic;
      if (loginBtn) loginBtn.style.display = 'none';
      if (profileWrap) profileWrap.style.display = 'flex';

      if (dropdownAvatarImg) dropdownAvatarImg.src = userPic;
      if (dropdownUserName) dropdownUserName.textContent = userName;
      if (dropdownUserEmail) dropdownUserEmail.textContent = userEmail;

      if (welcomeBanner) {
        welcomeBanner.style.display = 'flex';
        if (welcomeAvatarImg) welcomeAvatarImg.src = userPic;
        if (welcomeUserName) welcomeUserName.textContent = userName;
      }

      // 모바일 사이드바 사용자 계정 동기화
      const sbLoginBtn = document.getElementById('sidebar-login-btn');
      const sbUserProfile = document.getElementById('sidebar-user-profile');
      const sbUserAvatar = document.getElementById('sidebar-user-avatar');
      const sbUserName = document.getElementById('sidebar-user-name');
      const sbUserEmail = document.getElementById('sidebar-user-email');
      if (sbLoginBtn) sbLoginBtn.style.display = 'none';
      if (sbUserProfile) sbUserProfile.style.display = 'flex';
      if (sbUserAvatar) sbUserAvatar.src = userPic;
      if (sbUserName) sbUserName.textContent = userName;
      if (sbUserEmail) sbUserEmail.textContent = userEmail;
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (profileWrap) profileWrap.style.display = 'none';
      if (welcomeBanner) welcomeBanner.style.display = 'none';

      // 모바일 사이드바 미로그인 상태 동기화
      const sbLoginBtn = document.getElementById('sidebar-login-btn');
      const sbUserProfile = document.getElementById('sidebar-user-profile');
      if (sbLoginBtn) sbLoginBtn.style.display = 'flex';
      if (sbUserProfile) sbUserProfile.style.display = 'none';

      this.closeProfileDropdown();
    }
  }

  // 드롭다운 메뉴 열기/닫기
  toggleProfileDropdown(force) {
    const dropdown = document.getElementById('user-profile-dropdown');
    if (!dropdown) return;
    const isCurrentlyOpen = dropdown.classList.contains('open');
    const shouldOpen = (typeof force === 'boolean') ? force : !isCurrentlyOpen;
    if (shouldOpen) {
      dropdown.classList.add('open');
    } else {
      dropdown.classList.remove('open');
    }
  }

  closeProfileDropdown() {
    const dropdown = document.getElementById('user-profile-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }

  // 모달 제어
  openSignInModal() {
    this.closeProfileDropdown();
    const modal = document.getElementById('google-signin-modal');
    if (modal) modal.classList.add('open');
  }

  closeSignInModal() {
    const modal = document.getElementById('google-signin-modal');
    if (modal) modal.classList.remove('open');
  }

  openTasteModal() {
    this.closeProfileDropdown();
    const modal = document.getElementById('taste-dna-modal');
    if (modal) {
      modal.classList.add('open');
      this.renderTasteAnalysis();
    }
  }

  closeTasteModal() {
    const modal = document.getElementById('taste-dna-modal');
    if (modal) modal.classList.remove('open');
  }

  // 하위 호환성 래퍼
  openAuthModal() {
    if (this.currentUser) {
      this.toggleProfileDropdown();
    } else {
      this.openSignInModal();
    }
  }

  closeAuthModal() {
    this.closeSignInModal();
    this.closeTasteModal();
    this.closeProfileDropdown();
  }

  // ==========================================================================
  // 음악 취향 분석 엔진 (Music DNA Analyzer)
  // ==========================================================================
  analyzeUserTaste(allTracks = []) {
    const likedTracks = this.ui.likedTracksMap ? Array.from(this.ui.likedTracksMap.values()) : [];
    const historyTracks = this.ui.playHistory || [];
    
    // 선호 곡 풀 (좋아요한 곡 가중치 2, 재생 히스토리 가중치 1)
    const genreScore = {};
    const artistScore = {};
    const moodScore = {};

    const processTrack = (track, weight = 1) => {
      if (!track) return;
      // 장르
      const g = track.genre || 'pop';
      genreScore[g] = (genreScore[g] || 0) + weight;
      // 아티스트
      const a = track.artist || 'Unknown';
      artistScore[a] = (artistScore[a] || 0) + weight;
      // 무드
      const m = track.mood || 'energy';
      moodScore[m] = (moodScore[m] || 0) + weight;
    };

    likedTracks.forEach(t => processTrack(t, 2));
    historyTracks.forEach(t => processTrack(t, 1));

    // Google Takeout으로 가져온 아티스트 빈도수 가산 반영
    try {
      const savedTakeoutArtists = localStorage.getItem('streamvance_takeout_top_artists');
      if (savedTakeoutArtists) {
        const parsed = JSON.parse(savedTakeoutArtists);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item.artist && item.count) {
              artistScore[item.artist] = (artistScore[item.artist] || 0) + Math.min(item.count, 20);
            }
          });
        }
      }
    } catch (e) {}

    // 기본 시드(아직 활동이 적을 때)
    if (Object.keys(genreScore).length === 0) {
      genreScore['pop'] = 4;
      genreScore['dance'] = 3;
      genreScore['rock'] = 2;
      artistScore['aespa (에스파)'] = 3;
      artistScore['NewJeans (뉴진스)'] = 3;
      artistScore['로제 (ROSÉ), Bruno Mars'] = 2;
      moodScore['energy'] = 5;
      moodScore['chill'] = 3;
    }

    const totalGenreScore = Object.values(genreScore).reduce((a, b) => a + b, 0);
    const sortedGenres = Object.entries(genreScore)
      .map(([genre, count]) => ({ genre, percent: Math.round((count / totalGenreScore) * 100) }))
      .sort((a, b) => b.percent - a.percent);

    const sortedArtists = Object.entries(artistScore)
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const topMood = Object.entries(moodScore).sort((a, b) => b[1] - a[1])[0]?.[0] || 'energy';

    return {
      genres: sortedGenres,
      artists: sortedArtists,
      topMood: topMood,
      likedCount: likedTracks.length,
      historyCount: historyTracks.length
    };
  }

  // 취향 분석 화면 렌더링
  renderTasteAnalysis() {
    const container = document.getElementById('taste-analysis-content');
    if (!container) return;

    const stats = this.analyzeUserTaste();

    const genreLabelMap = {
      pop: 'K-POP & Global Pop',
      dance: '댄스 & 일렉트로닉',
      rock: '모던 록 & 밴드 사운드',
      rnb: 'R&B & 소울',
      hiphop: '힙합 & 트랩',
      ballad: '감성 발라드'
    };

    const moodLabelMap = {
      energy: '에너지 & 활기찬 비트 ⚡',
      chill: '편안한 칠 & 휴식 ☕',
      focus: '깊은 몰입 & 집중 🎧',
      workout: '파워풀 운동 & 러닝 🔥'
    };

    container.innerHTML = `
      <div class="taste-header-card">
        <div class="taste-user-badge">
          <img src="${this.currentUser?.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}" class="taste-avatar" alt="User">
          <div>
            <h3 class="taste-user-name">${this.currentUser?.name || '게스트'}님의 음악 DNA</h3>
            <p class="taste-desc">최근 감상 패턴과 좋아요 곡을 기반으로 실시간 분석한 맞춤 취향 리포트입니다.</p>
          </div>
        </div>
        <div class="taste-stats-pills">
          <span class="taste-pill">좋아요 ${stats.likedCount}곡</span>
          <span class="taste-pill">감상 기록 ${stats.historyCount}곡</span>
          <span class="taste-pill highlight">${moodLabelMap[stats.topMood] || stats.topMood}</span>
        </div>
      </div>

      <div class="taste-section">
        <h4 class="taste-subhead"><i data-lucide="pie-chart"></i> 선호 장르 분포</h4>
        <div class="genre-bars">
          ${stats.genres.slice(0, 4).map(g => `
            <div class="genre-bar-item">
              <div class="genre-bar-label">
                <span>${genreLabelMap[g.genre] || g.genre.toUpperCase()}</span>
                <span>${g.percent}%</span>
              </div>
              <div class="genre-progress-track">
                <div class="genre-progress-fill" style="width: ${g.percent}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="taste-section">
        <h4 class="taste-subhead"><i data-lucide="sparkles"></i> 최애 아티스트</h4>
        <div class="favorite-artists-grid">
          ${stats.artists.map(a => `
            <div class="favorite-artist-chip">
              <i data-lucide="music-2"></i>
              <span>${a.artist}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="taste-actions">
        <button class="btn-create-taste-mix" id="btn-play-taste-mix">
          <i data-lucide="play-circle"></i>
          <span>내 취향 맞춤 스테이션 재생</span>
        </button>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    // 맞춤 스테이션 재생 버튼 클릭 이벤트
    const btnPlayMix = document.getElementById('btn-play-taste-mix');
    if (btnPlayMix) {
      btnPlayMix.addEventListener('click', () => {
        this.playSmartTasteMix(stats.topMood, stats.genres[0]?.genre);
        this.closeAuthModal();
      });
    }
  }

  // 취향 맞춤 믹스 즉시 재생
  playSmartTasteMix(topMood, topGenre) {
    const all = (this.allTracks && this.allTracks.length > 0) ? this.allTracks : (this.player.queue || []);
    // 상위 무드나 장르에 맞는 곡들을 우선 배치
    const matched = all.filter(t => t.mood === topMood || t.genre === topGenre);
    const others = all.filter(t => t.mood !== topMood && t.genre !== topGenre);
    const smartMix = [...matched, ...others];

    if (smartMix.length > 0) {
      this.player.setQueue(smartMix, 0, true);
      this.ui.showToast(`'${this.currentUser?.name || '나'}의 맞춤 취향 믹스' 재생 시작!`);
    }
  }
}
