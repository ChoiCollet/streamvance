// ==========================================================================
// Hybrid Audio Engine: Real YouTube IFrame API + HTML5 Audio (Local Files)
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

    // Callbacks
    this.callbacks = {
      onTrackChange: null,
      onPlayStateChange: null,
      onTimeUpdate: null,
      onQueueUpdate: null,
      onVolumeChange: null,
      onAutoRecommendNext: null
    };

    this.initHTML5AudioListeners();
    this.initYouTubePlayer();
    this.initMediaSession();
    this.initBgKeepAlive();
  }

  // YouTube IFrame API 초기화
  initYouTubePlayer() {
    const setupYT = () => {
      if (window.YT && window.YT.Player) {
        this.ytPlayer = new window.YT.Player('youtube-player-hidden', {
          height: '200',
          width: '200',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1
          },
          events: {
            onReady: (event) => {
              this.isYTReady = true;
              this.ytPlayer.setVolume(this.volume * 100);
              console.log("YouTube Player is ready!");
            },
            onStateChange: (event) => {
              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0, BUFFERING = 3
              if (event.data === 1) {
                this.isPlaying = true;
                this.startProgressSync();
                this.startBgKeepAlive();
                this.syncMediaSessionPlaybackState();
                if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
              } else if (event.data === 2) {
                this.isPlaying = false;
                this.stopProgressSync();
                this.stopBgKeepAlive();
                this.syncMediaSessionPlaybackState();
                if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
              } else if (event.data === 0) {
                // 재생 완료 시
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
              // 재생 오류 시 다음 곡으로 안전하게 이동
              setTimeout(() => this.nextTrack(true), 1200);
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
    this.audio.volume = this.volume;

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.startBgKeepAlive();
      this.syncMediaSessionPlaybackState();
      if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.stopBgKeepAlive();
      this.syncMediaSessionPlaybackState();
      if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
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
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.nextTrack(false);
      }
    });
  }

  // 1. 모바일 백그라운드 재생 지속을 위한 무음 오디오 앵커 (iOS/Android 백그라운드 스레드 보호)
  initBgKeepAlive() {
    try {
      this.bgKeepAliveAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      this.bgKeepAliveAudio.loop = true;
      this.bgKeepAliveAudio.volume = 0.01;
    } catch (e) {
      console.warn("Bg keepalive init error:", e);
    }
  }

  startBgKeepAlive() {
    if (this.bgKeepAliveAudio) {
      this.bgKeepAliveAudio.play().catch(() => {});
    }
  }

  stopBgKeepAlive() {
    if (this.bgKeepAliveAudio) {
      this.bgKeepAliveAudio.pause();
    }
  }

  // 2. 모바일 잠금화면, 알림창, 블루투스 이어폰 컨트롤 완벽 연동 (MediaSession API)
  initMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        this.togglePlayPause();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.togglePlayPause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.prevTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.nextTrack(false);
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        this.seekRelative(-skipTime);
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        this.seekRelative(skipTime);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
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

    if (this.loadRetryTimer) {
      clearInterval(this.loadRetryTimer);
      this.loadRetryTimer = null;
    }

    // 양쪽 정지 후 로드
    this.audio.pause();

    if (track.videoId) {
      // 실제 YouTube 음악 스트리밍
      if (this.ytPlayer && this.isYTReady && this.ytPlayer.loadVideoById) {
        if (autoPlay) {
          this.ytPlayer.loadVideoById(track.videoId);
        } else {
          this.ytPlayer.cueVideoById(track.videoId);
        }
      } else {
        // 아직 YT가 준비되지 않았을 경우 대기 후 재시도
        this.loadRetryTimer = setInterval(() => {
          if (this.ytPlayer && this.isYTReady && this.ytPlayer.loadVideoById) {
            clearInterval(this.loadRetryTimer);
            this.loadRetryTimer = null;
            if (autoPlay) {
              this.ytPlayer.loadVideoById(track.videoId);
            } else {
              this.ytPlayer.cueVideoById(track.videoId);
            }
          }
        }, 200);
      }
    } else if (track.audioUrl) {
      // 로컬 파일 재생
      if (this.ytPlayer && this.ytPlayer.stopVideo) {
        this.ytPlayer.stopVideo();
      }
      this.audio.src = track.audioUrl;
      this.audio.currentTime = 0;
      if (autoPlay) {
        this.audio.play().catch(e => console.log("Audio play prevented:", e));
      }
    }

    this.updateMediaSession(track);

    if (this.callbacks.onTrackChange) {
      this.callbacks.onTrackChange(track, this.currentIndex);
    }
  }

  togglePlayPause() {
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) {
      if (this.queue.length > 0) {
        this.loadTrack(this.queue[0], true);
      }
      return;
    }

    if (currentTrack.videoId && this.ytPlayer) {
      const state = this.ytPlayer.getPlayerState ? this.ytPlayer.getPlayerState() : -1;
      if (state === 1) { // playing
        this.ytPlayer.pauseVideo();
        this.stopBgKeepAlive();
      } else {
        this.ytPlayer.playVideo();
        this.startBgKeepAlive();
      }
    } else {
      if (this.audio.paused) {
        this.audio.play();
        this.startBgKeepAlive();
      } else {
        this.audio.pause();
        this.stopBgKeepAlive();
      }
    }
    this.syncMediaSessionPlaybackState();
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
    if (track?.videoId && this.ytPlayer && this.ytPlayer.getDuration) {
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
    if (this.isCurrentLocal()) {
      this.audio.currentTime = Math.min(this.audio.duration || target, target);
    } else if (this.ytPlayer && this.ytPlayer.seekTo) {
      this.ytPlayer.seekTo(target, true);
    }
  }

  seekRelative(seconds) {
    const track = this.getCurrentTrack();
    if (track?.videoId && this.ytPlayer && this.ytPlayer.getCurrentTime) {
      const cur = this.ytPlayer.getCurrentTime() || 0;
      this.ytPlayer.seekTo(cur + seconds, true);
    } else if (this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.audio.volume = this.volume;

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
