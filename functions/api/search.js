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

// 1. YouTube 웹 검색 직접 파싱 (server.py의 핵심 로직 이식)
async function scrapeYouTube(query) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
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
  const items = [];

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

      // 15초 초과 음원만 수집 (Shorts 제외)
      if (durationSec > 15) {
        items.push({
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
          isLiked: false
        });

        if (items.length >= 25) break;
      }
    }
    if (items.length >= 25) break;
  }

  return items;
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
