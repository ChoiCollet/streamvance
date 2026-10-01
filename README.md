# Streamvance - YouTube Music Web Client

유튜브 뮤직 스타일의 현대적이고 반응형 웹 음악 플레이어 애플리케이션입니다.

## 주요 기능
- **음악 검색 및 아티스트 결과**: 공식 아티스트 카드, 대표 곡 및 관련 동영상 분리 표시
- **반응형 & 모바일 최적화**: 모바일 전용 검색창 및 최근 검색어 지원
- **플레이어 기능**:
  - 오디오 스트리밍 & YouTube 동영상 연동
  - 동영상 전체화면 및 시어터 모드(가사 동시 보기 지원)
  - 가사(Lyrics) 동기화 표시
  - 큐 관리 및 유사 장르/분위기 곡 자동 추천(Autoplay)
- **개인화 추천**:
  - 최근 재생/검색 기반 맞춤형 빠른 선곡(Quick Picks)
  - 보관함 및 좋아요 표시한 음악 관리
  - 무드/활동별 칩 필터 (`잠잘 때`, `휴식`, `에너지 충전`, `운동`, `집중` 등)
  - 아티스트 스포트라이트 및 둘러보기 분위기/장르 상세 추천

## 실행 방법
```bash
python server.py
```
브라우저에서 `http://localhost:3000` 접속

## 파일 구조
- `index.html`: 메인 웹 애플리케이션 HTML
- `css/style.css`: 애플리케이션 전체 스타일시트
- `js/`:
  - `app.js`: 애플리케이션 메인 컨트롤러 및 이벤트 바인딩
  - `ui.js`: DOM 렌더링 및 UI 상태 제어
  - `audioPlayer.js`: 오디오 재생 및 큐 관리
  - `searchService.js`: 음악 및 아티스트 검색 서비스
  - `lyricsService.js`: 가사 검색 및 파싱
  - `auth.js`: 사용자 인증 및 세션 관리
  - `data.js`: 기본 음원 및 장르/분위기 데이터
  - `colorExtractor.js`: 앨범 아트 기반 앰비언트 배경 색상 추출
- `functions/api/`: Cloudflare Pages Functions API 엔드포인트
- `server.py`: 로컬 개발용 Python 백엔드 서버
