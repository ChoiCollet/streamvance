// Cloudflare Pages Middleware: Open Graph Dynamic Meta Injector
// 카카오톡 및 SNS 공유 시 URL의 ?v={videoId} 파라미터를 감지하여 해당 곡의 공식 유튜브 썸네일을 og:image로 동적 주입

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const videoId = url.searchParams.get('v');
  const response = await context.next();

  // videoId가 11자리 유튜브 표준 ID인지 검증하고 HTML 응답인 경우 메타태그 동적 치환
  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html') || url.pathname === '/' || url.pathname.endsWith('.html')) {
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return new HTMLRewriter()
        .on('meta[property="og:image"]', {
          element(el) {
            el.setAttribute('content', thumbUrl);
          }
        })
        .on('meta[name="twitter:image"]', {
          element(el) {
            el.setAttribute('content', thumbUrl);
          }
        })
        .transform(response);
    }
  }

  return response;
}
