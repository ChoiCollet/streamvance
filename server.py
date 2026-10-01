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

    def is_non_music(self, title, channel):
        lower_title = title.lower()
        lower_channel = channel.lower()
        non_music_keywords = [
            'reaction', '리액션', '리액트', 'reacts',
            'vlog', '브이로그', '먹방', 'mukbang', '요리', 'cook',
            'review', '리뷰', 'unboxing', '언박싱', '사용기',
            'game', '게임', 'gameplay', 'walkthrough', 'playthrough', '공략', '롤', '배그',
            'news', '뉴스', '속보', 'ytn', '기자', '정치', '시사',
            'lecture', '강의', '설교', '공부', 'study with me',
            '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
            '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
            '하이라이트', 'highlight', '선공개', '예고편'
        ]
        # 리액션, 브이로그, 먹방, 게임, 뉴스는 음악 키워드가 있어도 무조건 차단
        for strict_kw in ['reaction', '리액션', 'vlog', '브이로그', '먹방', 'mukbang', '게임', 'gameplay', '뉴스', 'news']:
            if strict_kw in lower_title or strict_kw in lower_channel:
                return True

        for kw in non_music_keywords:
            if kw in lower_title or kw in lower_channel:
                music_guards = ['official mv', 'm/v', 'official audio', '가사', 'lyrics', '- topic', '노래']
                if not any(mg in lower_title or mg in lower_channel for mg in music_guards):
                    return True
        return False

    def music_score(self, title, channel, duration_sec):
        score = 0
        lt = title.lower()
        lc = channel.lower()
        # 공식 음원 채널 (Topic은 유튜브 뮤직 공식 아트 트랙)
        if '- topic' in lc:
            score += 10
        if any(lbl in lc for lbl in ['official', 'record', 'entertainment', 'music', '음악', '1thek', 'stone music', 'smtown', 'jyp', 'hybe', 'bighit', 'yg', 'dingo', 'mnet']):
            score += 6
        # 음악 메타데이터 키워드
        if any(m in lt for m in ['m/v', 'mv', 'official mv', 'official audio', '음원', '가사', 'lyrics', '노래', 'live clip', 'band']):
            score += 5
        # 일반적인 노래 재생시간 (2분~5분)
        if 110 <= duration_sec <= 330:
            score += 3
        return score

    def search_youtube(self, query):
        try:
            # YouTube 검색 페이지 요청 (비디오 우선 필터 적용: sp=EgIQAQ%253D%253D)
            search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}&sp=EgIQAQ%253D%253D"
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
                        # 1) officialCardViewModel (공식 아티스트 상위 검색결과)
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

                        # [비음악 유튜브 영상 완전 차단 필터링]
                        # 리액션, 브이로그, 먹방, 예능, 리뷰, 게임, 뉴스 등 비음악 영상 제외
                        if self.is_non_music(title, channel):
                            continue

                        # 타유튜버 편집본, 1시간 연속재생, 플레이리스트 모음 판별
                        is_compilation = (duration_sec > 600) or any(k in title.lower() for k in [
                            'playlist', '플레이리스트', '노래 모음', '전곡 모음', '1시간', '1 hour', '1hr', '모음집', '연속 듣기', '연속 재생', 'mix'
                        ])

                        # Shorts 제외 (45초 이상)
                        if duration_sec >= 45:
                            score = self.music_score(title, channel, duration_sec)
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
                                'isCompilation': is_compilation,
                                '_score': score
                            }
                            if is_compilation:
                                compilations.append(track_obj)
                            else:
                                songs.append(track_obj)

            except Exception as e:
                print(f"Error parsing items: {e}", file=sys.stderr)

            # 음악 적합도 점수 높은 순으로 정렬
            songs.sort(key=lambda s: s.get('_score', 0), reverse=True)

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
