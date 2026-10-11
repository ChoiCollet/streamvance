// ==========================================================================
// Hybrid Audio Engine: HTML5 Native Audio (Background-safe) + YouTube IFrame
// Mobile: yt-dlp 서버 프록시 → HTML5 <audio> (백그라운드 재생 100% 지원)
// Desktop: YouTube IFrame API (비디오 모드) + HTML5 audio 폴백
// ==========================================================================

export class AudioPlayer {
  constructor(audioElement) {
    this.audio = audioElement;
    this.ytPlayer = null;
    this.isYTReady = false;
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all'; // 'off' | 'all' | 'one'
    this.volume = 0.8;
    this.isMuted = false;
    this.syncInterval = null;
    this.loadRetryTimer = null;

    // 호스트 환경 감지: Python 로컬 서버(server.py) 및 Cloudflare Pages Edge Function(/api/audio-stream) 모두 지원
    this.streamServerBase = (typeof localStorage !== 'undefined' ? localStorage.getItem('streamvance_stream_server') : '') || '';
    // Cloudflare Pages Function 및 로컬 환경 모두에서 네이티브 백그라운드 오디오 스트림 활성화
    this.serverSupportsAudioStream = true;
    this.preferNativeAudio = true; // 음원 모드에서는 상시 고품질 무중단 네이티브 오디오 우선!
    this.useNativeAudio = false;  // true = HTML5 <audio> 사용 중, false = YouTube IFrame 사용 중
    this.currentMediaMode = 'song'; // 'song' | 'video'
    this._isTransitioningToVideo = false;
    this._audioUrlFetching = null; // 현재 진행 중인 오디오 URL 추출 요청 AbortController
    this._isLoadingNativeAudio = false; // 네이티브 오디오 로딩/프라이밍 진행 중 플래그
    this._loadSessionId = 0; // 비동기 응답 경합(Race Condition) 방지용 세션 카운터

    // 모바일 브라우저 감지 (Android/iOS/삼성인터넷)
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SamsungBrowser/i.test(navigator.userAgent);

    // Callbacks
    this.callbacks = {
      onTrackChange: null,
      onPlayStateChange: null,
      onTimeUpdate: null,
      onQueueUpdate: null,
      onVolumeChange: null,
      onAutoRecommendNext: null
    };

    this.isUserPaused = false;

    this.initHTML5AudioListeners();
    this.initYouTubePlayer();
    this.initMediaSession();
    this.initBgKeepAlive();
  }

  // YouTube IFrame API 초기화
  // YouTube IFrame API 초기화
  initYouTubePlayer() {
    const setupYT = () => {
      if (window.YT && window.YT.Player) {
        const pageOrigin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
        const pageHref = (typeof window !== 'undefined' && window.location) ? window.location.href : '';

        this.ytPlayer = new window.YT.Player('youtube-player-hidden', {
          height: '200',
          width: '200',
          host: 'https://www.youtube.com',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            origin: pageOrigin,
            widget_referrer: pageHref,
            playsinline: 1,
            html5: 1,
            rel: 0,
            fs: 0,
            iv_load_policy: 3
          },
          events: {
            onReady: (event) => {
              this.isYTReady = true;
              this.ensureAudioSound();
              console.log("YouTube Player is ready!");
            },
            onStateChange: (event) => {
              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0, BUFFERING = 3
              // [핵심] 현재 네이티브 오디오 모드(HTML5 <audio>)로 재생 중이라면:
              if (this.useNativeAudio) {
                if (this._isTransitioningToVideo && event.data === 1) {
                  // 비디오 모드 전환 완료: 프레임이 실제로 재생되기 시작하면 네이티브 오디오를 정지하여 묵음 0초 실현
                  this._isTransitioningToVideo = false;
                  this.useNativeAudio = false;
                  if (this.audio && !this.audio.paused) {
                    try { this.audio.pause(); } catch (e) {}
                  }
                } else {
                  if (event.data === 1 && !this._isTransitioningToVideo) {
                    try { this.ytPlayer.pauseVideo(); } catch (e) {}
                  }
                  return;
                }
              }

              if (event.data === 1) {
                this.isPlaying = true;
                this.isUserPaused = false;
                this.ensureAudioSound();

                // 비디오 정상 재생 시 임베드 제한 안내 오버레이 숨김
                const noticeEl = document.getElementById('video-embed-notice-overlay');
                if (noticeEl) noticeEl.style.display = 'none';

                // 목표 동기화 시간 검증 및 보정 (미세 차이로 인한 1초 뒤로 점프 현상 방지: 2.5초 이상 편차 시만 보정)
                if (this._targetSyncTime !== undefined && this._targetSyncTime > 1) {
                  const target = this._targetSyncTime;
                  this._targetSyncTime = undefined;
                  const current = (typeof this.ytPlayer.getCurrentTime === 'function') ? this.ytPlayer.getCurrentTime() : 0;
                  if (current < target - 2.5 || current > target + 3.0) {
                    try { this.ytPlayer.seekTo(target, true); } catch (e) {}
                  }
                }

                this.startProgressSync();
                this.startBgKeepAlive();
                this.syncMediaSessionPlaybackState();
                if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
              } else if (event.data === 2) {
                if (this.isUserPaused) {
                  // 사용자가 UI 또는 알림창에서 직접 일시정지를 누른 정상 일시정지
                  this.isPlaying = false;
                  this.stopProgressSync();
                  this.stopBgKeepAlive();
                  this.syncMediaSessionPlaybackState();
                  if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
                } else {
                  // [삼성인터넷 & 모바일 브라우저 백그라운드 전환 시 일시정지 무중단 방어]
                  this.ensureSilentAnchorRunning();
                  this.startBgKeepAlive();
                  this.forceResumePlayback();

                  // 화면 꺼짐 직후 브라우저 비디오 스로틀링으로 일시정지 상태가 된 경우,
                  // 잠금화면 및 알림창에 [ ▶ 재생 ] 버튼이 즉시 노출되도록 동기화 (원터치 즉각 재개 보장)
                  setTimeout(() => {
                    if (this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function') {
                      const curState = this.ytPlayer.getPlayerState();
                      if (curState === 2 && !this.isUserPaused && !this.useNativeAudio) {
                        const curTrack = this.getCurrentTrack();
                        if (curTrack) {
                          this.updateMediaSession(curTrack);
                        }
                        if ('mediaSession' in navigator) {
                          navigator.mediaSession.playbackState = 'paused';
                        }
                        if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
                      }
                    }
                  }, 200);
                }
              } else if (event.data === 0) {
                // 재생 완료 시 (네이티브 오디오 모드에서는 무시)
                if (this.useNativeAudio) return;
                if (this.repeatMode === 'one') {
                  this.ytPlayer.seekTo(0, true);
                  this.ytPlayer.playVideo();
                } else {
                  this.nextTrack(false);
                }
              }
            },
            onError: (err) => {
              console.warn("YouTube Playback Error:", err);
              // 네이티브 오디오 단독 재생 중일 때만 유튜브 오류 무시 (비디오 전환 중일 때는 오류를 정상 핸들링!)
              if (this.useNativeAudio && !this._isTransitioningToVideo) return;

              const errorCode = err?.data !== undefined ? err.data : err;
              // 101, 150, 152: 퍼가기 제한 영상 (외부 사이트 임베드 차단 - "시청할 수 없는 동영상입니다")
              // 100, 105: 영상 오류/삭제/비공개
              // 2: 잘못된 매개변수
              if (errorCode === 101 || errorCode === 150 || errorCode === 152 || errorCode === 100 || errorCode === 105 || errorCode === 2) {
                console.log("[AudioPlayer] Embed restricted video detected (code " + errorCode + "). Handling gracefully without interrupting playback...");
                const curTrack = this.getCurrentTrack();
                const curTime = Math.max(0, this.getCurrentTime() || 0);

                if (curTrack) {
                  this._handleEmbedRestrictedVideo(curTrack, curTime);
                }
                return;
              }

              if (!this.useNativeAudio && this.isPlaying) {
                setTimeout(() => {
                  if (!this.useNativeAudio && this.isPlaying) {
                    this.nextTrack(true);
                  }
                }, 1500);
              }
            }
          }
        });
      } else {
        setTimeout(setupYT, 200);
      }
    };

