// Cloudflare Pages Function: /api/search
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 검색, 공식 아티스트 필터 및 다중 고속 폴백 프록시

const OFFICIAL_LABELS = [
  'hybe', 'smtown', 'jyp', 'yg entertainment', '1thek', 'stone music',
  'edam', 'starship', 'cube', 'kakao', 'dingo', 'mnet', 'kbs kpop', 'mbk'
];

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Visualizer).*?\]/gi, '')
    .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Visualizer).*?\)/gi, '')
    .replace(/【.*?】/g, '')
    .trim();
}

function parseDuration(lengthText) {
  if (!lengthText) return 210;
  const parts = lengthText.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } else if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  }
  return 210;
}

function isNonMusic(title, channel) {
  const lt = (title || '').toLowerCase();
  const lc = (channel || '').toLowerCase();

  // 음원/노래/커버 가드 (영상 제목에 명시적으로 음악 관련 키워드가 있는 경우만 가드로 인정)
  const musicGuards = [
    'official mv', 'm/v', 'mv', 'official audio', '가사', 'lyrics',
    'cover', '커버', 'live cover', '우타이테', 'original song', '오리지널 곡',
    '음원', '노래방', 'karaoke', 'special clip', 'visualizer', 'dance practice', '응원법'
  ];
  const hasTitleMusicGuard = musicGuards.some(mg => lt.includes(mg));

  // 1. 게임 / 게임방송 / 게임플레이 / 게임대회 관련 키워드 (제목에 포함 시 음악 가드가 없으면 무조건 차단)
  const gameKeywords = [
    '마인크래프트', '마크', 'minecraft',
    '발로란트', 'valorant',
    '오버워치', 'overwatch',
    '배틀그라운드', '배그', 'pubg',
    '리그오브레전드', '롤', 'lol', '솔랭', '자랭', '칼바람',
    '스팀게임', '스팀', 'steam',
    '종합게임', '종겜', '게임플레이', 'gameplay', 'walkthrough', 'playthrough',
    '공략', '모바일게임', '게임 실황', '게임 방송', '게임대회', '스크림',
    '원신', '붕괴', '스타레일', '메이플', '로스트아크', '로아', '던파', '피파', 'fc온라인',
    '철권', '에이펙스', 'apex legends', '사이버펑크', '동물의숲', '포켓몬'
  ];
  for (const gk of gameKeywords) {
    if (lt.includes(gk) && !hasTitleMusicGuard) {
      return true;
    }
  }

  // 2. 비음악 스트리밍 / 잡담 / 일상 / 예능 / 다시보기 / 클립
  const nonMusicGeneral = [
    '다시보기', '생방송', '라이브 다시보기', '풀영상', '방송 풀영상', '전체 다시보기',
    '클립', '핫클립', '클립영상', '영도', '영상도네',
    '잡담', '저챗', '저스트채팅', '저스트 채팅', '소통방송', '소통',
    '이상형월드컵', '이상형 월드컵', '월드컵',
    'q&a', '질문답변', 'qna',
    '브이로그', 'vlog',
    '먹방', 'mukbang', '쿡방', '요리', 'cook',
    'reaction', '리액션', '리액트', 'reacts',
    'review', '리뷰', 'unboxing', '언박싱', '사용기',
    'news', '뉴스', '속보', 'ytn', '기자', '정치', '시사',
    'lecture', '강의', '설교', 'study with me',
    '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
    '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
    '하이라이트', 'highlight', '선공개', '예고편',
    '사장님도 대답', '대답!', '썰', '상황극', '더빙', '쇼츠', 'shorts', '개그', '애니', '만화', '상담'
  ];
  for (const nmg of nonMusicGeneral) {
    if (lt.includes(nmg) && !hasTitleMusicGuard) {
      return true;
    }
  }

  // 3. 개인 크리에이터/버튜버/가수의 비음악 영상 가드:
  // 공식 음원 채널(- Topic)이나 주요 음반사가 아닌 일반 채널 영상인데 제목에 음악 관련 단어가 전혀 없는 경우 배제
  const musicEssentialKeywords = [
    'mv', 'm/v', 'music video', 'official', 'audio', '음원', '노래', '곡',
    'cover', '커버', 'single', 'album', 'song', 'track', 'feat', 'prod',
    'ost', 'remix', 'live', 'band', '우타이테', '가사', 'lyrics', 'orchestra', '|'
  ];
  const isOfficialChannel = lc.includes('- topic') || OFFICIAL_LABELS.some(lbl => lc.includes(lbl));
  const hasAnyMusicWord = musicEssentialKeywords.some(mw => lt.includes(mw));

  if (!isOfficialChannel && !hasAnyMusicWord && !hasTitleMusicGuard) {
    return true;
  }

  return false;
}

