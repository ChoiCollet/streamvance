// Cloudflare Pages Function: /api/search
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 검색 및 폴백 프록시

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us',
  'https://invidious.projectsegfau.lt'
];

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\]/gi, '')
    .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\)/gi, '')
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

  // 리액션, 브이로그, 먹방, 게임, 뉴스는 완전 차단
  for (const strictKw of ['reaction', '리액션', 'vlog', '브이로그', '먹방', 'mukbang', '게임', 'gameplay', '뉴스', 'news']) {
    if (lt.includes(strictKw) || lc.includes(strictKw)) return true;
  }

  const nonMusicKeywords = [
    'review', '리뷰', 'unboxing', '언박싱', '사용기',
    'game', '게임', 'walkthrough', 'playthrough', '공략', '롤', '배그',
    'ytn', '기자', '정치', '시사', '속보',
    'lecture', '강의', '설교', '공부', 'study with me',
    '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
    '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
    '하이라이트', 'highlight', '선공개', '예고편'
  ];

  for (const kw of nonMusicKeywords) {
    if (lt.includes(kw) || lc.includes(kw)) {
      const musicGuards = ['official mv', 'm/v', 'official audio', '가사', 'lyrics', '- topic', '노래'];
      if (!musicGuards.some(mg => lt.includes(mg) || lc.includes(mg))) {
        return true;
      }
    }
  }
  return false;
}

function calcMusicScore(title, channel, durationSec) {
  let score = 0;
  const lt = (title || '').toLowerCase();
  const lc = (channel || '').toLowerCase();

  if (lc.includes('- topic')) score += 10;
  if (/official|record|entertainment|music|음악|1thek|stone music|smtown|jyp|hybe|bighit|yg|dingo|mnet/i.test(lc)) score += 6;
  if (/m\/v|mv|official mv|official audio|음원|가사|lyrics|노래|live clip|band/i.test(lt)) score += 5;
  if (durationSec >= 110 && durationSec <= 330) score += 3;
  return score;
}

// 1. YouTube 웹 검색 직접 파싱 (server.py의 핵심 로직 이식)
async function scrapeYouTube(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    return [];
  }

  const data = JSON.parse(match[1]);
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

      const thumbnails = v.thumbnail?.thumbnails || [];
      const cover = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // 비음악 일반 영상 차단
      if (isNonMusic(title, channel)) continue;

      const isCompilation = (durationSec > 600) || /playlist|플레이리스트|노래 모음|전곡 모음|1시간|1 hour|모음집|연속/i.test(title);

      if (durationSec >= 45) {
        const score = calcMusicScore(title, channel, durationSec);
        const trackObj = {
          id: `yt-${videoId}`,
          videoId: videoId,
          title: cleanTitle(title),
          artist: channel,
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

  // 음악 적합도 점수 높은 순으로 정렬
  songs.sort((a, b) => (b._score || 0) - (a._score || 0));

  const allTracks = [...songs, ...compilations];
  return {
    artist: artistInfo,
    tracks: allTracks.slice(0, 30),
    songs: songs.slice(0, 20),
    videos: compilations.slice(0, 15)
  };
}

// 2. Invidious 공개 인스턴스 검색 (유튜브 차단 시 자동 폴백)
async function fetchFromInvidious(query) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data
          .filter(item => item.type === 'video' && item.videoId)
          .map(item => ({
            id: `yt-${item.videoId}`,
            videoId: item.videoId,
            title: cleanTitle(item.title),
            artist: item.author || "YouTube Music",
            album: "YouTube Music Stream",
            genre: "pop",
            mood: "all",
            duration: item.lengthSeconds || 210,
            cover: item.videoThumbnails?.find(t => t.quality === 'high')?.url ||
                   `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
            lyrics: [],
            isLiked: false
          }));
      }
    } catch (e) {
      continue;
    }
  }
  return [];
}

// Cloudflare Pages Function GET 핸들러
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300'
  };

  if (!q.trim()) {
    return new Response(JSON.stringify([]), { headers });
  }

  const query = q.trim();

  // 1. YouTube 직접 크롤링 시도
  try {
    const results = await scrapeYouTube(query);
    if (results && results.length > 0) {
      return new Response(JSON.stringify(results), { headers });
    }
  } catch (err) {
    console.warn('Direct YouTube scrape failed, falling back to Invidious:', err);
  }

  // 2. Invidious 공개 인스턴스 폴백
  try {
    const fallbackResults = await fetchFromInvidious(query);
    return new Response(JSON.stringify(fallbackResults), { headers });
  } catch (err) {
    return new Response(JSON.stringify([]), { headers });
  }
}
