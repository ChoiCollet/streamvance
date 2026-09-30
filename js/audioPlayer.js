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

    // Callbacks
    this.callbacks = {
      onTrackChange: null,
      onPlayStateChange: null,
      onTimeUpdate: null,
      onQueueUpdate: null,
      onVolumeChange: null
    };

    this.initHTML5AudioListeners();
    this.initYouTubePlayer();
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
                if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
              } else if (event.data === 2) {
                this.isPlaying = false;
                this.stopProgressSync();
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
      if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      if (this.callbacks.onPlayStateChange) this.callbacks.onPlayStateChange(false);
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.isCurrentLocal()) {
        const current = this.audio.currentTime;
        const duration = this.audio.duration || 0;
        const percent = duration > 0 ? (current / duration) * 100 : 0;
        if (this.callbacks.onTimeUpdate) {
          this.callbacks.onTimeUpdate(current, duration, percent);
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

  isCurrentLocal() {
    const track = this.getCurrentTrack();
    return track && !track.videoId && track.audioUrl;
  }

  startProgressSync() {
    this.stopProgressSync();
    this.syncInterval = setInterval(() => {
      if (this.ytPlayer && this.ytPlayer.getCurrentTime && !this.isCurrentLocal()) {
        const current = this.ytPlayer.getCurrentTime() || 0;
        const duration = this.ytPlayer.getDuration() || (this.getCurrentTrack()?.duration || 0);
        const percent = duration > 0 ? (current / duration) * 100 : 0;
        if (this.callbacks.onTimeUpdate) {
          this.callbacks.onTimeUpdate(current, duration, percent);
        }
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
        const retryTimer = setInterval(() => {
          if (this.ytPlayer && this.isYTReady && this.ytPlayer.loadVideoById) {
            clearInterval(retryTimer);
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
      } else {
        this.ytPlayer.playVideo();
      }
    } else {
      if (this.audio.paused) {
        this.audio.play();
      } else {
        this.audio.pause();
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
      if (this.repeatMode === 'all' || force) {
        nextIndex = 0;
      } else {
        if (this.ytPlayer && this.ytPlayer.pauseVideo) this.ytPlayer.pauseVideo();
        this.audio.pause();
        return;
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

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    const currentTrack = this.getCurrentTrack();

    if (this.isShuffle) {
      const remaining = this.queue.filter(t => t.id !== currentTrack?.id);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      this.queue = currentTrack ? [currentTrack, ...remaining] : remaining;
      this.currentIndex = currentTrack ? 0 : -1;
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
