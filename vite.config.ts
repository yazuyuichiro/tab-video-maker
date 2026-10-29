import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Google AdSense の設定（VITE_ADSENSE_CLIENT = ca-pub-xxxxxxxxxxxxxxxx）がある時だけ、
 * 審査・配信用のスクリプトとメタタグを HTML に入れ、ads.txt を出力する。
 */
function adsense(client: string | undefined): Plugin {
  const pub = client?.replace(/^ca-/, '');
  return {
    name: 'adsense',
    transformIndexHtml() {
      if (!client) return [];
      return [
        { tag: 'meta', attrs: { name: 'google-adsense-account', content: client }, injectTo: 'head' },
        {
          tag: 'script',
          attrs: {
            async: true,
            src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
            crossorigin: 'anonymous',
          },
          injectTo: 'head',
        },
      ];
    },
    generateBundle() {
      if (!pub) return;
      this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` });
    },
  };
}

/**
 * 同梱フォント（@fontsource）の読み込みを軽くする。
 * - woff2 だけを使う（今のブラウザはすべて対応しているので、古い woff は配信しない）
 * - BIZ UD ゴシックは名前に「Web」を付ける。Windows に入っている同じフォントがあればそちらを優先し、ダウンロードしない
 */
function webFonts(): Plugin {
  return {
    name: 'web-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource[\\/].+\.css$/.test(id)) return;
      return code
        .replace(/,\s*url\([^)]+\.woff\) format\('woff'\)/g, '')
        .replace(/font-family: 'BIZ (UDP?Gothic)'/g, "font-family: 'BIZ $1 Web'");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [webFonts(), react(), tailwindcss(), adsense(env.VITE_ADSENSE_CLIENT || undefined)],
    // ffmpeg.wasm はワーカーを new URL(..., import.meta.url) で生成するため事前バンドル対象から外す
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    worker: {
      format: 'es',
    },
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          privacy: 'privacy.html',
        },
      },
    },
  };
});
