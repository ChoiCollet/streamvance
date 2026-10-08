// Cloudflare Pages Function: /api/video-details
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 동영상 상세(좋아요 수, 댓글 수) API

function formatCountKo(num) {
  if (num === null || num === undefined || isNaN(num) || num <= 0) return '좋아요';
  num = Number(num);
  if (num >= 100000000) {
    const val = (num / 100000000).toFixed(1);
    return (val.endsWith('.0') ? val.slice(0, -2) : val) + '억';
  }
  if (num >= 10000) {
    const val = (num / 10000).toFixed(1);
    return (val.endsWith('.0') ? val.slice(0, -2) : val) + '만';
  }
  if (num >= 1000) {
    const val = (num / 1000).toFixed(1);
    return (val.endsWith('.0') ? val.slice(0, -2) : val) + '천';
  }
  return num.toLocaleString('ko-KR');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const videoId = (url.searchParams.get('videoId') || '').trim();

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=300, s-maxage=600'
  };

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'videoId is required' }), { status: 400, headers });
  }

  let likeStr = '좋아요';
  let rawLikes = 0;
  let commentStr = '0';
  let rawComments = 0;

  // 1. Return YouTube Dislike (RYD) API 초고속 호출 (전 세계 실시간 좋아요/싫어요 데이터베이스)
  try {
    const rydRes = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': 'Streamvance/2.0' },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (rydRes.ok) {
      const rydData = await rydRes.json();
      const likes = rydData.rawLikes || rydData.likes || 0;
      if (likes > 0) {
        rawLikes = likes;
        likeStr = formatCountKo(rawLikes);
      }
    }
  } catch (e) {
    console.warn('RYD fetch error:', e);
  }

  // 2. YouTube InnerTube API로 댓글 수 및 추가 좋아요 정보 추출
  try {
    const itPayload = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20241001.01.00',
          hl: 'ko',
          gl: 'KR'
        }
      },
      videoId: videoId
    };

    const itRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: JSON.stringify(itPayload)
    });

    if (itRes.ok) {
      const data = await itRes.json();
      const rawJson = JSON.stringify(data);

      // 좋아요 수 파싱 (RYD에서 못 가져왔을 때)
      if (likeStr === '좋아요' || rawLikes === 0) {
        const mLike = rawJson.match(/"defaultText":\s*\{\s*"accessibility":\s*\{\s*"accessibilityData":\s*\{\s*"label":\s*"[^"]*좋아요\s*([0-9,만천억.]+)\s*개/);
        if (mLike && mLike[1]) {
          likeStr = mLike[1].trim();
        } else {
          const mLike2 = rawJson.match(/좋아요\s*([0-9,만천억.]+)\s*개/);
          if (mLike2 && mLike2[1]) {
            likeStr = mLike2[1].trim();
          }
        }
      }

      // 댓글 수 파싱
      const sections = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      for (const section of sections) {
        const header = section?.itemSectionRenderer?.header?.commentsHeaderRenderer;
        if (header) {
          const countRuns = header.countText?.runs || [];
          if (countRuns.length > 0 && countRuns[0].text) {
            commentStr = countRuns[0].text;
            break;
          }
        }
      }

      // 2순위: engagementPanels contextualInfo (예: '1.9천', '85만')
      if (commentStr === '0' || !commentStr) {
        const panels = data?.engagementPanels || [];
        for (const p of panels) {
          const ep = p?.engagementPanelSectionListRenderer;
          if (ep && (ep.panelIdentifier || '').toLowerCase().includes('comment')) {
            const ctx = ep.header?.engagementPanelTitleHeaderRenderer?.contextualInfo?.runs?.[0]?.text;
            if (ctx) {
              commentStr = ctx;
              break;
            }
          }
        }
      }

      // 3순위: 정규식
      if (commentStr === '0' || !commentStr) {
        const mCmt = rawJson.match(/댓글\s*([0-9,만천억.]+)\s*개/);
        if (mCmt && mCmt[1]) {
          commentStr = mCmt[1].trim();
        }
      }
    }
  } catch (e) {
    console.warn('InnerTube details error:', e);
  }

  let cleanComment = (commentStr || '0').replace(/[^0-9만천억,.]/g, '').trim() || commentStr || '0';

  return new Response(JSON.stringify({
    videoId: videoId,
    likeCount: likeStr || '좋아요',
    rawLikeCount: rawLikes,
    commentCount: cleanComment || '0',
    rawCommentCount: rawComments
  }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