    if (window.onYouTubeIframeAPIReady) {
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevReady();
        setupYT();
      };
    } else {
      window.onYouTubeIframeAPIReady = setupYT;
    }

    // 이미 스크립트가 로드되었을 경우 대비
    if (window.YT && window.YT.Player) {
      setupYT();
    }
  }

  initHTML5AudioListeners() {
    this.audio.volume = this.isMuted ? 0 : Math.min(1, this.volume * 0.78);

    this.audio.addEventListener('play', () => {
      if (this.isCurrentLocal()) {
        this.isPlaying = true;
        this.isUserPaused = false;
        this.startBgKeepAlive();
        this.syncMediaSessionPlaybackState();
        if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
      }
    });

    this.audio.addEventListener('pause', () => {
      if (this.isCurrentLocal()) {
        if (this.isUserPaused) {
          this.isPlaying = false;
          this.stopBgKeepAlive();
          this.syncMediaSessionPlaybackState();
          if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
        } else {
          // 백그라운드 비자발적 pause 방어
          this.isPlaying = true;
          this.startBgKeepAlive();
          this.syncMediaSessionPlaybackState();
          try { this.audio.play(); } catch (e) {}
        }
      }
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.isCurrentLocal()) {
        const current = this.audio.currentTime;
        const duration = this.audio.duration || 0;
        const percent = duration > 0 ? (current / duration) * 100 : 0;
        let bufferPercent = 0;
        if (this.audio.buffered && this.audio.buffered.length > 0 && duration > 0) {
          bufferPercent = Math.min(100, (this.audio.buffered.end(this.audio.buffered.length - 1) / duration) * 100);
        }
        if (this.callbacks.onTimeUpdate) {
          this.callbacks.onTimeUpdate(current, duration, percent, bufferPercent);
        }
      }
    });

    this.audio.addEventListener('ended', () => {
      // 1. 프라이밍 무음 오디오이거나 로딩 중일 때는 절대 다음 곡 스킵 금지
      if (this._isLoadingNativeAudio || !this.audio.src || this.audio.src.startsWith('data:') || this.audio.src.includes('silent')) {
        return;
      }
      // 2. 오디오 길이가 비정상적으로 짧은 경우(3초 미만)에도 자동 스킵 방지
      if (this.audio.duration && this.audio.duration < 3) {
        return;
      }
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.nextTrack(false);
      }
    });

    this.audio.addEventListener('error', (e) => {
      if (this._isLoadingNativeAudio || !this.audio.src || this.audio.src.startsWith('data:') || this.audio.src.includes('silent')) {
        return;
      }
      console.warn('[HTML5 Audio] Playback error encountered:', e);
      // 네이티브 오디오 로드 실패 시 음악이 멈추지 않도록 YouTube IFrame으로 자동 복구 폴백
      if (this.useNativeAudio && this.isPlaying) {
        const curTrack = this.getCurrentTrack();
        if (curTrack && curTrack.videoId) {
          console.warn('[HTML5 Audio] Auto-recovering via YouTube IFrame player');
          this.useNativeAudio = false;
          this._loadYouTubeIFrame(curTrack, true);
        }
      }
    });
  }

  // 1. 삼성인터넷 & 모바일 브라우저 무중단 백그라운드 재생 마스터 엔진
  initBgKeepAlive() {
    this.bgPulseWorker = null;
    this.bgKeepAliveAudio = null;
    this.nativeVideoAnchor = null;
    this.webAudioCtx = null;

    // A. 60초 유효 PCM WAV 오디오 캐리어 생성 (안드로이드 크롬 5초 이상 세션 유지 기준 완벽 충족)
    // 모바일 OS(안드로이드/iOS)가 오디오 하드웨어 세션을 닫지 않도록 Audio Focus 상시 유지
    try {
      const createSilentWav = () => {
        const sampleRate = 8000;
        const numSamples = sampleRate * 60; // 60초 지속 버퍼 (Android 5초 이상 Audio Focus 룰 통과)
        const buffer = new ArrayBuffer(44 + numSamples * 2);
        const view = new DataView(buffer);
        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + numSamples * 2, true);
        view.setUint32(8, 0x57415645, false); // "WAVE"
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, numSamples * 2, true);
        return new Blob([buffer], { type: 'audio/wav' });
      };

      const silentBlob = createSilentWav();
      const silentUrl = URL.createObjectURL(silentBlob);

      let el = document.getElementById('streamvance-bg-audio-anchor');
      if (!el) {
        el = new Audio();
        el.id = 'streamvance-bg-audio-anchor';
        document.body.appendChild(el);
      }
      el.src = silentUrl;
      el.loop = true;
      el.volume = 0.02; // Android OS가 음소거(Muted)로 간주하여 오디오 포커스를 해제하지 않도록 안전 레벨 유지
      el.playsInline = true;
      this.bgKeepAliveAudio = el;
    } catch (e) {
      console.warn("Silent audio carrier init error:", e);
    }

    // B. Web Audio API 기반 하드웨어 오디오 클록 락 & 무한 라이브 미디어스트림 생성
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.webAudioCtx = new AudioCtx();
        const osc = this.webAudioCtx.createOscillator();
        osc.frequency.value = 20; // 20Hz (인간 가청 주파수 최하한선 초저음 = 완벽한 무음 청취)
        const gain = this.webAudioCtx.createGain();
        gain.gain.value = 0.005;
        osc.connect(gain);
        
        // MediaStreamDestination 기반 무한 라이브 오디오 트랙 생성
        if (typeof this.webAudioCtx.createMediaStreamDestination === 'function' && this.bgKeepAliveAudio) {
          try {
            const dst = this.webAudioCtx.createMediaStreamDestination();
            gain.connect(dst);
            osc.start();
            if ('srcObject' in this.bgKeepAliveAudio) {
              this.bgKeepAliveAudio.srcObject = dst.stream;
            }
          } catch (e) {
            gain.connect(this.webAudioCtx.destination);
            osc.start();
          }
        } else {
          gain.connect(this.webAudioCtx.destination);
          osc.start();
        }
      }
    } catch (e) {
      console.warn("Web Audio keepalive init error:", e);
    }

    // C. 삼성인터넷 동영상 어시스턴트 & 백그라운드 재생 트리거용 네이티브 비디오 앵커 연동
    try {
      let vAnchor = document.getElementById('streamvance-native-video-anchor');
      if (!vAnchor) {
        vAnchor = document.createElement('video');
        vAnchor.id = 'streamvance-native-video-anchor';
        vAnchor.playsInline = true;
        vAnchor.muted = true;
        vAnchor.style.cssText = 'position:fixed;bottom:84px;right:12px;width:16px;height:16px;opacity:0.005;pointer-events:none;z-index:8;';
        document.body.appendChild(vAnchor);
      }
      this.nativeVideoAnchor = vAnchor;

      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, 16, 16);
      }
      if (canvas.captureStream && 'srcObject' in vAnchor) {
        const cStream = canvas.captureStream(1);
        vAnchor.srcObject = cStream;
      }
    } catch (e) {
      console.warn("Native video anchor init error:", e);
    }

    // C. Web Worker 기반 무동결 하트비트 루프
    // 모바일 OS가 화면 꺼짐 시 메인 스레드 타이머(setTimeout/setInterval)를 동결하더라도,
    // Web Worker는 백그라운드 독립 스레드에서 지속적으로 틱(TICK)을 전송하여 메인 스레드를 깨움
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage('TICK');
              }, 250);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.bgPulseWorker = new Worker(workerUrl);
      this.bgPulseWorker.onmessage = (e) => {
        if (e.data === 'TICK') {
          // 화면이 꺼진 암전 상태에서도 지속적인 재생 생명력 사수
          if (this.isPlaying && !this.isUserPaused) {
            this.keepPlaybackAlive();
          }
        }
      };
    } catch (e) {
      console.warn("Web Worker keepalive setup fallback:", e);
    }

    // D. 화면 꺼짐/백그라운드 전환 감지 즉시 안전 재개 방어
    if (typeof document !== 'undefined') {
      const handleBackgroundTransition = () => {
        if (this.isPlaying && !this.isUserPaused) {
          this.startBgKeepAlive();

          // [혁신 기능] 사용자가 동영상 모드로 보다가 홈 화면으로 가거나 화면을 끄는 경우(background):
          // 모바일 브라우저가 비디오 iframe을 강제 일시정지시키므로,
          // 로컬/스트림 서버 환경에서는 0초 만에 백그라운드 안전 네이티브 오디오로 자동 핸드오프!
          if (document.visibilityState === 'hidden' && this.currentMediaMode === 'video' && !this.useNativeAudio && this.serverSupportsAudioStream) {
            const curTrack = this.getCurrentTrack();
            if (curTrack && curTrack.videoId) {
              const curTime = Math.max(0, this.getCurrentTime() || 0);
              console.log("[BackgroundPlay] Video tab hidden/locked. Handoff to native audio at", curTime);
              this._bgVideoHandoff = true;
              this.useNativeAudio = true;
              this._loadNativeAudio(curTrack, true, this._loadSessionId, curTime, () => {
                if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
                  try { this.ytPlayer.pauseVideo(); } catch (e) {}
                }
              });
              return;
            }
          }

          this.forceResumePlayback();
        }
      };

      document.addEventListener('visibilitychange', handleBackgroundTransition, true);
      window.addEventListener('pagehide', handleBackgroundTransition, true);
      window.addEventListener('blur', handleBackgroundTransition, true);
      window.addEventListener('focus', () => {
        if (this.isPlaying && !this.isUserPaused) {
          if (this._bgVideoHandoff && this.currentMediaMode === 'video') {
            this._bgVideoHandoff = false;
            const curTime = Math.max(0, this.getCurrentTime() || 0);
            console.log("[BackgroundPlay] Returned to app: Restoring video from native audio at", curTime);
            this.switchToVideoMode();
          } else {
            this.syncMediaSessionPlaybackState();
            this.forceResumePlayback();
          }
        }
      });
    }

    this.initAudioUnlockListeners();
  }

  // 모바일 브라우저(삼성인터넷/크롬/사파리) 오디오 엔진 영구 언락
  initAudioUnlockListeners() {
    const unlock = () => {
      if (this.webAudioCtx && this.webAudioCtx.state === 'suspended') {
        this.webAudioCtx.resume().catch(() => {});
      }
      if (this.bgKeepAliveAudio && this.bgKeepAliveAudio.paused && this.isPlaying && !this.isUserPaused) {
        this.bgKeepAliveAudio.play().catch(() => {});
      }
      if (this.audio && this.isCurrentLocal()) {
        if (this.isPlaying && !this.isUserPaused) {
          this.audio.play().catch(() => {});
        }
      }
      // [핵심] 네이티브 오디오 모드일 때는 YouTube iframe playVideo()를 절대 실행하지 않음 (중복 재생 및 곡 스킵 원천 차단)
      if (!this.useNativeAudio && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
        if (this.isPlaying && !this.isUserPaused) {
          try {
            const state = typeof this.ytPlayer.getPlayerState === 'function' ? this.ytPlayer.getPlayerState() : -1;
            if (state !== 1) {
              this.ytPlayer.playVideo();
              this.ensureAudioSound();
            }
          } catch (e) {}
        }
      }
    };

    const opts = { capture: true, passive: true };
    ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(evt => {
      window.addEventListener(evt, unlock, opts);
    });
  }

  // 유튜브 플레이어 볼륨 및 음소거 해제 강제 보장 (모바일/PIP 무음 방어)
  ensureAudioSound() {
    if (this.ytPlayer) {
      try {
        if (!this.isMuted) {
          if (typeof this.ytPlayer.unMute === 'function') {
            this.ytPlayer.unMute();
          }
          if (typeof this.ytPlayer.setVolume === 'function') {
            this.ytPlayer.setVolume(this.volume * 100);
          }
        }
      } catch (e) {}
    }
  }

  // 모바일 OS 화면 WakeLock 획득
  ensureSilentAnchorRunning() {
    if (!this.isPlaying || this.isUserPaused) return;

    try {
      if ('wakeLock' in navigator && !this._wakeLock) {
        navigator.wakeLock.request('screen').then(lock => {
          this._wakeLock = lock;
          lock.addEventListener('release', () => {
            this._wakeLock = null;
          });
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // 백그라운드 상태에서 유튜브 플레이어 상태 지속 감시 및 재생 유지
  keepPlaybackAlive() {
    if (!this.isPlaying || this.isUserPaused || this._isSwitchingMediaMode) return;

    this.ensureSilentAnchorRunning();
    if (this.bgKeepAliveAudio && this.bgKeepAliveAudio.paused) {
      this.bgKeepAliveAudio.play().catch(() => {});
    }

    // [핵심] 네이티브 오디오 모드에서는 YouTube IFrame을 건드리지 않고 HTML5 audio만 유지
    if (this.useNativeAudio) {
      if (this.audio && this.audio.paused && !this._isLoadingNativeAudio) {
        try { this.audio.play(); } catch (e) {}
      }
      return;
    }

    if (this.ytPlayer && typeof this.ytPlayer.getPlayerState === 'function') {
      try {
        const state = this.ytPlayer.getPlayerState();
        // 1: PLAYING, 3: BUFFERING
        if (state !== 1 && state !== 3) {
          this.ytPlayer.playVideo();
        }
        this.ensureAudioSound();
      } catch (e) {}
    }
  }

  // 화면 꺼짐 직후 비자발적 정지 발생 시 안전한 지능형 재개
  forceResumePlayback() {
    if (this.isUserPaused || !this.isPlaying || this._isSwitchingMediaMode) return;

    this.ensureSilentAnchorRunning();
    if (this.bgKeepAliveAudio && this.bgKeepAliveAudio.paused) {
      this.bgKeepAliveAudio.play().catch(() => {});
    }

    if (this.useNativeAudio) {
      if (this.audio && this.audio.paused && !this._isLoadingNativeAudio) {
        try { this.audio.play(); } catch (e) {}
      }
      return;
    }

    if (!this.ytPlayer || typeof this.ytPlayer.playVideo !== 'function') return;

    try {
      const state = typeof this.ytPlayer.getPlayerState === 'function' ? this.ytPlayer.getPlayerState() : -1;
      if (state !== 1 && state !== 3) {
        this.ytPlayer.playVideo();
        this.ensureAudioSound();
      }
    } catch (e) {}

    [100, 300, 700].forEach(delay => {
      setTimeout(() => {
        if (!this.isUserPaused && this.isPlaying && !this.useNativeAudio && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
          const s = this.ytPlayer.getPlayerState();
          if (s !== 1 && s !== 3) {
            try {
              this.ytPlayer.playVideo();
              this.ensureAudioSound();
            } catch (e) {}
          }
        }
      }, delay);
    });
  }

  startBgKeepAlive() {
    this.ensureSilentAnchorRunning();
    if (this.webAudioCtx && this.webAudioCtx.state === 'suspended') {
      this.webAudioCtx.resume().catch(() => {});
    }
    if (this.bgKeepAliveAudio && this.bgKeepAliveAudio.paused && this.isPlaying && !this.isUserPaused) {
      this.bgKeepAliveAudio.play().catch(() => {});
    }
    if (this.nativeVideoAnchor && this.nativeVideoAnchor.paused && this.isPlaying && !this.isUserPaused) {
      this.nativeVideoAnchor.play().catch(() => {});
    }
    if (this.bgPulseWorker) {
      try { this.bgPulseWorker.postMessage('start'); } catch (e) {}
    }
  }

  stopBgKeepAlive() {
    if (this.bgKeepAliveAudio && !this.bgKeepAliveAudio.paused) {
      this.bgKeepAliveAudio.pause();
    }
    if (this.nativeVideoAnchor && !this.nativeVideoAnchor.paused) {
      this.nativeVideoAnchor.pause();
    }
    if (!this.isCurrentLocal() && this.audio) {
      this.audio.pause();
    }
    if (this._wakeLock) {
      try { this._wakeLock.release(); } catch (e) {}
      this._wakeLock = null;
    }
    if (this.bgPulseWorker) {
      try { this.bgPulseWorker.postMessage('stop'); } catch (e) {}
    }
  }

  // 2. 모바일 잠금화면, 알림창, 블루투스 이어폰 컨트롤 완벽 연동 (MediaSession API)
  initMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        this.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.prevTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.nextTrack(false);
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details?.seekOffset || 10;
        this.seekRelative(-skipTime);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details?.seekOffset || 10;
        this.seekRelative(skipTime);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details && details.seekTime !== undefined) {
          this.seekTo(details.seekTime);
        }
      });
    } catch (e) {
      console.warn("MediaSession action handler error:", e);
    }
  }

  updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;

    try {
      const coverUrl = track.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=512&auto=format&fit=crop&q=80';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '곡 제목 없음',
        artist: track.artist || 'Streamvance',
        album: track.album || 'Streamvance Music',
        artwork: [
          { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
          { src: coverUrl, sizes: '128x128', type: 'image/jpeg' },
          { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
          { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
          { src: coverUrl, sizes: '384x384', type: 'image/jpeg' },
          { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      this.syncMediaSessionPlaybackState();
    } catch (e) {
      console.warn("MediaSession update error:", e);
    }
  }

  syncMediaSessionPlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
      const curTrack = this.getCurrentTrack();
      const duration = this.getDuration() || curTrack?.duration || 0;
      const current = this.getCurrentTime() || 0;
      if (duration > 0 && navigator.mediaSession.setPositionState) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(duration, current),
          playbackRate: 1.0,
          position: Math.min(current, duration)
        });
      }
    } catch (e) {}
  }

  isCurrentLocal() {
    const track = this.getCurrentTrack();
    // 네이티브 오디오 모드(서버 프록시 스트리밍)이거나 로컬 파일인 경우
    if (this.useNativeAudio) return true;
    return track && !track.videoId && track.audioUrl;
  }

  startProgressSync() {
    this.stopProgressSync();
    this.syncInterval = setInterval(() => {
      if (this.ytPlayer && this.ytPlayer.getCurrentTime && !this.isCurrentLocal()) {
        try {
          const current = this.ytPlayer.getCurrentTime() || 0;
          const duration = this.ytPlayer.getDuration() || (this.getCurrentTrack()?.duration || 0);
          const percent = duration > 0 ? (current / duration) * 100 : 0;
          let bufferPercent = 0;
          if (this.ytPlayer.getVideoLoadedFraction) {
            bufferPercent = Math.min(100, (this.ytPlayer.getVideoLoadedFraction() || 0) * 100);
          }
          if (this.callbacks.onTimeUpdate) {
            this.callbacks.onTimeUpdate(current, duration, percent, bufferPercent);
          }
        } catch (e) {}
      }
    }, 250);
  }

  stopProgressSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  getCurrentTrack() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  getCurrentTime() {
    if (this.isCurrentLocal()) {
      return this.audio.currentTime || 0;
    }
    if (this.ytPlayer && this.ytPlayer.getCurrentTime) {
      try {
        return this.ytPlayer.getCurrentTime() || 0;
      } catch (e) {
        return 0;
      }
    }
    return 0;
  }

  getDuration() {
    if (this.isCurrentLocal()) {
      return this.audio.duration || this.getCurrentTrack()?.duration || 0;
    }
    if (this.ytPlayer && this.ytPlayer.getDuration) {
      try {
        return this.ytPlayer.getDuration() || (this.getCurrentTrack()?.duration || 0);
      } catch (e) {
        return this.getCurrentTrack()?.duration || 0;
      }
    }
    return this.getCurrentTrack()?.duration || 0;
  }

  setQueue(newQueue, startIndex = 0, autoPlay = true) {
    this.queue = [...newQueue];
    this.originalQueue = [...newQueue];
    this.currentIndex = startIndex;

    if (this.isShuffle) {
      this.applyShuffle();
    }

    if (this.callbacks.onQueueUpdate) {
      this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
    }

    if (this.queue.length > 0 && startIndex >= 0) {
      this.loadTrack(this.queue[this.currentIndex], autoPlay);
    }
  }

  loadTrack(track, autoPlay = true) {
    if (!track) return;

    // 진행 중인 오디오 URL 추출 요청 취소
    if (this._audioUrlFetching) {
      try { this._audioUrlFetching.abort(); } catch (e) {}
      this._audioUrlFetching = null;
    }

    // videoId 정규화 (yt- 접두어 제거 및 기본값 보장)
    if (!track.videoId && track.id) {
      if (typeof window !== 'undefined' && Array.isArray(window.allTracks)) {
        const found = window.allTracks.find(t => t.id === track.id);
        if (found && found.videoId) track.videoId = found.videoId;
      }
      if (!track.videoId && typeof track.id === 'string' && !track.audioUrl) {
        track.videoId = track.id.replace(/^yt-/, '');
      }
    }

    if (this.loadRetryTimer) {
      clearInterval(this.loadRetryTimer);
      this.loadRetryTimer = null;
    }

    // 제한 안내 오버레이 초기화
    const noticeEl = document.getElementById('video-embed-notice-overlay');
    if (noticeEl) noticeEl.style.display = 'none';

    // 양쪽 정지 후 로드
    this.audio.pause();
    this._loadSessionId = (this._loadSessionId || 0) + 1;
    const currentSessionId = this._loadSessionId;

    if (autoPlay) {
      this.isPlaying = true;
      this.isUserPaused = false;
      this.startBgKeepAlive();
      this.ensureAudioSound();
    }

    if (track.videoId) {
      // 1) 동영상 모드인 경우: YouTube IFrame으로 영상 직접 로드
      if (this.currentMediaMode === 'video') {
        this.useNativeAudio = false;
        this._loadYouTubeIFrame(track, autoPlay);
      }
      // 2) 음원(Song) 모드이고 서버 스트림 지원 시: HTML5 Native Audio (모바일 백그라운드 무중단 100% 재생)
      else if (this.preferNativeAudio && this.serverSupportsAudioStream) {
        this.useNativeAudio = true;
        if (this.ytPlayer) {
          try {
            if (typeof this.ytPlayer.stopVideo === 'function') this.ytPlayer.stopVideo();
            else if (typeof this.ytPlayer.pauseVideo === 'function') this.ytPlayer.pauseVideo();
          } catch (e) {}
        }
        this._loadNativeAudio(track, autoPlay, currentSessionId);
      }
      // 3) 음원 모드이지만 스트림 서버 미지원 환경 (Cloudflare Pages 등): YouTube IFrame 로드
      else {
        this.useNativeAudio = false;
        this._loadYouTubeIFrame(track, autoPlay);
      }
    } else if (track.audioUrl) {
      // 로컬 파일 재생
      if (this.ytPlayer && this.ytPlayer.stopVideo) {
        this.ytPlayer.stopVideo();
      }
      this.useNativeAudio = true;
      this.audio.loop = false;
      this.audio.src = track.audioUrl;
      this.audio.currentTime = 0;
      if (autoPlay) {
        this.audio.play().catch(e => console.log("Audio play prevented:", e));
      }
    }

    this.isUserPaused = !autoPlay;
    this.updateMediaSession(track);

    if (this.callbacks.onTrackChange) {
      this.callbacks.onTrackChange(track, this.currentIndex);
    }
  }

  // 서버 프록시를 통한 네이티브 HTML5 오디오 고속 로드 (대기 시간 0초 단축)
  async _loadNativeAudio(track, autoPlay, sessionId, startTime = 0, onPlaySuccess = null) {
    const videoId = track.videoId;
    if (!videoId) return;

    if (this._audioUrlFetching) {
      try { this._audioUrlFetching.abort(); } catch (e) {}
      this._audioUrlFetching = null;
    }

    this._isLoadingNativeAudio = true;
    this.useNativeAudio = true;

    // [고속 전환] /api/audio-url 사전 질의 대기 없이 곧바로 프록시 스트림 URL 설정
    // Range 헤더와 실시간 파이프라인으로 첫 번째 청크가 도착하는 즉시 재생 시작
    const streamBase = this.streamServerBase || '';
    const streamProxyUrl = `${streamBase}/api/audio-stream?id=${encodeURIComponent(videoId)}`;
    this.audio.loop = false;
    this.audio.src = streamProxyUrl;
    if (startTime > 0) {
      this.audio.currentTime = startTime;
    } else {
      this.audio.currentTime = 0;
    }
    // [음량 밸런스 최적화] 유튜브 IFrame의 Loudness Normalization(-14 LUFS)과 완벽 일치하도록 0.78 레벨링
    this.audio.volume = this.isMuted ? 0 : Math.min(1, this.volume * 0.78);

    if (autoPlay) {
      this.isPlaying = true;
      this.isUserPaused = false;
      this.startBgKeepAlive();
      this.syncMediaSessionPlaybackState();
      if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);

      try {
        await this.audio.play();
        if (this._loadSessionId !== sessionId) return;
        this._isLoadingNativeAudio = false;

        // 콜백이 제공된 경우(예: 비디오에서 오디오로 무중단 전환) 성공 즉시 실행
        if (typeof onPlaySuccess === 'function') {
          onPlaySuccess();
        } else if (this.ytPlayer && this.ytPlayer.stopVideo && !this._isTransitioningToVideo) {
          try { this.ytPlayer.stopVideo(); } catch (e) {}
        }

        console.log(`[BackgroundPlay] High-speed native audio stream playing: ${track.title}`);
        this._prefetchNextTrackAudio();
      } catch (playErr) {
        if (this._loadSessionId !== sessionId) return;
        console.warn('[BackgroundPlay] Direct stream play error, trying iframe fallback:', playErr);
        this._isLoadingNativeAudio = false;
        this.useNativeAudio = false;
        this._loadYouTubeIFrame(track, autoPlay);
      }
    } else {
      this._isLoadingNativeAudio = false;
    }
  }

  // 다음/이전 곡 오디오 URL 및 대기열 선제적 다중 캐싱 (로컬 서버 환경 전용)
  _prefetchNextTrackAudio() {
    if (!this.serverSupportsAudioStream) return;
    if (!this.queue || this.queue.length === 0 || this.currentIndex < 0) return;
    const vids = [];
    for (let i = 1; i <= 4; i++) {
      const idx = this.currentIndex + i;
      if (idx < this.queue.length && this.queue[idx]?.videoId) {
        vids.push(this.queue[idx].videoId);
      }
    }
    if (this.currentIndex > 0 && this.queue[this.currentIndex - 1]?.videoId) {
      vids.push(this.queue[this.currentIndex - 1].videoId);
    }
    if (vids.length > 0) {
      fetch(`/api/prefetch?id=${encodeURIComponent(vids.join(','))}`).catch(() => {});
    }
  }

  // 저작권 퍼가기 제한 영상 (코드 150/101/152) 지능형 처리 및 공식 영상 우회
  _handleEmbedRestrictedVideo(curTrack, curTime) {
    if (!curTrack) return;

    // 만약 이미 지정된 우회 MV VideoId가 있는 경우 (예: APT -> 8Ebqe2Dbzls)
    if (curTrack.mvVideoId && curTrack.mvVideoId !== curTrack.videoId && !curTrack._triedPresetMv) {
      curTrack._triedPresetMv = true;
      console.log("[AudioPlayer] Using preset alternative mvVideoId:", curTrack.mvVideoId);
      if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
        this.ytPlayer.loadVideoById(curTrack.mvVideoId, curTime);
        this.ensureAudioSound();
        try {
          if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
          if (typeof this.ytPlayer.setVolume === 'function') this.ytPlayer.setVolume(this.volume * 100);
          if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
        } catch (pe) {}
        return;
      }
    }

    // 1단계: 공식 MV / Lyric Video 대체 영상 자동 탐색 (아직 탐색하지 않은 경우)
    if (!curTrack._mvSearched) {
      curTrack._mvSearched = true;
      const cleanTitle = (curTrack.title || '').replace(/\(.*\)|\[.*\]/g, '').trim();
      const cleanArtist = (curTrack.artist || '').split(/[,&feat\.]/i)[0].trim();
      const query = `${cleanArtist} ${cleanTitle}`.trim();

      const searchPromise = (typeof window !== 'undefined' && window.searchService && typeof window.searchService.searchOnline === 'function')
        ? window.searchService.searchOnline(query)
        : fetch(`/api/search?q=${encodeURIComponent(query)}`).then(r => r.json()).catch(() => null);

      Promise.resolve(searchPromise).then(data => {
        if (!data) {
          this._showEmbedRestrictedNotice(curTrack, curTime);
          return;
        }
        const list = [...(data.songs || []), ...(data.tracks || []), ...(data.videos || [])];
        const titleKeywords = cleanTitle.toLowerCase().split(/\s+/).filter(w => w.length > 1);

        const validCandidates = list.filter(v => {
          if (!v.videoId || v.videoId === curTrack.videoId || v.isCompilation) return false;
          const vt = (v.title || '').toLowerCase();
          // [엄격 검증] 동일 곡의 제목 키워드가 반드시 포함되어야 함 (엉뚱한 곡 매칭 원천 방지)
          if (titleKeywords.length > 0 && !titleKeywords.some(kw => vt.includes(kw))) {
            return false;
          }
          return true;
        });

        // 1순위: 공식 MV, Lyric Video, Official Video
        const candidate = validCandidates.find(v => {
          const t = (v.title || '').toLowerCase();
          return t.includes('official') || t.includes('m/v') || t.includes('mv') || t.includes('lyric');
        }) || validCandidates.find(v => {
          const a = (v.artist || '').toLowerCase();
          return a && cleanArtist && (a.includes(cleanArtist.toLowerCase()) || cleanArtist.toLowerCase().includes(a));
        }) || validCandidates[0];

        if (candidate && candidate.videoId) {
          console.log("[AudioPlayer] Switching to alternative playable videoId:", candidate.videoId, candidate.title);
          curTrack.mvVideoId = candidate.videoId;
          if (typeof window !== 'undefined' && window.ui?.showToast) {
            window.ui.showToast(`공식 영상으로 자동 우회 연결했습니다.`);
          }
          if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
            this.ytPlayer.loadVideoById(candidate.videoId, curTime);
            this.ensureAudioSound();
            try {
              if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
              if (typeof this.ytPlayer.setVolume === 'function') this.ytPlayer.setVolume(this.volume * 100);
              if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
            } catch (pe) {}
            return;
          }
        }
        this._showEmbedRestrictedNotice(curTrack, curTime);
      }).catch(() => {
        this._showEmbedRestrictedNotice(curTrack, curTime);
      });
      return;
    }

    // 2단계: 대체 영상도 없거나 이미 탐색한 경우 -> 음악 중단 없이 안내 오버레이 노출
    this._showEmbedRestrictedNotice(curTrack, curTime);
  }

  // 제한 영상 안내 오버레이 표시 및 음원 무중단 연속 재생 보장
  _showEmbedRestrictedNotice(curTrack, curTime) {
    // 1. 음악 재생 절대 끊지 않음: 네이티브 오디오가 재생 가능한 환경이면 즉시 음원 연속 재생
    if (this.serverSupportsAudioStream && !this.useNativeAudio) {
      this.useNativeAudio = true;
      this._loadNativeAudio(curTrack, true, this._loadSessionId, curTime);
    }

    // 2. 비디오 스테이지에 우아한 알림 오버레이 표시
    const noticeEl = document.getElementById('video-embed-notice-overlay');
    if (noticeEl) {
      noticeEl.style.display = 'flex';
      const openYtBtn = document.getElementById('btn-notice-open-yt');
      if (openYtBtn && curTrack.videoId) {
        openYtBtn.href = `https://www.youtube.com/watch?v=${curTrack.videoId}`;
      }
    }

    if (typeof window !== 'undefined' && window.ui && typeof window.ui.showToast === 'function') {
      window.ui.showToast('외부 재생이 제한된 영상이지만 음악은 끊김 없이 계속 재생됩니다.');
    }
  }

  // 동영상 모드로 전환 (YouTube IFrame 활성화 및 재생 시점 동기화)
  switchToVideoMode() {
    const track = this.getCurrentTrack();
    if (!track || !track.videoId) return;

    this.currentMediaMode = 'video';
    const curTime = Math.max(0, this.getCurrentTime() || 0);

    // 제한 안내 오버레이 초기화
    const noticeEl = document.getElementById('video-embed-notice-overlay');
    if (noticeEl) noticeEl.style.display = 'none';

    // 1) 이미 YouTube IFrame으로 재생 중인 경우 (Cloudflare Pages 환경 포함):
    // 영상을 다시 로드하지 않고 그대로 연속 재생! 시점 0:00 초기화 및 버퍼링 없음!
    if (!this.useNativeAudio && this.ytPlayer && this.isYTReady) {
      this.isPlaying = true;
      this.isUserPaused = false;
      try {
        if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
        if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
      } catch (e) {}
      this.syncMediaSessionPlaybackState();
      return;
    }

    // 2) HTML5 네이티브 오디오 모드에서 전환하는 경우:
    // [무중단 원칙] YouTube 영상이 실제로 재생(PLAYING)될 때까지
    // 네이티브 오디오를 즉시 끄지 않고 연속 재생 유지! 묵음 및 음악 끊김 0초!
    const targetVid = track.mvVideoId || track.videoId;
    this._targetSyncTime = curTime;
    this._isTransitioningToVideo = true;

    if (this.ytPlayer && this.isYTReady && typeof this.ytPlayer.loadVideoById === 'function') {
      try {
        this.ytPlayer.loadVideoById(targetVid, curTime);
        this.ensureAudioSound();
        try {
          if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
          if (typeof this.ytPlayer.setVolume === 'function') this.ytPlayer.setVolume(this.volume * 100);
          if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
        } catch (pe) {}
      } catch (e) {
        try {
          this.ytPlayer.loadVideoById({
            videoId: targetVid,
            startSeconds: curTime
          });
          if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
        } catch (e2) {}
      }
    } else {
      this._loadYouTubeIFrame(track, true);
    }

    this.isPlaying = true;
    this.isUserPaused = false;
    this.syncMediaSessionPlaybackState();
    if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);

    setTimeout(() => {
      this._isSwitchingMediaMode = false;
    }, 600);
  }

  // 오디오 모드로 복귀 (HTML5 Native Audio 활성화 및 재생 시점 동기화)
  switchToAudioMode() {
    const track = this.getCurrentTrack();
    if (!track || !track.videoId) return;

    this.currentMediaMode = 'song';
    this._isTransitioningToVideo = false;

    // 제한 안내 오버레이 초기화
    const noticeEl = document.getElementById('video-embed-notice-overlay');
    if (noticeEl) noticeEl.style.display = 'none';

    // 1) 이미 네이티브 오디오로 재생 중인 경우:
    if (this.useNativeAudio) {
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try { this.ytPlayer.pauseVideo(); } catch (e) {}
      }
      return;
    }

    // 2) 서버 스트림 프록시가 없는 환경(정적 Cloudflare Pages 등):
    // YouTube IFrame이 이미 끊김 없이 재생 중이므로 소리를 끄지 않고 연속 재생 유지!
    if (!this.serverSupportsAudioStream) {
      return;
    }

    // 3) 로컬 서버 환경: HTML5 audio로 시점 무중단 복귀
    // [무중단 원칙] 비디오를 미리 일시정지하지 않고 계속 들려주다가,
    // 새 오디오 스트림이 실제로 재생을 시작하는 순간(0ms 딜레이) 비디오를 멈춘다! (묵음 0초, 시간 되감김 0초!)
    const curTime = Math.max(0, this.getCurrentTime() || 0);
    this._loadSessionId = (this._loadSessionId || 0) + 1;
    const sessId = this._loadSessionId;

    this._loadNativeAudio(track, true, sessId, curTime, () => {
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try { this.ytPlayer.pauseVideo(); } catch (e) {}
      }
    });
  }

  // YouTube IFrame API를 통한 로드 (데스크톱 / 비디오 모드 / 폴백)
  _loadYouTubeIFrame(track, autoPlay) {
    this.useNativeAudio = false;
    const targetVid = (this.currentMediaMode === 'video' && track.mvVideoId) ? track.mvVideoId : track.videoId;
    if (this.ytPlayer && this.isYTReady && this.ytPlayer.loadVideoById) {
      if (autoPlay) {
        this.ytPlayer.loadVideoById(targetVid);
        this.ensureAudioSound();
        try {
          if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
          if (typeof this.ytPlayer.setVolume === 'function') this.ytPlayer.setVolume(this.volume * 100);
          if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
        } catch (pe) {}
      } else {
        this.ytPlayer.cueVideoById(targetVid);
      }
    } else {
      // 아직 YT가 준비되지 않았을 경우 대기 후 재시도
      this.loadRetryTimer = setInterval(() => {
        if (this.ytPlayer && this.isYTReady && this.ytPlayer.loadVideoById) {
          clearInterval(this.loadRetryTimer);
          this.loadRetryTimer = null;
          if (autoPlay) {
            this.ytPlayer.loadVideoById(targetVid);
            this.ensureAudioSound();
            try {
              if (typeof this.ytPlayer.unMute === 'function') this.ytPlayer.unMute();
              if (typeof this.ytPlayer.setVolume === 'function') this.ytPlayer.setVolume(this.volume * 100);
              if (typeof this.ytPlayer.playVideo === 'function') this.ytPlayer.playVideo();
            } catch (pe) {}
          } else {
            this.ytPlayer.cueVideoById(targetVid);
          }
        }
      }, 150);
    }
  }

  play() {
    this.isUserPaused = false;
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) {
      if (this.queue.length > 0) {
        this.loadTrack(this.queue[0], true);
      }
      return;
    }

    // 네이티브 오디오 모드 (HTML5 <audio> - 모바일 백그라운드 재생 지원)
    if (this.useNativeAudio || !currentTrack.videoId) {
      // 확실하게 유튜브 플레이어 정지 보장
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try { this.ytPlayer.pauseVideo(); } catch (e) {}
      }
      this.isPlaying = true;
      this.audio.play().catch(e => console.warn('Audio play error:', e));
      this.startBgKeepAlive();
    } else {
      if (this.audio) {
        try { this.audio.pause(); } catch (e) {}
      }
      if (currentTrack.videoId && this.ytPlayer) {
        this.isPlaying = true;
        try {
          if (typeof this.ytPlayer.playVideo === 'function') {
            this.ytPlayer.playVideo();
          }
        } catch (e) {}
        this.ensureAudioSound();
        this.startBgKeepAlive();
      }
    }
    this.syncMediaSessionPlaybackState();
    if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
  }

  pause() {
    this.isUserPaused = true;
    this.isPlaying = false;

    // 네이티브 오디오 모드에서는 HTML5 audio만 정지
    if (this.useNativeAudio) {
      if (this.audio) this.audio.pause();
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try { this.ytPlayer.pauseVideo(); } catch (e) {}
      }
    } else {
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        try { this.ytPlayer.pauseVideo(); } catch (e) {}
      }
      if (this.audio) {
        this.audio.pause();
      }
    }
    this.stopBgKeepAlive();
    this.stopProgressSync();
    this.syncMediaSessionPlaybackState();
    if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
  }

  togglePlayPause() {
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) {
      if (this.queue.length > 0) {
        this.loadTrack(this.queue[0], true);
      }
      return;
    }

    // 네이티브 오디오 모드
    if (this.useNativeAudio) {
      if (this.audio.paused) {
        this.play();
      } else {
        this.pause();
      }
      return;
    }

    // YouTube IFrame 모드
    if (currentTrack.videoId && this.ytPlayer) {
      const state = this.ytPlayer.getPlayerState ? this.ytPlayer.getPlayerState() : -1;
      if (state === 1) {
        this.pause();
      } else {
        this.play();
      }
    } else {
      if (this.audio.paused) {
        this.play();
      } else {
        this.pause();
      }
    }
  }

  playTrackAtIndex(index) {
    if (index >= 0 && index < this.queue.length) {
      this.currentIndex = index;
      this.loadTrack(this.queue[this.currentIndex], true);
      if (this.callbacks.onQueueUpdate) {
        this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
      }
    }
  }

  nextTrack(force = true) {
    if (this.queue.length === 0) return;

    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      // 1. 대기열 끝 도달 시 자동 추천 곡 추가 시도 (무한 연속 재생)
      if (typeof this.callbacks.onAutoRecommendNext === 'function') {
        const added = this.callbacks.onAutoRecommendNext(this.getCurrentTrack());
        if (added && this.currentIndex + 1 < this.queue.length) {
          nextIndex = this.currentIndex + 1;
        }
      }

      if (nextIndex >= this.queue.length && typeof this.callbacks.onQueueNearEnd === 'function') {
        this.callbacks.onQueueNearEnd();
        if (this.currentIndex + 1 < this.queue.length) {
          nextIndex = this.currentIndex + 1;
        }
      }

      if (nextIndex >= this.queue.length) {
        if (this.repeatMode === 'all' || force) {
          nextIndex = 0;
        } else {
          if (this.ytPlayer && this.ytPlayer.pauseVideo) this.ytPlayer.pauseVideo();
          this.audio.pause();
          this.stopBgKeepAlive();
          this.syncMediaSessionPlaybackState();
          return;
        }
      }
    }

    this.playTrackAtIndex(nextIndex);
  }

  prevTrack() {
    if (this.queue.length === 0) return;

    const currentTrack = this.getCurrentTrack();
    let curTime = 0;
    if (currentTrack?.videoId && this.ytPlayer && this.ytPlayer.getCurrentTime) {
      curTime = this.ytPlayer.getCurrentTime();
    } else {
      curTime = this.audio.currentTime;
    }

    if (curTime > 3) {
      this.seekToPercent(0);
      return;
    }

    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }

    this.playTrackAtIndex(prevIndex);
  }

  seekToPercent(percent) {
    const track = this.getCurrentTrack();
    // 네이티브 오디오 모드 시크
    if (this.useNativeAudio && this.audio.duration) {
      const targetTime = (percent / 100) * this.audio.duration;
      this.audio.currentTime = targetTime;
    } else if (track?.videoId && this.ytPlayer && this.ytPlayer.getDuration) {
      const duration = this.ytPlayer.getDuration() || track.duration || 0;
      const targetTime = (percent / 100) * duration;
      this.ytPlayer.seekTo(targetTime, true);
    } else if (this.audio.duration) {
      const targetTime = (percent / 100) * this.audio.duration;
      this.audio.currentTime = targetTime;
    }
  }

  seekTo(seconds) {
    const target = Math.max(0, seconds);
    if (this.useNativeAudio || this.isCurrentLocal()) {
      this.audio.currentTime = Math.min(this.audio.duration || target, target);
    } else if (this.ytPlayer && this.ytPlayer.seekTo) {
      this.ytPlayer.seekTo(target, true);
    }
  }

  seekRelative(seconds) {
    const track = this.getCurrentTrack();
    if (this.useNativeAudio && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
    } else if (track?.videoId && this.ytPlayer && this.ytPlayer.getCurrentTime) {
      const cur = this.ytPlayer.getCurrentTime() || 0;
      this.ytPlayer.seekTo(cur + seconds, true);
    } else if (this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    // 음량 밸런스: 원본 네이티브 오디오와 유튜브 IFrame의 Loudness Normalization 음량 일치
    this.audio.volume = this.isMuted ? 0 : Math.min(1, this.volume * 0.78);

    if (this.ytPlayer && this.ytPlayer.setVolume) {
      this.ytPlayer.setVolume(this.volume * 100);
    }

    if (this.volume > 0) this.isMuted = false;
    if (this.callbacks.onVolumeChange) {
      this.callbacks.onVolumeChange(this.volume, this.isMuted);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.audio.muted = this.isMuted;

    if (this.ytPlayer) {
      if (this.isMuted) {
        this.ytPlayer.mute();
      } else {
        this.ytPlayer.unMute();
      }
    }

    if (this.callbacks.onVolumeChange) {
      this.callbacks.onVolumeChange(this.isMuted ? 0 : this.volume, this.isMuted);
    }
  }

  applyShuffle() {
    const currentTrack = this.getCurrentTrack();
    const remaining = this.queue.filter(t => t.id !== currentTrack?.id);
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    this.queue = currentTrack ? [currentTrack, ...remaining] : remaining;
    this.currentIndex = currentTrack ? 0 : -1;
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const currentTrack = this.getCurrentTrack();

    if (this.isShuffle) {
      this.applyShuffle();
    } else {
      this.queue = [...this.originalQueue];
      if (currentTrack) {
        this.currentIndex = this.queue.findIndex(t => t.id === currentTrack.id);
      }
    }

    if (this.callbacks.onQueueUpdate) {
      this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
    }

    return this.isShuffle;
  }

  cycleRepeat() {
    if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else if (this.repeatMode === 'one') {
      this.repeatMode = 'off';
    } else {
      this.repeatMode = 'all';
    }
    return this.repeatMode;
  }

  toggleRepeat() {
    return this.cycleRepeat();
  }

  addTrackToQueue(track, playImmediately = false) {
    this.queue.push(track);
    this.originalQueue.push(track);

    if (this.callbacks.onQueueUpdate) {
      this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
    }

    if (playImmediately || this.queue.length === 1) {
      this.playTrackAtIndex(this.queue.length - 1);
    }
  }

  removeTrackFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;

    const isCurrent = (index === this.currentIndex);
    this.queue.splice(index, 1);

    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (isCurrent) {
      if (this.queue.length > 0) {
        if (this.currentIndex >= this.queue.length) {
          this.currentIndex = 0;
        }
        this.loadTrack(this.queue[this.currentIndex], this.isPlaying);
      } else {
        this.currentIndex = -1;
        if (this.ytPlayer && this.ytPlayer.stopVideo) this.ytPlayer.stopVideo();
        this.audio.pause();
      }
    }

    if (this.callbacks.onQueueUpdate) {
      this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
    }
  }

  clearQueue() {
    if (this.ytPlayer && this.ytPlayer.stopVideo) this.ytPlayer.stopVideo();
    this.audio.pause();
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    if (this.callbacks.onQueueUpdate) {
      this.callbacks.onQueueUpdate(this.queue, this.currentIndex);
    }
  }
}
