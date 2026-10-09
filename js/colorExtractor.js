// ==========================================================================
// Dominant Color Extractor for Dynamic Ambient Glow (Album Art -> CSS Theme)
// ==========================================================================

export class ColorExtractor {
  constructor() {
    this.cache = new Map();
  }

  // 앨범 아트 이미지로부터 가장 시각적으로 조화로운 대표 색상 (r, g, b) 추출
  extract(imageUrl, callback) {
    if (!imageUrl) {
      this.applyFallback(callback);
      return;
    }

    if (this.cache.has(imageUrl)) {
      callback(this.cache.get(imageUrl));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = 24;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);

        const imgData = ctx.getImageData(0, 0, size, size).data;
        let totalR = 0, totalG = 0, totalB = 0, validPixels = 0;

        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];

          if (a < 128) continue; // 투명 픽셀 제외

          // 너무 어둡거나 너무 하얀 픽셀을 제외하여 실제 앨범의 고유 톤 추출
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          if (brightness > 25 && brightness < 230) {
            totalR += r;
            totalG += g;
            totalB += b;
            validPixels++;
          }
        }

        let rgb;
        if (validPixels > 0) {
          rgb = {
            r: Math.round(totalR / validPixels),
            g: Math.round(totalG / validPixels),
            b: Math.round(totalB / validPixels)
          };
        } else {
          rgb = this.hashColor(imageUrl);
        }

        // 지나치게 어두운 색상은 무드감 있도록 최소 명도 보정 (terracotta / deep plum / navy 등)
        const currentBrightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        if (currentBrightness < 45) {
          rgb.r = Math.min(255, Math.round(rgb.r * 1.5 + 20));
          rgb.g = Math.min(255, Math.round(rgb.g * 1.5 + 15));
          rgb.b = Math.min(255, Math.round(rgb.b * 1.5 + 20));
        }

        this.cache.set(imageUrl, rgb);
        callback(rgb);
      } catch (err) {
        // CORS 제한 이미지일 경우 안정적인 문자열 해시 기반 고유 색상 매핑
        const rgb = this.hashColor(imageUrl);
        this.cache.set(imageUrl, rgb);
        callback(rgb);
      }
    };

    img.onerror = () => {
      this.applyFallback(callback);
    };

    img.src = imageUrl;
  }

  hashColor(str) {
    let hash = 0;
    for (let i = 0; i < (str || '').length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    // 유튜브 뮤직 특유의 따뜻하고 차분한 테라코타, 플럼, 네이비 계열 색상 대역
    const r = Math.abs((hash & 0xFF0000) >> 16) % 95 + 40;
    const g = Math.abs((hash & 0x00FF00) >> 8) % 65 + 25;
    const b = Math.abs(hash & 0x0000FF) % 85 + 30;
    return { r, g, b };
  }

  applyFallback(callback) {
    callback({ r: 55, g: 30, b: 35 });
  }

  // 추출된 색상을 CSS 커스텀 속성으로 즉시 주입 (배경 대비 가독성 보장)
  applyToDOM(rgb) {
    if (!rgb) return;
    const root = document.documentElement;
    root.style.setProperty('--track-r', rgb.r);
    root.style.setProperty('--track-g', rgb.g);
    root.style.setProperty('--track-b', rgb.b);

    // 배경 명도(Luminance) 분석 기반 대비 보정
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    const tabInactive = brightness > 140 ? 'rgba(255, 255, 255, 0.78)' : 'rgba(255, 255, 255, 0.70)';
    const tabActive = '#ffffff';

    // 앨범 무드를 살린 부드러운 틴트 악센트 컬러
    const accentR = Math.min(255, Math.round(rgb.r * 0.45 + 140));
    const accentG = Math.min(255, Math.round(rgb.g * 0.45 + 140));
    const accentB = Math.min(255, Math.round(rgb.b * 0.45 + 140));

    root.style.setProperty('--track-tab-inactive', tabInactive);
    root.style.setProperty('--track-tab-active', tabActive);
    root.style.setProperty('--track-tab-accent', `rgb(${accentR}, ${accentG}, ${accentB})`);
  }
}
