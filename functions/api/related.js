// Cloudflare Pages Function: /api/related
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 유사 음악 / 자동재생 추천 API (InnerTube Next API 연동)

const BAD_KEYWORDS = [
  '1시간', '1hour', '모음', 'playlist', '플레이리스트', '연속듣기', '반복재생',
  'top 100', 'top 50', '차트둥이', 'mix', '전곡'
];

const GAME_KEYWORDS = [
  '마인크래프트', '마크', 'minecraft', '발로란트', 'valorant', '오버워치', 'overwatch',
  '배틀그라운드', '배그', 'pubg', '리그오브레전드', '롤', 'lol', '원신', '스타레일',
  '게임', 'gameplay', '다시보기', '생방송', '브이로그', 'vlog', '먹방', '리액션'
];

function isNonMusic(title, channel) {
  const lt = (title || '').toLowerCase();
  const lc = (channel || '').toLowerCase();

  const musicGuards = [
    'official mv', 'm/v', 'mv', 'official audio', '가사', 'lyrics',
    'cover', '커버', 'live cover', '음원', 'song', 'track', 'ost'
  ];
  const hasGuard = musicGuards.some(mg => lt.includes(mg));

  if (hasGuard) return false;
  return GAME_KEYWORDS.some(gk => lt.includes(gk) || lc.includes(gk));
}

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\[(Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Visualizer).*?\]/gi, '')
    .replace(/\((Official|MV|M\/V|Audio|Music Video|가사|Lyrics|Special Clip|Visualizer).*?\)/gi, '')
    .trim();
}

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=1800, s-maxage=3600'
  };

  const url = new URL(context.request.url);
  const vid = (url.searchParams.get('id') || url.searchParams.get('videoId') || '').trim();
  const artist = (url.searchParams.get('artist') || '').trim();
  const title = (url.searchParams.get('title') || '').trim();

  if (!vid) {
    return new Response(JSON.stringify({ videoId: '', tracks: [] }), { headers });
  }

  const tracks = [];
  const seenIds = new Set([vid]);

  try {
    const nextRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20241001.01.00', hl: 'ko', gl: 'KR' }
        },
        videoId: vid
      })
    });

    if (nextRes.ok) {
      const data = await nextRes.json();
      const secResults = data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];

      for (const it of secResults) {
        let tVid = null;
        let tTitle = null;
        let tArtist = null;
        let tDur = 0;

        const vm = it.lockupViewModel;
        if (vm && vm.contentId && !String(vm.contentId).startsWith('PL')) {
          tVid = vm.contentId;
          const meta = vm.metadata?.lockupMetadataViewModel;
          tTitle = meta?.title?.content || '';
          const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows;
          if (rows && rows[0]?.parts && rows[0].parts[0]?.text?.content) {
            tArtist = rows[0].parts[0].text.content;
          }
        }

        const cvr = it.compactVideoRenderer;
        if (cvr && cvr.videoId && !String(cvr.videoId).startsWith('PL')) {
          tVid = cvr.videoId;
          tTitle = cvr.title?.simpleText || cvr.title?.runs?.[0]?.text || '';
          tArtist = cvr.shortBylineText?.runs?.[0]?.text || '';
          const durStr = cvr.lengthText?.simpleText || '';
          if (durStr) {
            const parts = durStr.split(':');
            try {
              if (parts.length === 2) tDur = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
              else if (parts.length === 3) tDur = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
            } catch (e) {
              tDur = 200;
            }
          }
        }

        if (tVid && !seenIds.has(tVid) && tTitle) {
          if (tDur > 0 && (tDur < 60 || tDur > 600)) continue;
          if (isNonMusic(tTitle, tArtist || '')) continue;
          if (BAD_KEYWORDS.some(bk => (tTitle || '').toLowerCase().includes(bk))) continue;

          seenIds.add(tVid);
          tracks.push({
            id: `related-${tVid}`,
            videoId: tVid,
            title: cleanTitle(tTitle),
            artist: tArtist || artist || 'YouTube Artist',
            album: `${artist || 'YouTube'} 추천 트랙`,
            duration: tDur > 0 ? tDur : 210,
            cover: `https://i.ytimg.com/vi/${tVid}/hqdefault.jpg`,
            isLiked: false
          });
        }
      }
    }
  } catch (err) {
    console.warn('InnerTube next related failed on edge:', err);
  }

  // 폴백: 연관 추천이 적으면 아티스트 검색으로 추천 곡 보충
  if (tracks.length < 5 && artist) {
    try {
      const searchUrl = `${url.origin}/api/search?q=${encodeURIComponent(`${artist} 인기곡`)}`;
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const sData = await searchRes.json();
        const candidateTracks = sData.tracks || sData.songs || [];
        for (const ct of candidateTracks) {
          if (ct.videoId && !seenIds.has(ct.videoId)) {
            seenIds.add(ct.videoId);
            tracks.push(ct);
            if (tracks.length >= 15) break;
          }
        }
      }
    } catch (e) {}
  }

  return new Response(JSON.stringify({ videoId: vid, tracks }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