// 아티스트 검색 시 공식 채널/공식 소속사 여부 판별
function isArtistOfficialChannel(artistName, channel) {
  if (!artistName || !channel) return false;
  const aNorm = artistName.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const cNorm = channel.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

  if (cNorm.includes(aNorm) || aNorm.includes(cNorm)) return true;
  if (channel.toLowerCase().includes('- topic')) return true;
  if (OFFICIAL_LABELS.some(lbl => channel.toLowerCase().includes(lbl))) return true;
  return false;
}

function calcMusicScore(title, channel, durationSec, targetArtist = '', rawQuery = '') {
  let score = 0;
  const lt = (title || '').toLowerCase();
  const lc = (channel || '').toLowerCase();
  const lq = (rawQuery || targetArtist || '').toLowerCase();

  const isCoverQuery = /커버|cover|우타이테|가창/i.test(lq);
  const isKaraokeQuery = /노래방|karaoke|tj|금영|ky|mr|반주|inst/i.test(lq);
  const isLyricsQuery = /가사|lyrics|자막/i.test(lq);

  const isOfficialCh = targetArtist && isArtistOfficialChannel(targetArtist, channel);
  if (isOfficialCh) score += 35;
  if (lc.includes('- topic')) score += 30; // YouTube Music 공식 음원 (원곡 최우선)
  if (OFFICIAL_LABELS.some(lbl => lc.includes(lbl))) score += 20;

  if (/official audio|official music video|official mv|m\/v|mv/i.test(lt)) score += 15;
  else if (/audio|음원|original sound/i.test(lt)) score += 10;

  if (durationSec >= 110 && durationSec <= 330) score += 5;

  const isCoverItem = /cover|커버|covered by|가창/i.test(lt) || /cover|커버/i.test(lc);
  if (isCoverQuery) {
    if (isCoverItem) score += 35;
  } else {
    if (isCoverItem && !isOfficialCh) score -= 40;
  }

  const isKaraokeItem = /노래방|karaoke|tj노래방|ky노래방|tj미디어|금영|mr제거|반주/i.test(lt) ||
                        /노래방|karaoke|tj|금영|ky/i.test(lc) ||
                        /\b(mr|inst|instrumental)\b/i.test(lt);
  if (isKaraokeQuery) {
    if (isKaraokeItem) score += 35;
  } else {
    if (isKaraokeItem) score -= 50;
  }

  const isLyricsItem = /가사|lyrics|자막|교차편집|han\/rom\/eng/i.test(lt);
  if (isLyricsQuery) {
    if (isLyricsItem) score += 25;
  } else {
    if (isLyricsItem && !(isOfficialCh || lc.includes('- topic') || OFFICIAL_LABELS.some(lbl => lc.includes(lbl)))) {
      score -= 25;
    }
  }

  if (/1시간|1hour|10분|연속듣기|반복재생/i.test(lt)) score -= 30;

  return score;
}

