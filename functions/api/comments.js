// Cloudflare Pages Function: /api/comments
// 엣지 서버리스 런타임에서 작동하는 실시간 유튜브 댓글 목록 수집 API (InnerTube API 기반)

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const videoId = (url.searchParams.get('id') || url.searchParams.get('videoId') || '').trim();
  const sort = (url.searchParams.get('sort') || 'top').trim();

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=180, s-maxage=300'
  };

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'videoId is required' }), { status: 400, headers });
  }

  try {
    const payloadInit = {
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

    const initRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: JSON.stringify(payloadInit)
    });

    if (!initRes.ok) {
      return new Response(JSON.stringify({ commentCount: '0', comments: [] }), { headers });
    }

    const initData = await initRes.json();
    let topToken = null;
    let newToken = null;
    let commentCountStr = '0';
    let isDisabled = false;
    let disabledMsg = '';

    // 1. contents itemSectionRenderer 탐색
    const sections = initData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    for (const section of sections) {
      const isr = section?.itemSectionRenderer;
      if (!isr) continue;

      const header = isr.header?.commentsHeaderRenderer;
      if (header) {
        if (header.commentsDisabledMessage) {
          isDisabled = true;
          const runs = header.commentsDisabledMessage.runs || [];
          disabledMsg = runs.map(r => r.text || '').join('') || '댓글이 사용 중지되었습니다.';
        }
        const countRuns = header.countText?.runs || [];
        if (countRuns.length > 0 && countRuns[0].text) {
          commentCountStr = countRuns[0].text;
        }
        const sortMenu = header.sortMenu?.sortFilterSubMenuRenderer?.subMenuItems || [];
        if (sortMenu.length > 0) {
          topToken = sortMenu[0]?.serviceEndpoint?.continuationCommand?.token;
          if (sortMenu.length > 1) {
            newToken = sortMenu[1]?.serviceEndpoint?.continuationCommand?.token;
          }
        }
      }

      for (const c of (isr.contents || [])) {
        const cmd = c?.continuationItemRenderer?.continuationEndpoint?.continuationCommand;
        if (cmd?.token && !topToken) {
          topToken = cmd.token;
          break;
        }
      }
    }

    // 2. engagementPanels 탐색
    if (!topToken) {
      const panels = initData?.engagementPanels || [];
      for (const p of panels) {
        const ep = p?.engagementPanelSectionListRenderer;
        if (ep && (ep.panelIdentifier || '').toLowerCase().includes('comment')) {
          const hdr = ep.header?.engagementPanelTitleHeaderRenderer;
          const ctx = hdr?.contextualInfo?.runs?.[0]?.text;
          if (ctx && commentCountStr === '0') {
            commentCountStr = ctx;
          }
          const submenu = hdr?.menu?.sortFilterSubMenuRenderer?.subMenuItems || [];
          if (submenu.length > 0) {
            topToken = submenu[0]?.serviceEndpoint?.continuationCommand?.token;
            if (submenu.length > 1) {
              newToken = submenu[1]?.serviceEndpoint?.continuationCommand?.token;
            }
          }
          break;
        }
      }
    }

    if (isDisabled) {
      return new Response(JSON.stringify({
        commentCount: '0',
        comments: [],
        disabled: true,
        disabledMessage: disabledMsg || '이 동영상(음원)은 유튜브 정책상 댓글이 사용 중지되어 있습니다.'
      }), { headers });
    }

    const targetToken = (sort === 'new' && newToken) ? newToken : topToken;
    if (!targetToken) {
      return new Response(JSON.stringify({
        commentCount: commentCountStr !== '0' ? commentCountStr.replace(/[^0-9만천억,.]/g, '') : '0',
        comments: []
      }), { headers });
    }

    const payloadCont = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20241001.01.00',
          hl: 'ko',
          gl: 'KR'
        }
      },
      continuation: targetToken
    };

    const contRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      body: JSON.stringify(payloadCont)
    });

    if (!contRes.ok) {
      return new Response(JSON.stringify({ commentCount: commentCountStr, comments: [] }), { headers });
    }

    const contData = await contRes.json();
    const comments = [];

    // Mutations (최신 Entity 모델)
    const mutations = contData?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    for (const m of mutations) {
      const cEntity = m?.payload?.commentEntityPayload;
      if (cEntity) {
        const author = cEntity.author?.displayName || '';
        const avatar = cEntity.author?.avatarThumbnailUrl || '';
        const content = cEntity.properties?.content?.content || '';
        const published = cEntity.properties?.publishedTime || '';
        const likeCount = cEntity.toolbar?.likeCountNotliked || '0';
        const replyCount = cEntity.toolbar?.replyCount || 0;
        if (author && content) {
          comments.push({
            author,
            avatar,
            content,
            publishedText: published,
            likeCount: String(likeCount),
            replyCount
          });
        }
      }
    }

    // fallback: commentThreadRenderer
    if (comments.length === 0) {
      const eps = contData?.onResponseReceivedEndpoints || [];
      for (const ep of eps) {
        for (const cmdKey of ['reloadContinuationItemsCommand', 'appendContinuationItemsAction']) {
          if (ep[cmdKey]) {
            const items = ep[cmdKey]?.continuationItems || [];
            for (const item of items) {
              const ctr = item?.commentThreadRenderer;
              const cr = ctr?.comment?.commentRenderer;
              if (cr) {
                const authorRuns = cr.authorText?.runs || [];
                const author = cr.authorText?.simpleText || authorRuns.map(r => r.text || '').join('');
                const thumbs = cr.authorThumbnail?.thumbnails || [];
                const avatar = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
                const contentRuns = cr.contentText?.runs || [];
                const content = contentRuns.map(r => r.text || '').join('');
                const published = cr.publishedTimeText?.runs?.[0]?.text || '';
                const likeCount = cr.voteCount?.simpleText || '0';
                const replyCount = ctr.replies?.commentRepliesRenderer?.viewReplies?.buttonRenderer?.text?.runs?.[0]?.text || 0;
                if (author && content) {
                  comments.push({
                    author,
                    avatar,
                    content,
                    publishedText: published,
                    likeCount: String(likeCount),
                    replyCount
                  });
                }
              }
            }
          }
        }
      }
    }

    const cleanCount = commentCountStr.replace(/[^0-9만천억,.]/g, '').trim() || String(comments.length);

    return new Response(JSON.stringify({
      commentCount: cleanCount !== '0' ? cleanCount : String(comments.length),
      comments: comments.slice(0, 50)
    }), { headers });

  } catch (err) {
    console.error('Comments fetch error:', err);
    return new Response(JSON.stringify({ commentCount: '0', comments: [] }), { headers });
  }
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
