// Cloudflare Pages Function: /api/prefetch
// 재생 대기열의 다음 곡 오디오 URL을 사전 캐싱하여 대기 시간 0초 실현

import { extractAudioUrl } from './audio-stream.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const idsParam = url.searchParams.get('id') || url.searchParams.get('ids') || '';
  const videoIds = idsParam.split(',').map(s => s.trim()).filter(id => /^[a-zA-Z0-9_-]{11}$/.test(id));

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (videoIds.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'No valid video IDs provided' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 백그라운드에서 병렬 사전 추출 (최대 4개)
  const tasks = videoIds.slice(0, 4).map(id => extractAudioUrl(id).catch(() => null));
  
  if (context.waitUntil) {
    context.waitUntil(Promise.all(tasks));
  } else {
    Promise.all(tasks);
  }

  return new Response(JSON.stringify({ ok: true, prefetched: videoIds.slice(0, 4) }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