// 1. YouTube 웹 검색 직접 파싱 (Cloudflare Workers 환경)
async function scrapeYouTube(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  if (!res.ok) {
    throw new Error(`YouTube responded with status ${res.status}`);
  }

  const html = await res.text();
  let match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
  if (!match) {
    match = html.match(/var ytInitialData\s*=\s*({.+?});/);
  }

  if (!match) {
    return null;
  }

  const data = JSON.parse(match[1]);
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const songs = [];
  const compilations = [];
  let artistInfo = null;

  // 1차 패스: 아티스트 채널 정보 감지
  for (const section of contents) {
    const itemSection = section?.itemSectionRenderer?.contents || [];
    for (const item of itemSection) {
      if (item?.channelRenderer && !artistInfo) {
        const cr = item.channelRenderer;
        const name = cr.title?.simpleText || cr.title?.runs?.[0]?.text || '';
        const subs = cr.subscriberCountText?.simpleText || cr.subscriberCountText?.runs?.[0]?.text || '아티스트';
        const thumbs = cr.thumbnail?.thumbnails || [];
        const avatar = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
        if (name) {
          artistInfo = { name, subscribers: subs, avatar };
        }
      }
    }
  }

  const detectedArtist = artistInfo ? artistInfo.name : query;

  // 2차 패스: 비디오 목록 추출 및 필터링
  for (const section of contents) {
    const itemSection = section?.itemSectionRenderer?.contents || [];
    for (const item of itemSection) {
      const v = item?.videoRenderer;
      if (!v || !v.videoId) continue;

      const videoId = v.videoId;
      const title = v.title?.runs?.[0]?.text || '';
      const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || 'YouTube';
      const lengthText = v.lengthText?.simpleText || '3:30';
      const durationSec = parseDuration(lengthText);

      const thumbnails = v.thumbnail?.thumbnails || [];
      const cover = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // 비음악 일반 영상 차단
      if (isNonMusic(title, channel)) continue;

      const isCompilation = (durationSec > 600) || /playlist|플레이리스트|노래 모음|전곡 모음|1시간|1 hour|모음집|연속/i.test(title);

      if (durationSec >= 45) {
        const isOfficial = isArtistOfficialChannel(detectedArtist, channel);
        const score = calcMusicScore(title, channel, durationSec, detectedArtist, query);

        const trackObj = {
          id: `yt-${videoId}`,
          videoId: videoId,
          title: cleanTitle(title),
          artist: isOfficial ? detectedArtist : channel,
          channel: channel,
          isOfficialChannel: isOfficial,
          album: 'YouTube Music',
          genre: 'pop',
          mood: 'all',
          duration: durationSec,
          cover: cover,
          lyrics: [],
          isLiked: false,
          isCompilation,
          _score: score
        };

        if (isCompilation) {
          compilations.push(trackObj);
        } else {
          songs.push(trackObj);
        }
      }
    }
  }

  // 아티스트 검색인 경우: 공식 채널/공식 영상이 우선순위로 올라오도록 정렬
  songs.sort((a, b) => (b._score || 0) - (a._score || 0));

  const allTracks = [...songs, ...compilations];
  if (allTracks.length === 0) return null;

  return {
    artist: artistInfo,
    tracks: allTracks.slice(0, 30),
    songs: songs.slice(0, 20),
    videos: compilations.slice(0, 15)
  };
}

// 2. YouTube Innertube API (Cloudflare Workers 환경에서 차단 없는 안정적인 JSON 검색)
async function searchYouTubeInnertube(query) {
  try {
    const payload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'ko',
          gl: 'KR'
        }
      },
      query: query
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    const songs = [];
    const compilations = [];
    let artistInfo = null;

    for (const section of contents) {
      const itemSection = section?.itemSectionRenderer?.contents || [];
      for (const item of itemSection) {
        if (item?.channelRenderer && !artistInfo) {
          const cr = item.channelRenderer;
          const name = cr.title?.simpleText || cr.title?.runs?.[0]?.text || '';
          const subs = cr.subscriberCountText?.simpleText || cr.subscriberCountText?.runs?.[0]?.text || '아티스트';
          const thumbs = cr.thumbnail?.thumbnails || [];
          const avatar = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
          if (name) {
            artistInfo = { name, subscribers: subs, avatar };
          }
        }

        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;

        const videoId = v.videoId;
        const title = v.title?.runs?.[0]?.text || '';
        const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || 'YouTube';
        const lengthText = v.lengthText?.simpleText || '3:30';
        const durationSec = parseDuration(lengthText);

        if (isNonMusic(title, channel)) continue;

        const isCompilation = (durationSec > 600) || /playlist|플레이리스트|노래 모음|전곡 모음/i.test(title);
        const thumbs = v.thumbnail?.thumbnails || [];
        const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const isOfficial = isArtistOfficialChannel(query, channel);

        const trackObj = {
          id: `yt-${videoId}`,
          videoId: videoId,
          title: cleanTitle(title),
          artist: isOfficial ? query : channel,
          channel: channel,
          isOfficialChannel: isOfficial,
          album: 'YouTube Music',
          genre: 'pop',
          mood: 'all',
          duration: durationSec,
          cover: cover,
          lyrics: [],
          isLiked: false,
          isCompilation,
          _score: calcMusicScore(title, channel, durationSec, query, query)
        };

        if (isCompilation) {
          compilations.push(trackObj);
        } else {
          songs.push(trackObj);
        }
      }
    }

    songs.sort((a, b) => (b._score || 0) - (a._score || 0));
    const all = [...songs, ...compilations];
    if (all.length === 0) return null;

    return {
      artist: artistInfo,
      tracks: all.slice(0, 30),
      songs: songs.slice(0, 20),
      videos: compilations.slice(0, 15)
    };
  } catch (e) {
    return null;
  }
}

