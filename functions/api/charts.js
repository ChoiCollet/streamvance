// Cloudflare Pages Function: /api/charts
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 인기 차트 API

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=600' // 10분 캐시
  };

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent('2026 K-POP 인기 차트 TOP 50')}`;

  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });

    if (!res.ok) throw new Error('YouTube fetch failed');
    const html = await res.text();

    let match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
    if (!match) match = html.match(/var ytInitialData\s*=\s*({.+?});/);
    if (!match) return new Response(JSON.stringify([]), { headers });

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
        const thumbnails = v.thumbnail?.thumbnails || [];
        const cover = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        items.push({
          id: `chart-${videoId}`,
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

        if (items.length >= 20) break;
      }
      if (items.length >= 20) break;
    }

    return new Response(JSON.stringify(items), { headers });
  } catch (err) {
    return new Response(JSON.stringify([]), { headers });
  }
}
