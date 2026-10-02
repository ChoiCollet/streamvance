// Cloudflare Pages Function: /api/charts
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 인기 차트 API (Innertube + Scrape 이중화)

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=1800, s-maxage=3600'
  };

  // 1. YouTube Innertube API 차트 검색 시도
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
      query: '2026 K-POP 인기 차트 TOP 50'
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
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
          const thumbs = v.thumbnail?.thumbnails || [];
          const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          items.push({
            id: `yt-${videoId}`,
            videoId: videoId,
            title: title.replace(/\[.*?\]|\(.*?\)/g, '').trim(),
            artist: channel,
            album: '실시간 인기 차트',
            genre: 'pop',
            mood: 'energy',
            duration: 210,
            cover: cover,
            isLiked: false
          });

          if (items.length >= 25) break;
        }
        if (items.length >= 25) break;
      }

      if (items.length > 0) {
        return new Response(JSON.stringify(items), { headers });
      }
    }
  } catch (e) {
    console.warn('Innertube charts failed:', e);
  }

  // 2. HTML 스크래핑 폴백
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent('2026 K-POP 인기 차트 TOP 50')}&sp=EgIQAQ%253D%253D`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });

    if (res.ok) {
      const html = await res.text();
      let match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (!match) match = html.match(/var ytInitialData\s*=\s*({.+?});/);

      if (match) {
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
            const channel = v.ownerText?.runs?.[0]?.text || 'YouTube';
            const thumbs = v.thumbnail?.thumbnails || [];
            const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

            items.push({
              id: `yt-${videoId}`,
              videoId: videoId,
              title: title.replace(/\[.*?\]|\(.*?\)/g, '').trim(),
              artist: channel,
              album: '실시간 인기 차트',
              genre: 'pop',
              mood: 'energy',
              duration: 210,
              cover: cover,
              isLiked: false
            });

            if (items.length >= 25) break;
          }
          if (items.length >= 25) break;
        }

        if (items.length > 0) {
          return new Response(JSON.stringify(items), { headers });
        }
      }
    }
  } catch (err) {
    console.warn('Scrape charts failed:', err);
  }

  return new Response(JSON.stringify([]), { headers });
}
