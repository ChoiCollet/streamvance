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
import time

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

        # 유튜브 재생목록 API 엔드포인트: /api/playlist?id=...
        if parsed.path == '/api/playlist':
            query_params = urllib.parse.parse_qs(parsed.query)
            pid = query_params.get('id', [''])[0].strip() or query_params.get('url', [''])[0].strip()
            if not pid:
                self.send_json({'error': 'No playlist ID provided', 'tracks': []})
                return
            playlist_data = self.fetch_youtube_playlist(pid)
            self.send_json(playlist_data)
            return

        # 실시간 유튜브 인기 차트 API 엔드포인트: /api/charts
        if parsed.path == '/api/charts':
            results = self.search_youtube('2026 K-POP 인기 차트 TOP 50')
            self.send_json(results.get('tracks', []))
            return

        # 유튜브 실시간 영상 메타(좋아요 수 등) API 엔드포인트: /api/video-details?id=...&videoId=...
        if parsed.path == '/api/video-details':
            query_params = urllib.parse.parse_qs(parsed.query)
            vid = query_params.get('id', [''])[0].strip() or query_params.get('videoId', [''])[0].strip()
            if not vid:
                self.send_json({'error': 'No video ID', 'likeCount': '좋아요', 'rawLikeCount': 0})
                return
            details = self.fetch_video_details(vid)
            self.send_json(details)
            return

        # 유튜브 실시간 댓글 API 엔드포인트: /api/comments?id=...&videoId=...&sort=top|new
        if parsed.path == '/api/comments':
            query_params = urllib.parse.parse_qs(parsed.query)
            vid = query_params.get('id', [''])[0].strip() or query_params.get('videoId', [''])[0].strip()
            sort = query_params.get('sort', ['top'])[0].strip()
            if not vid:
                self.send_json({'error': 'No video ID', 'commentCount': '0', 'comments': []})
                return
            comments_data = self.fetch_youtube_comments(vid, sort)
            self.send_json(comments_data)
            return

        # 모바일 백그라운드 재생 방어용 무음 오디오 엔드포인트: /api/silent-stream
        if parsed.path == '/api/silent-stream':
            sample_rate = 44100
            total_samples = sample_rate // 2  # 0.5초 무음 버퍼
            data_size = total_samples * 2
            wav_data = bytearray(b'RIFF')
            wav_data.extend((36 + data_size).to_bytes(4, 'little'))
            wav_data.extend(b'WAVEfmt ')
            wav_data.extend((16).to_bytes(4, 'little'))
            wav_data.extend((1).to_bytes(2, 'little'))
            wav_data.extend((1).to_bytes(2, 'little'))
            wav_data.extend(sample_rate.to_bytes(4, 'little'))
            wav_data.extend((sample_rate * 2).to_bytes(4, 'little'))
            wav_data.extend((2).to_bytes(2, 'little'))
            wav_data.extend((16).to_bytes(2, 'little'))
            wav_data.extend(b'data')
            wav_data.extend(data_size.to_bytes(4, 'little'))
            wav_data.extend(b'\x00' * data_size)

            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.send_header('Content-Length', str(len(wav_data)))
            self.end_headers()
            try:
                self.wfile.write(wav_data)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
            return

        # / 또는 /index.html 요청 시 동적 OG 태그 (?v=...) 주입
        if parsed.path in ('', '/', '/index.html'):
            query_params = urllib.parse.parse_qs(parsed.query)
            vid = query_params.get('v', [''])[0].strip()
            index_path = os.path.join(DIRECTORY, 'index.html')
            if os.path.isfile(index_path):
                with open(index_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                if vid and re.match(r'^[a-zA-Z0-9_-]{11}$', vid):
                    thumb_url = f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
                    html_content = re.sub(
                        r'<meta property="og:image" content="[^"]*">',
                        f'<meta property="og:image" content="{thumb_url}">',
                        html_content
                    )
                    html_content = re.sub(
                        r'<meta name="twitter:image" content="[^"]*">',
                        f'<meta name="twitter:image" content="{thumb_url}">',
                        html_content
                    )
                html_bytes = html_content.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(html_bytes)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                try:
                    self.wfile.write(html_bytes)
                except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                    pass
                return

        # 일반 정적 파일 서빙
        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
        self.end_headers()

    def send_json(self, data):
        try:
            payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"Error sending json: {e}", file=sys.stderr)

    def is_non_music(self, title, channel):
        lower_title = (title or '').lower()
        lower_channel = (channel or '').lower()

        # 음원/노래/커버 가드 (영상 제목에 명시적으로 음악 관련 키워드가 있는 경우만 가드로 인정)
        music_guards = [
            'official mv', 'm/v', 'mv', 'official audio', '가사', 'lyrics',
            'cover', '커버', 'live cover', '우타이테', 'original song', '오리지널 곡',
            '음원', '노래방', 'karaoke', 'special clip', 'visualizer', 'dance practice', '응원법'
        ]
        has_title_music_guard = any(mg in lower_title for mg in music_guards)

        # 1. 게임 / 게임방송 / 게임플레이 / 게임대회 관련 키워드 (제목에 포함 시 음악 가드가 없으면 무조건 차단)
        game_keywords = [
            '마인크래프트', '마크', 'minecraft',
            '발로란트', 'valorant',
            '오버워치', 'overwatch',
            '배틀그라운드', '배그', 'pubg',
            '리그오브레전드', '롤', 'lol', '솔랭', '자랭', '칼바람',
            '스팀게임', '스팀', 'steam',
            '종합게임', '종겜', '게임플레이', 'gameplay', 'walkthrough', 'playthrough',
            '공략', '모바일게임', '게임 실황', '게임 방송', '게임대회', '스크림',
            '원신', '붕괴', '스타레일', '메이플', '로스트아크', '로아', '던파', '피파', 'fc온라인',
            '철권', '에이펙스', 'apex legends', '사이버펑크', '동물의숲', '포켓몬'
        ]
        for gk in game_keywords:
            if gk in lower_title and not has_title_music_guard:
                return True

        # 2. 비음악 스트리밍 / 잡담 / 일상 / 예능 / 다시보기 / 클립
        non_music_general = [
            '다시보기', '생방송', '라이브 다시보기', '풀영상', '방송 풀영상', '전체 다시보기',
            '클립', '핫클립', '클립영상', '영도', '영상도네',
            '잡담', '저챗', '저스트채팅', '저스트 채팅', '소통방송', '소통',
            '이상형월드컵', '이상형 월드컵', '월드컵',
            'q&a', '질문답변', 'qna',
            '브이로그', 'vlog',
            '먹방', 'mukbang', '쿡방', '요리', 'cook',
            'reaction', '리액션', '리액트', 'reacts',
            'review', '리뷰', 'unboxing', '언박싱', '사용기',
            'news', '뉴스', '속보', 'ytn', '기자', '정치', '시사',
            'lecture', '강의', '설교', 'study with me',
            '토크', '팟캐스트', 'podcast', '인터뷰', 'interview', '무대인사', '시사회',
            '출근길', '퇴근길', 'behind the scene', 'making of', '메이킹',
            '하이라이트', 'highlight', '선공개', '예고편'
        ]
        for nmg in non_music_general:
            if nmg in lower_title and not has_title_music_guard:
                return True

        return False

    OFFICIAL_LABELS = [
        'hybe', 'smtown', 'jyp', 'yg entertainment', '1thek', 'stone music',
        'edam', 'starship', 'cube', 'kakao', 'dingo', 'mnet', 'kbs kpop', 'mbk'
    ]

    def is_artist_official_channel(self, artist_name, channel):
        if not artist_name or not channel:
            return False
        a_norm = re.sub(r'[^a-zA-Z0-9가-힣]', '', artist_name.lower())
        c_norm = re.sub(r'[^a-zA-Z0-9가-힣]', '', channel.lower())
        if a_norm and (a_norm in c_norm or c_norm in a_norm):
            return True
        if '- topic' in channel.lower():
            return True
        if any(lbl in channel.lower() for lbl in self.OFFICIAL_LABELS):
            return True
        return False

    DETAILS_CACHE = {}
    COMMENTS_CACHE = {}
    INVIDIOUS_MIRRORS = [
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://iv.ggtyler.dev',
        'https://invidious.projectsegfau.lt'
    ]

    @staticmethod
    def format_count_ko(num):
        try:
            n = int(num)
            if n >= 100000000:
                return f"{n / 100000000:.1f}억".replace('.0억', '억')
            elif n >= 10000:
                return f"{n / 10000:.1f}만".replace('.0만', '만')
            elif n >= 1000:
                return f"{n / 1000:.1f}천".replace('.0천', '천')
            return str(n)
        except Exception:
            return str(num)

    def fetch_video_details(self, video_id):
        if video_id in self.DETAILS_CACHE:
            return self.DETAILS_CACHE[video_id]

        like_str = None
        like_raw = 0
        comment_str = None
        comment_raw = 0

        # 1차: YouTube InnerTube Next API 호출 (실시간 좋아요 수 및 댓글 수 파싱)
        try:
            payload = json.dumps({
                'context': {'client': {'clientName': 'WEB', 'clientVersion': '2.20241001.01.00', 'hl': 'ko', 'gl': 'KR'}},
                'videoId': video_id
            }).encode('utf-8')
            req = urllib.request.Request(
                'https://www.youtube.com/youtubei/v1/next',
                data=payload,
                headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9'}
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                raw_bytes = r.read()
                d = json.loads(raw_bytes.decode('utf-8', errors='ignore'))
                s = json.dumps(d, ensure_ascii=False)
                
                # A. accessibilityText 내 좋아요 수 파싱 (예: "좋아요 5.3만개", "좋아요 12만개", "좋아요 4,344개")
                m_acc = re.search(r'좋아요\s*([0-9,.]+[만천억MKk]?)개?', s)
                if m_acc and m_acc.group(1) not in ['표시', '취소']:
                    like_str = m_acc.group(1).strip()

                if not like_str:
                    m = re.search(r'([0-9,]+)명과 함께 이 동영상에 좋아요', s)
                    if m:
                        like_raw = int(m.group(1).replace(',', ''))
                        like_str = self.format_count_ko(like_raw)

                if not like_str:
                    m3 = re.search(r'"likeCount":\s*"([0-9]+)"', s)
                    if m3:
                        like_raw = int(m3.group(1))
                        like_str = self.format_count_ko(like_raw)

                # B. 댓글 수 파싱: 1순위 twoColumnWatchNextResults countText
                for section in d.get('contents', {}).get('twoColumnWatchNextResults', {}).get('results', {}).get('results', {}).get('contents', []):
                    isr = section.get('itemSectionRenderer', {})
                    header = isr.get('header', {}).get('commentsHeaderRenderer', {})
                    if header:
                        count_runs = header.get('countText', {}).get('runs', [])
                        if count_runs and count_runs[0].get('text'):
                            comment_str = count_runs[0].get('text')
                            break

                # 2순위: engagementPanels contextualInfo (예: 1.9천, 85만)
                if not comment_str:
                    for p in d.get('engagementPanels', []):
                        ep = p.get('engagementPanelSectionListRenderer', {})
                        if 'comment' in ep.get('panelIdentifier', '').lower():
                            hdr = ep.get('header', {}).get('engagementPanelTitleHeaderRenderer', {})
                            ctx = hdr.get('contextualInfo', {}).get('runs', [{}])[0].get('text', '')
                            if ctx:
                                comment_str = ctx
                                break

                # 3순위: 정규식
                if not comment_str:
                    m_cmt = re.search(r'댓글\s*([0-9,만천억.]+)\s*개', s)
                    if m_cmt:
                        comment_str = m_cmt.group(1).strip()
        except Exception as e:
            print(f"InnerTube details error for {video_id}: {e}", file=sys.stderr)

        # 2차: 좋아요 수가 아직 없거나 '좋아요' 텍스트일 때 Return YouTube Dislike 초고속 공개 API 호출
        if not like_str or like_str == '좋아요':
            try:
                ryd_url = f"https://returnyoutubedislikeapi.com/votes?videoId={urllib.parse.quote(video_id)}"
                ryd_req = urllib.request.Request(ryd_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(ryd_req, timeout=3) as ryd_res:
                    ryd_data = json.loads(ryd_res.read().decode('utf-8'))
                    raw_likes = ryd_data.get('rawLikes') or ryd_data.get('likes') or 0
                    if raw_likes > 0:
                        like_raw = raw_likes
                        like_str = self.format_count_ko(like_raw)
            except Exception:
                pass

        # 3차: 댓글 수가 아직 없으면 댓글 API를 백그라운드 호출하여 채움
        if not comment_str or comment_str == '댓글':
            try:
                cmts = self.fetch_youtube_comments(video_id, sort='top')
                if cmts.get('commentCount') and cmts.get('commentCount') not in ['0', '댓글']:
                    comment_str = cmts['commentCount']
                elif cmts.get('comments'):
                    comment_str = str(len(cmts['comments']))
                elif cmts.get('disabled') or cmts.get('commentCount') == '0':
                    comment_str = "0"
            except Exception:
                pass

        clean_comment = comment_str or "0"
        if clean_comment and clean_comment != "댓글":
            clean_comment = re.sub(r'[^0-9만천억,.]', '', clean_comment).strip() or clean_comment

        result = {
            'videoId': video_id,
            'likeCount': like_str or "좋아요",
            'rawLikeCount': like_raw,
            'commentCount': clean_comment,
            'rawCommentCount': comment_raw
        }
        self.DETAILS_CACHE[video_id] = result
        return result

    def fetch_youtube_comments(self, video_id, sort='top'):
        cache_key = f"{video_id}_{sort}"
        if cache_key in self.COMMENTS_CACHE:
            return self.COMMENTS_CACHE[cache_key]

        # 1. YouTube InnerTube API 직접 호출 (안정적 1순위)
        try:
            payload_init = json.dumps({
                'context': {
                    'client': {'clientName': 'WEB', 'clientVersion': '2.20241001.01.00', 'hl': 'ko', 'gl': 'KR'}
                },
                'videoId': video_id
            }).encode('utf-8')

            req_init = urllib.request.Request(
                'https://www.youtube.com/youtubei/v1/next',
                data=payload_init,
                headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9'}
            )

            with urllib.request.urlopen(req_init, timeout=5) as r:
                init_data = json.loads(r.read().decode('utf-8', errors='ignore'))

            top_token = None
            new_token = None
            comment_count_str = '0'
            is_disabled = False
            disabled_msg = None

            # A. 1순위: contents itemSectionRenderer 에서 실제 댓글 목록 continuation 토큰 및 댓글 수 탐색
            for section in init_data.get('contents', {}).get('twoColumnWatchNextResults', {}).get('results', {}).get('results', {}).get('contents', []):
                isr = section.get('itemSectionRenderer', {})
                header = isr.get('header', {}).get('commentsHeaderRenderer', {})
                if header:
                    if 'commentsDisabledMessage' in header:
                        is_disabled = True
                        runs = header['commentsDisabledMessage'].get('runs', [])
                        disabled_msg = ''.join([run.get('text', '') for run in runs]) or '댓글이 사용 중지되었습니다.'
                    count_runs = header.get('countText', {}).get('runs', [])
                    if count_runs:
                        comment_count_str = count_runs[0].get('text', comment_count_str)
                    sort_menu = header.get('sortMenu', {}).get('sortFilterSubMenuRenderer', {}).get('subMenuItems', [])
                    if sort_menu:
                        top_token = sort_menu[0].get('serviceEndpoint', {}).get('continuationCommand', {}).get('token')
                        if len(sort_menu) > 1:
                            new_token = sort_menu[1].get('serviceEndpoint', {}).get('continuationCommand', {}).get('token')
                for c in isr.get('contents', []):
                    cmd = c.get('continuationItemRenderer', {}).get('continuationEndpoint', {}).get('continuationCommand', {})
                    if cmd.get('token') and not top_token:
                        top_token = cmd.get('token')
                        break

            # B. 2순위: engagementPanels 에서 정렬 토큰 및 댓글 수 탐색
            if not top_token:
                for p in init_data.get('engagementPanels', []):
                    ep = p.get('engagementPanelSectionListRenderer', {})
                    if 'comment' in ep.get('panelIdentifier', '').lower():
                        hdr = ep.get('header', {}).get('engagementPanelTitleHeaderRenderer', {})
                        ctx = hdr.get('contextualInfo', {}).get('runs', [{}])[0].get('text', '')
                        if ctx and comment_count_str == '0':
                            comment_count_str = ctx
                        submenu = hdr.get('menu', {}).get('sortFilterSubMenuRenderer', {}).get('subMenuItems', [])
                        if submenu:
                            top_token = submenu[0].get('serviceEndpoint', {}).get('continuationCommand', {}).get('token')
                            if len(submenu) > 1:
                                new_token = submenu[1].get('serviceEndpoint', {}).get('continuationCommand', {}).get('token')
                        break

            if is_disabled:
                res = {'commentCount': '0', 'comments': [], 'disabled': True, 'disabledMessage': disabled_msg or '이 동영상(음원)은 유튜브 정책상 댓글이 사용 중지되어 있습니다.'}
                self.COMMENTS_CACHE[cache_key] = res
                return res

            target_token = new_token if (sort == 'new' and new_token) else top_token
            if target_token:
                payload_cont = json.dumps({
                    'context': {
                        'client': {'clientName': 'WEB', 'clientVersion': '2.20241001.01.00', 'hl': 'ko', 'gl': 'KR'}},
                    'continuation': target_token
                }).encode('utf-8')

                req_cont = urllib.request.Request(
                    'https://www.youtube.com/youtubei/v1/next',
                    data=payload_cont,
                    headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9'}
                )

                with urllib.request.urlopen(req_cont, timeout=6) as cr:
                    cont_data = json.loads(cr.read().decode('utf-8', errors='ignore'))

                # continuation 응답 내부에서 disabled 여부 재확인
                for ep in cont_data.get('onResponseReceivedEndpoints', []):
                    for cmd_key in ['reloadContinuationItemsCommand', 'appendContinuationItemsAction']:
                        if cmd_key in ep:
                            for it in ep[cmd_key].get('continuationItems', []):
                                chr = it.get('commentsHeaderRenderer', {})
                                if 'commentsDisabledMessage' in chr:
                                    is_disabled = True
                                    runs = chr['commentsDisabledMessage'].get('runs', [])
                                    disabled_msg = ''.join([r.get('text', '') for r in runs]) or '댓글이 사용 중지되었습니다.'

                if is_disabled:
                    res = {'commentCount': '0', 'comments': [], 'disabled': True, 'disabledMessage': disabled_msg or '이 동영상(음원)은 유튜브 정책상 댓글이 사용 중지되어 있습니다.'}
                    self.COMMENTS_CACHE[cache_key] = res
                    return res

                comments = []
                # 1순위: Mutations (YouTube 최신 Entity 모델)
                mutations = cont_data.get('frameworkUpdates', {}).get('entityBatchUpdate', {}).get('mutations', [])
                for m in mutations:
                    payload = m.get('payload', {})
                    c_entity = payload.get('commentEntityPayload', {})
                    if c_entity:
                        author = c_entity.get('author', {}).get('displayName', '')
                        avatar = c_entity.get('author', {}).get('avatarThumbnailUrl', '')
                        content = c_entity.get('properties', {}).get('content', {}).get('content', '')
                        published = c_entity.get('properties', {}).get('publishedTime', '')
                        like_count = c_entity.get('toolbar', {}).get('likeCountNotliked', '0')
                        reply_count = c_entity.get('toolbar', {}).get('replyCount', 0)
                        if author and content:
                            comments.append({
                                'author': author,
                                'avatar': avatar,
                                'content': content,
                                'publishedText': published,
                                'likeCount': str(like_count),
                                'replyCount': reply_count
                            })

                # 2순위: commentThreadRenderer 및 commentRenderer
                if not comments:
                    for ep in cont_data.get('onResponseReceivedEndpoints', []):
                        for cmd_key in ['reloadContinuationItemsCommand', 'appendContinuationItemsAction']:
                            if cmd_key in ep:
                                for item in ep[cmd_key].get('continuationItems', []):
                                    ctr = item.get('commentThreadRenderer', {})
                                    if not ctr:
                                        continue
                                    cr = ctr.get('comment', {}).get('commentRenderer', {})
                                    if cr:
                                        author = cr.get('authorText', {}).get('simpleText', '') or ''.join([r.get('text', '') for r in cr.get('authorText', {}).get('runs', [])])
                                        thumbs = cr.get('authorThumbnail', {}).get('thumbnails', [])
                                        avatar = thumbs[-1].get('url', '') if thumbs else ''
                                        content_runs = cr.get('contentText', {}).get('runs', [])
                                        content = ''.join([r.get('text', '') for r in content_runs])
                                        published = cr.get('publishedTimeText', {}).get('runs', [{}])[0].get('text', '')
                                        like_count = cr.get('voteCount', {}).get('simpleText', '0')
                                        reply_count = ctr.get('replies', {}).get('commentRepliesRenderer', {}).get('viewReplies', {}).get('buttonRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', 0)
                                        if author and content:
                                            comments.append({
                                                'author': author,
                                                'avatar': avatar,
                                                'content': content,
                                                'publishedText': published,
                                                'likeCount': str(like_count),
                                                'replyCount': reply_count
                                            })

                clean_count = re.sub(r'[^0-9만천억,.]', '', comment_count_str).strip() or str(len(comments))
                res = {
                    'commentCount': clean_count if clean_count != '0' else str(len(comments)),
                    'comments': comments[:50]
                }
                self.COMMENTS_CACHE[cache_key] = res
                return res

        except Exception as e:
            print(f"InnerTube comments error: {e}", file=sys.stderr)

        return {'commentCount': '0', 'comments': []}

    def music_score(self, title, channel, duration_sec, target_artist='', raw_query=''):
        score = 0
        lt = title.lower()
        lc = channel.lower()
        lq = (raw_query or target_artist or '').lower()

        # 사용자 검색 의도 판별
        is_cover_query = any(k in lq for k in ['커버', 'cover', '우타이테', '가창'])
        is_karaoke_query = any(k in lq for k in ['노래방', 'karaoke', 'tj', '금영', 'ky', 'mr', '반주', 'inst'])
        is_lyrics_query = any(k in lq for k in ['가사', 'lyrics', '자막'])

        # 1. 공식 음원 및 아티스트 공식 채널 우대
        is_official_ch = target_artist and self.is_artist_official_channel(target_artist, channel)
        if is_official_ch:
            score += 35
        # 공식 음원 채널 (Topic은 유튜브 뮤직 공식 아트 트랙 - 원곡 최우선 배치)
        if '- topic' in lc:
            score += 30
        if any(lbl in lc for lbl in self.OFFICIAL_LABELS):
            score += 20
        # 음악 메타데이터 키워드 (공식 음원/MV)
        if any(m in lt for m in ['official audio', 'official music video', 'official mv', 'm/v', 'mv']):
            score += 15
        elif any(m in lt for m in ['audio', '음원', 'original sound']):
            score += 10
        # 일반적인 노래 재생시간 (2분~5분)
        if 110 <= duration_sec <= 330:
            score += 5

        # 2. 커버곡 우선순위: 사용자가 커버를 검색한 경우 커버곡 우대, 일반 노래 검색 시 원곡 아래로 배치
        is_cover_item = any(k in lt for k in ['cover', '커버', 'covered by', '가창']) or any(k in lc for k in ['cover', '커버'])
        if is_cover_query:
            if is_cover_item:
                score += 35
        else:
            if is_cover_item and not is_official_ch:
                score -= 40 # 일반 검색 시 타인 커버곡 대폭 감점

        # 3. 노래방 / MR / 반주 처리: 일반 노래 검색 시 강력 감점
        is_karaoke_item = any(k in lt for k in ['노래방', 'karaoke', 'tj노래방', 'ky노래방', 'tj미디어', '금영', 'mr제거', '반주']) or \
                          any(k in lc for k in ['노래방', 'karaoke', 'tj', '금영', 'ky']) or \
                          bool(re.search(r'\b(mr|inst|instrumental)\b', lt))
        if is_karaoke_query:
            if is_karaoke_item:
                score += 35
        else:
            if is_karaoke_item:
                score -= 50 # 원곡 검색 시 노래방/MR 최하단으로 밀어냄

        # 4. 일반 유튜버/팬 가사 편집본 영상 감점
        is_lyrics_item = any(k in lt for k in ['가사', 'lyrics', '자막', '교차편집', 'han/rom/eng'])
        if is_lyrics_query:
            if is_lyrics_item:
                score += 25
        else:
            if is_lyrics_item and not (is_official_ch or '- topic' in lc or any(lbl in lc for lbl in self.OFFICIAL_LABELS)):
                score -= 25

        # 5. 1시간 연속재생, 플레이리스트 감점
        if any(k in lt for k in ['1시간', '1hour', '10분', '연속듣기', '반복재생']):
            score -= 30

        return score

    def search_youtube_innertube(self, query):
        try:
            url = 'https://www.youtube.com/youtubei/v1/search'
            payload = json.dumps({
                "context": {
                    "client": {
                        "clientName": "WEB",
                        "clientVersion": "2.20240101.00.00",
                        "hl": "ko",
                        "gl": "KR"
                    }
                },
                "query": query
            }).encode('utf-8')
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode('utf-8', errors='ignore'))
            
            contents = data.get('contents', {}).get('twoColumnSearchResultsRenderer', {}).get('primaryContents', {}).get('sectionListRenderer', {}).get('contents', [])
            songs = []
            compilations = []
            artist_info = None

            for section in contents:
                item_section = section.get('itemSectionRenderer', {})
                for item in item_section.get('contents', []):
                    if 'channelRenderer' in item and not artist_info:
                        cr = item['channelRenderer']
                        title_obj = cr.get('title', {})
                        name = title_obj.get('simpleText') or (title_obj.get('runs', [{}])[0].get('text', ''))
                        sub_obj = cr.get('subscriberCountText', {})
                        sub = sub_obj.get('simpleText') or (sub_obj.get('runs', [{}])[0].get('text', ''))
                        thumbs = cr.get('thumbnail', {}).get('thumbnails', [])
                        avatar = thumbs[-1].get('url') if thumbs else ''
                        if name:
                            artist_info = {'name': name, 'subscribers': sub or '아티스트', 'avatar': avatar}

                    v = item.get('videoRenderer')
                    if not v or 'videoId' not in v:
                        continue
                    video_id = v['videoId']
                    title = v.get('title', {}).get('runs', [{}])[0].get('text', '')
                    channel = v.get('ownerText', {}).get('runs', [{}])[0].get('text', '') or \
                              v.get('longBylineText', {}).get('runs', [{}])[0].get('text', 'YouTube')
                    length_text = v.get('lengthText', {}).get('simpleText', '3:30')
                    duration_sec = 210
                    if ':' in length_text:
                        parts = length_text.split(':')
                        if len(parts) == 2:
                            duration_sec = int(parts[0]) * 60 + int(parts[1])
                        elif len(parts) == 3:
                            duration_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                    
                    if self.is_non_music(title, channel):
                        continue

                    thumbnails = v.get('thumbnail', {}).get('thumbnails', [])
                    cover = thumbnails[-1]['url'] if thumbnails else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                    is_compilation = (duration_sec > 600) or any(w in title.lower() for w in ['playlist', '플레이리스트', '노래 모음', '전곡 모음'])
                    is_official = self.is_artist_official_channel(channel, query)
                    score = self.music_score(title, channel, duration_sec, query, query)

                    track_obj = {
                        'id': f"yt-{video_id}",
                        'videoId': video_id,
                        'title': self.clean_title(title),
                        'artist': query if is_official else channel,
                        'channel': channel,
                        'isOfficialChannel': is_official,
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

            songs.sort(key=lambda s: s.get('_score', 0), reverse=True)
            all_results = songs + compilations
            if all_results:
                return {
                    'artist': artist_info,
                    'tracks': all_results[:30],
                    'songs': songs[:20],
                    'videos': compilations[:15]
                }
        except Exception:
            pass
        return None

    def extract_playlist_id(self, input_str):
        if not input_str:
            return None
        m = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', input_str)
        if m:
            return m.group(1)
        s = input_str.strip()
        if re.match(r'^(PL|VLPL|RD|OLAK5uy_)[a-zA-Z0-9_-]+$', s):
            return s.replace('VL', '', 1) if s.startswith('VLPL') else s
        return None

    def fetch_youtube_playlist(self, pid):
        clean_pid = self.extract_playlist_id(pid) or pid.strip()
        browse_id = clean_pid if clean_pid.startswith('VL') else f"VL{clean_pid}"
        try:
            url = 'https://www.youtube.com/youtubei/v1/browse'
            payload = json.dumps({
                "context": {
                    "client": {
                        "clientName": "WEB",
                        "clientVersion": "2.20240101.00.00",
                        "hl": "ko",
                        "gl": "KR"
                    }
                },
                "browseId": browse_id
            }).encode('utf-8')
            req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                bdata = json.loads(resp.read().decode('utf-8', errors='ignore'))
            
            header = bdata.get('header', {})
            pl_header = header.get('playlistHeaderRenderer', {})
            title = pl_header.get('title', {}).get('simpleText') or \
                    (pl_header.get('title', {}).get('runs', [{}])[0].get('text', '') if pl_header.get('title', {}).get('runs') else '') or \
                    bdata.get('metadata', {}).get('playlistMetadataRenderer', {}).get('title', '유튜브 재생목록')
            author = (pl_header.get('ownerText', {}).get('runs', [{}])[0].get('text', 'YouTube') if pl_header.get('ownerText', {}).get('runs') else 'YouTube')
            
            tracks = []
            tc = bdata.get('contents', {}).get('twoColumnBrowseResultsRenderer', {})
            tabs = tc.get('tabs', [])
            if tabs:
                tab_content = tabs[0].get('tabRenderer', {}).get('content', {})
                sec_list = tab_content.get('sectionListRenderer', {})
                for c in sec_list.get('contents', []):
                    item_sec = c.get('itemSectionRenderer', {})
                    for it in item_sec.get('contents', []):
                        if 'lockupViewModel' in it:
                            lvm = it['lockupViewModel']
                            vid = lvm.get('contentId')
                            if not vid:
                                continue
                            meta = lvm.get('metadata', {}).get('lockupMetadataViewModel', {})
                            v_title = meta.get('title', {}).get('content', '')
                            m_rows = meta.get('metadata', {}).get('contentMetadataViewModel', {}).get('metadataRows', [])
                            v_artist = author
                            v_duration = 210
                            for row in m_rows:
                                for part in row.get('metadataParts', []):
                                    txt = part.get('text', {}).get('content', '')
                                    if ':' in txt and txt.replace(':', '').isdigit():
                                        pts = [int(p) for p in txt.split(':')]
                                        v_duration = pts[0] * 60 + pts[1] if len(pts) == 2 else pts[0] * 3600 + pts[1] * 60 + pts[2]
                                    elif txt and not txt.startswith('조회수') and not txt.endswith('전'):
                                        v_artist = txt
                            
                            tracks.append({
                                'id': f"yt-{vid}",
                                'videoId': vid,
                                'title': self.clean_title(v_title),
                                'artist': v_artist,
                                'album': title,
                                'genre': 'pop',
                                'mood': 'all',
                                'duration': v_duration,
                                'cover': f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                                'lyrics': [],
                                'isLiked': False,
                                'isPlaylistTrack': True
                            })
                        elif 'playlistVideoListRenderer' in it:
                            for pv_item in it['playlistVideoListRenderer'].get('contents', []):
                                pv = pv_item.get('playlistVideoRenderer', {})
                                vid = pv.get('videoId')
                                if not vid:
                                    continue
                                v_title = pv.get('title', {}).get('runs', [{}])[0].get('text', '') or pv.get('title', {}).get('simpleText', '')
                                v_artist = pv.get('shortBylineText', {}).get('runs', [{}])[0].get('text', author)
                                dur_str = str(pv.get('lengthSeconds', '210'))
                                v_duration = int(dur_str) if dur_str.isdigit() else 210
                                tracks.append({
                                    'id': f"yt-{vid}",
                                    'videoId': vid,
                                    'title': self.clean_title(v_title),
                                    'artist': v_artist,
                                    'album': title,
                                    'genre': 'pop',
                                    'mood': 'all',
                                    'duration': v_duration,
                                    'cover': f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                                    'lyrics': [],
                                    'isLiked': False,
                                    'isPlaylistTrack': True
                                })

            return {
                'id': clean_pid,
                'title': title,
                'author': author,
                'trackCount': len(tracks),
                'tracks': tracks
            }
        except Exception as e:
            print(f"Error fetching playlist {clean_pid}: {e}", file=sys.stderr)
            return {'id': clean_pid, 'title': '재생목록 로드 실패', 'author': '', 'trackCount': 0, 'tracks': []}

    def search_youtube(self, query):
        try:
            # 재생목록 URL 혹은 ID 감지 시 즉각 재생목록 파싱 반환
            pl_id = self.extract_playlist_id(query)
            if pl_id:
                pl_res = self.fetch_youtube_playlist(pl_id)
                if pl_res and pl_res.get('tracks'):
                    return {
                        'artist': {
                            'name': pl_res.get('title', '유튜브 재생목록'),
                            'subscribers': f"{pl_res.get('author', 'YouTube')} • {pl_res.get('trackCount', 0)}곡",
                            'avatar': pl_res['tracks'][0].get('cover', '')
                        },
                        'isPlaylist': True,
                        'playlist': pl_res,
                        'tracks': pl_res['tracks'],
                        'songs': pl_res['tracks'],
                        'videos': []
                    }

            # 1차: YouTube 검색 웹 스크래핑
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
                innertube_res = self.search_youtube_innertube(query)
                if innertube_res:
                    return innertube_res
                return {'artist': None, 'tracks': [], 'songs': [], 'videos': []}

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
                            is_official = self.is_artist_official_channel(query, channel)
                            score = self.music_score(title, channel, duration_sec, query, query)
                            track_obj = {
                                'id': f"yt-{video_id}",
                                'videoId': video_id,
                                'title': self.clean_title(title),
                                'artist': query if is_official else channel,
                                'channel': channel,
                                'isOfficialChannel': is_official,
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
    # 멀티스레드 동시 처리 및 포트 재사용 옵션 적용
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), MusicAppHandler) as httpd:
        print(f"Server started at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
