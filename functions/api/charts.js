// Cloudflare Pages Function: /api/charts
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 인기 차트 API (Innertube + Scrape 이중화)

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=1800, s-maxage=3600'
  };

  const url = new URL(context.request.url);
  const countryParam = (url.searchParams.get('country') || '').toUpperCase();
  const chartType = (url.searchParams.get('type') || '').toLowerCase();
  
  let country = countryParam;
  if (!country) {
    if (chartType === 'korea' || chartType === 'kpop') country = 'KR';
    else if (chartType === 'global') country = 'GLOBAL';
    else country = 'KR';
  }

  const countryPlaylists = {
    'KR': 'PL4fGSI1pDJn5S09aId3dUGp40ygUqmPGc',
    'GLOBAL': 'PL4fGSI1pDJn5kI81J1fYWK5eZRl1zJ5kM',
    'US': 'PL4fGSI1pDJn6O1LS0XSdF3RyO0Rq_LDeI',
    'JP': 'PL4fGSI1pDJn6jXS_PEoH9evbcXE4Vo5Ei',
    'GB': 'PL4fGSI1pDJn5sO_qHQw1O_eK2s5y_V9N_'
  };
  const targetPid = countryPlaylists[country] || countryPlaylists['KR'];

  // 1. YouTube Innertube Browse API로 공식 차트 재생목록 직접 조회
  try {
    const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'ko',
            gl: 'KR'
          }
        },
        browseId: `VL${targetPid}`
      })
    });

    if (browseRes.ok) {
      const bdata = await browseRes.json();
      const tc = bdata?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
      const tracks = [];

      for (const section of tc) {
        const items = section?.itemSectionRenderer?.contents || [];
        for (const it of items) {
          if (!it.lockupViewModel) continue;
          const lvm = it.lockupViewModel;
          const vid = lvm.contentId;
          if (!vid) continue;

          const meta = lvm.metadata?.lockupMetadataViewModel || {};
          const vTitle = meta.title?.content || '';
          const mRows = meta.metadata?.contentMetadataViewModel?.metadataRows || [];
          let vArtist = 'YouTube Music';
          let vDuration = 210;

          for (const row of mRows) {
            for (const part of (row.metadataParts || [])) {
              const txt = part.text?.content || '';
              if (txt.includes(':') && txt.replace(/:/g, '').split('').every(c => c >= '0' && c <= '9')) {
                const pts = txt.split(':').map(n => parseInt(n, 10));
                vDuration = pts.length === 2 ? pts[0] * 60 + pts[1] : pts[0] * 3600 + pts[1] * 60 + pts[2];
              } else if (txt && !txt.startsWith('조회수') && !txt.endsWith('전')) {
                vArtist = txt;
              }
            }
          }

          // 믹스/컴필레이션, 10분 초과, 1분 미만 및 차트 모음집 영상 엄격 제외
          const lt = vTitle.toLowerCase();
          const la = vArtist.toLowerCase();
          const badKeywords = ['playlist', '플레이리스트', '노래모음', '모음집', '종합차트', '1시간', '1hour', '차트둥이', 'top 100', 'top 50', 'top100', 'top50', '음악차트', '연속듣기', 'mix'];
          const isComp = vDuration > 600 || vDuration < 60 || badKeywords.some(k => lt.includes(k) || la.includes(k));
          if (!isComp) {
            tracks.push({
              id: `yt-${vid}`,
              videoId: vid,
              title: vTitle.replace(/\[(Official|MV|M\/V).*?\]/gi, '').replace(/\((Official|MV|M\/V).*?\)/gi, '').trim(),
              artist: vArtist,
              album: country === 'KR' ? '한국 인기 차트 TOP 100' : (country === 'GLOBAL' ? '글로벌 인기 차트 TOP 100' : `${country} 인기 차트 TOP 100`),
              genre: 'pop',
              mood: 'all',
              duration: vDuration,
              cover: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              lyrics: [],
              isLiked: false,
              isPlaylistTrack: true
            });
          }
        }
      }

      if (tracks.length > 0) {
        return new Response(JSON.stringify(tracks), { headers });
      }
    }
  } catch (e) {
    console.warn('Innertube browse chart failed:', e);
  }

  // 2. 폴백 검색
  try {
    const fallbackQueries = {
      'KR': 'K-POP 최신 인기곡 MV',
      'GLOBAL': 'Billboard Hot 100 official MV',
      'US': 'Billboard Hot 100 official MV',
      'JP': 'J-POP 最新 人気曲 MV',
      'GB': 'UK Top 40 official music video'
    };
    const q = fallbackQueries[country] || 'K-POP 최신 인기곡 MV';
    const payload = {
      context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'ko', gl: 'KR' } },
      query: q
    };
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
      const items = [];
      for (const section of contents) {
        for (const item of (section?.itemSectionRenderer?.contents || [])) {
          const v = item?.videoRenderer;
          if (!v || !v.videoId) continue;
          const title = v.title?.runs?.[0]?.text || '';
          const lt = title.toLowerCase();
          if (['playlist', '플레이리스트', '노래모음', '종합차트', '1시간'].some(k => lt.includes(k))) continue;
          items.push({
            id: `yt-${v.videoId}`,
            videoId: v.videoId,
            title: title.replace(/\[.*?\]|\(.*?\)/g, '').trim(),
            artist: v.ownerText?.runs?.[0]?.text || 'YouTube',
            album: '실시간 차트',
            genre: 'pop',
            mood: 'energy',
            duration: 210,
            cover: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            isLiked: false
          });
          if (items.length >= 30) break;
        }
      }
      if (items.length > 0) return new Response(JSON.stringify(items), { headers });
    }
  } catch (err) {
    console.warn('Fallback search failed:', err);
  }

  return new Response(JSON.stringify([]), { headers });
}
