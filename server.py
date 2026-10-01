#!/usr/bin/env python3
"""
Lightweight Local HTTP Server with YouTube Real-time Search Proxy
Zero third-party dependencies - Pure Python 3 standard library
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import re
import sys
import os

PORT = 3000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class MusicAppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # 실시간 유튜브 검색 API 엔드포인트: /api/search?q=...
        if parsed.path == '/api/search':
            query_params = urllib.parse.parse_qs(parsed.query)
            q = query_params.get('q', [''])[0].strip()
            
            if not q:
                self.send_json([])
                return
            
            results = self.search_youtube(q)
            self.send_json(results)
            return

        # 실시간 유튜브 인기 차트 API 엔드포인트: /api/charts
        if parsed.path == '/api/charts':
            results = self.search_youtube('2026 K-POP 인기 차트 TOP 50')
            self.send_json(results.get('tracks', []))
            return

        # 일반 정적 파일 서빙
        return super().do_GET()

    def send_json(self, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def search_youtube(self, query):
        try:
            # YouTube 검색 페이지 요청
            search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            req = urllib.request.Request(
                search_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
                }
            )
            
            with urllib.request.urlopen(req, timeout=5) as response:
                html = response.read().decode('utf-8', errors='ignore')

            # ytInitialData 추출
            match = re.search(r'ytInitialData\s*=\s*({.+?});</script>', html)
            if not match:
                match = re.search(r'var ytInitialData\s*=\s*({.+?});', html)
            
            if not match:
                return []

            data = json.loads(match.group(1))
            songs = []
            compilations = []
            artist_info = None

            # JSON 트리 탐색
            try:
                contents = data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents']
                for section in contents:
                    item_section = section.get('itemSectionRenderer', {})
                    for item in item_section.get('contents', []):
                        # 1) officialCardViewModel (공식 아티스트 상위 검색결과 - 스크린샷 2 100% 매칭)
                        if 'officialCardViewModel' in item and not artist_info:
                            ocv = item['officialCardViewModel']
                            header = ocv.get('header', {}).get('pageHeaderViewModel', {})
                            title_cont = header.get('title', {}).get('dynamicTextViewModel', {}).get('text', {}).get('content', '')
                            img_sources = header.get('image', {}).get('contentPreviewImageViewModel', {}).get('image', {}).get('sources', [])
                            avatar = img_sources[-1].get('url') if img_sources else ''
                            sub_text = '아티스트'
                            meta_rows = header.get('metadata', {}).get('contentMetadataViewModel', {}).get('metadataRows', [])
                            for row in meta_rows:
                                for part in row.get('metadataParts', []):
                                    c = part.get('text', {}).get('content', '')
                                    if '구독자' in c:
                                        sub_text = c
                                        break
                                if sub_text != '아티스트':
                                    break
                            if title_cont:
                                artist_info = {
                                    'name': title_cont,
                                    'subscribers': sub_text,
                                    'avatar': avatar
                                }

                        # 2) channelRenderer (유튜브 채널 렌더러)
                        if 'channelRenderer' in item and not artist_info:
                            cr = item['channelRenderer']
                            title_obj = cr.get('title', {})
                            name = title_obj.get('simpleText') or (title_obj.get('runs', [{}])[0].get('text', ''))
                            sub_obj = cr.get('subscriberCountText', {})
                            sub = sub_obj.get('simpleText') or (sub_obj.get('runs', [{}])[0].get('text', ''))
                            thumbs = cr.get('thumbnail', {}).get('thumbnails', [])
                            avatar = thumbs[-1].get('url') if thumbs else ''
                            if name:
                                artist_info = {
                                    'name': name,
                                    'subscribers': sub or '아티스트',
                                    'avatar': avatar
                                }

                        v = item.get('videoRenderer')
                        if not v or 'videoId' not in v:
                            continue
                        
                        video_id = v['videoId']
                        title = v.get('title', {}).get('runs', [{}])[0].get('text', '')
                        channel = v.get('ownerText', {}).get('runs', [{}])[0].get('text', '') or \
                                  v.get('longBylineText', {}).get('runs', [{}])[0].get('text', 'YouTube')
                        
                        # 재생 시간 파싱 (예: "3:45" -> 225초)
                        length_text = v.get('lengthText', {}).get('simpleText', '3:30')
                        duration_sec = 210
                        if ':' in length_text:
                            parts = length_text.split(':')
                            if len(parts) == 2:
                                duration_sec = int(parts[0]) * 60 + int(parts[1])
                            elif len(parts) == 3:
                                duration_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                        
                        thumbnails = v.get('thumbnail', {}).get('thumbnails', [])
                        cover = thumbnails[-1]['url'] if thumbnails else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

                        # 타유튜버 편집본, 1시간 연속재생, 플레이리스트 모음 판별
                        is_compilation = (duration_sec > 600) or any(k in title.lower() for k in [
                            'playlist', '플레이리스트', '노래 모음', '전곡 모음', '1시간', '1 hour', '1hr', '모음집', '연속 듣기', '연속 재생', 'mix'
                        ])

                        # Shorts 제외 (15초 이상)
                        if duration_sec > 15:
                            track_obj = {
                                'id': f"yt-{video_id}",
                                'videoId': video_id,
                                'title': self.clean_title(title),
                                'artist': channel,
                                'album': "YouTube Music",
                                'genre': "pop",
                                'mood': "all",
                                'duration': duration_sec,
                                'cover': cover,
                                'lyrics': [],
                                'isLiked': False,
                                'isCompilation': is_compilation
                            }
                            if is_compilation:
                                compilations.append(track_obj)
                            else:
                                songs.append(track_obj)

            except Exception as e:
                print(f"Error parsing items: {e}", file=sys.stderr)

            # 아티스트 검색 폴백: 검색어와 매칭되는 채널/가수가 상위에 있으면 아티스트 카드 생성
            if not artist_info and songs:
                q_clean = query.strip().lower()
                for s in songs[:5]:
                    s_artist = s.get('artist', '').lower()
                    if (len(q_clean) >= 2 and (q_clean in s_artist or s_artist in q_clean)):
                        artist_info = {
                            'name': s.get('artist'),
                            'subscribers': '아티스트',
                            'avatar': s.get('cover')
                        }
                        break

            # 정품 노래를 최우선으로 배치하고, 그 뒤에 컴필레이션/영상 배치
            all_results = songs + compilations
            return {
                'artist': artist_info,
                'tracks': all_results[:30],
                'songs': songs[:20],
                'videos': compilations[:15]
            }
        except Exception as e:
            print(f"YouTube search error: {e}", file=sys.stderr)
            return {'artist': None, 'tracks': [], 'songs': [], 'videos': []}

    def clean_title(self, title):
        title = re.sub(r'\[(Official|MV|M/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\]', '', title, flags=re.I)
        title = re.sub(r'\((Official|MV|M/V|Audio|Music Video|가사|Lyrics|Special Clip).*?\)', '', title, flags=re.I)
        title = re.sub(r'【.*?】', '', title)
        return title.strip()

if __name__ == '__main__':
    # 포트 재사용 옵션 적용
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MusicAppHandler) as httpd:
        print(f"Server started at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