// 3. 다중 Piped & Invidious 공개 인스턴스 폴백
const PUBLIC_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.privacy.com.de',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us'
];

async function fetchFromPublicMirrors(query) {
  for (const base of PUBLIC_INSTANCES) {
    try {
      const isPiped = base.includes('piped');
      const url = isPiped 
        ? `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs` 
        : `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
      
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = isPiped ? (data.items || []) : (Array.isArray(data) ? data : []);

      if (items.length > 0) {
        const tracks = items
          .filter(item => {
            const vid = item.url ? item.url.replace('/watch?v=', '') : item.videoId;
            return vid && !isNonMusic(item.title, item.uploaderName || item.author);
          })
          .map(item => {
            const vid = item.url ? item.url.replace('/watch?v=', '') : item.videoId;
            const channel = item.uploaderName || item.author || 'YouTube Music';
            const dur = item.duration || item.lengthSeconds || 210;
            return {
              id: `yt-${vid}`,
              videoId: vid,
              title: cleanTitle(item.title),
              artist: channel,
              channel: channel,
              isOfficialChannel: isArtistOfficialChannel(query, channel),
              album: "YouTube Music",
              genre: "pop",
              mood: "all",
              duration: dur,
              cover: item.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              lyrics: [],
              isLiked: false,
              _score: calcMusicScore(item.title, channel, dur, query, query)
            };
          });

        tracks.sort((a, b) => b._score - a._score);
        if (tracks.length > 0) {
          return {
            artist: null,
            tracks: tracks.slice(0, 30),
            songs: tracks.slice(0, 20),
            videos: []
          };
        }
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// Cloudflare Pages Function GET 핸들러
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'public, max-age=600, s-maxage=1200'
  };

  if (!q.trim()) {
    return new Response(JSON.stringify({ artist: null, tracks: [], songs: [], videos: [] }), { headers });
  }

  const query = q.trim();

  // 1. YouTube Innertube API 고속 검색 시도 (가장 안정적)
  try {
    const innertubeResult = await searchYouTubeInnertube(query);
    if (innertubeResult && innertubeResult.tracks && innertubeResult.tracks.length > 0) {
      return new Response(JSON.stringify(innertubeResult), { headers });
    }
  } catch (err) {
    console.warn('Innertube search failed:', err);
  }

  // 2. YouTube 웹 직접 스크래핑 시도
  try {
    const scrapeResult = await scrapeYouTube(query);
    if (scrapeResult && scrapeResult.tracks && scrapeResult.tracks.length > 0) {
      return new Response(JSON.stringify(scrapeResult), { headers });
    }
  } catch (err) {
    console.warn('Direct YouTube scrape failed:', err);
  }

  // 3. 공개 미러 인스턴스 폴백 시도
  try {
    const mirrorResult = await fetchFromPublicMirrors(query);
    if (mirrorResult && mirrorResult.tracks && mirrorResult.tracks.length > 0) {
      return new Response(JSON.stringify(mirrorResult), { headers });
    }
  } catch (err) {
    console.warn('Public mirrors fallback failed:', err);
  }

  return new Response(JSON.stringify({ artist: null, tracks: [], songs: [], videos: [] }), { headers });
}
