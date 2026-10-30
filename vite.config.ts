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

/** プライバシーポリシーに載せる運営者名とお問い合わせ先（環境変数 VITE_OPERATOR_NAME / VITE_CONTACT で上書きできる） */
const OPERATOR = 'yason';
const CONTACT = 'https://yason-eng.com/contact';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** お問い合わせ先がメールアドレスか URL ならリンクにする */
function contactHtml(contact: string) {
  const text = escapeHtml(contact);
  if (/^https?:\/\/\S+$/.test(contact)) return `<a href="${text}" target="_blank" rel="noopener">${text}</a>`;
  if (/^[^\s@]+@[^\s@]+$/.test(contact)) return `<a href="mailto:${text}">${text}</a>`;
  return text;
}

/**
 * プライバシーポリシーの「運営者」の欄を、環境変数（VITE_OPERATOR_NAME / VITE_CONTACT）から作る。
 * 設定されていない項目は出さない（設定前の文字がそのまま表示されないように）。
 */
function operatorInfo(name?: string, contact?: string): Plugin {
  return {
    name: 'operator-info',
    transformIndexHtml(html) {
      if (!name && !contact) return html;
      const rows = [
        `<h2>6. 運営者${contact ? '・お問い合わせ' : ''}</h2>`,
        name ? `<p>運営者: ${escapeHtml(name)}</p>` : '<p>本サービスは個人が開発・運営しています。</p>',
        contact ? `<p>お問い合わせ: ${contactHtml(contact)}</p>` : '',
      ];
      return html.replace(/<!-- operator -->[\s\S]*?<!-- \/operator -->/, rows.filter(Boolean).join('\n      '));
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
    plugins: [
      webFonts(),
      react(),
      tailwindcss(),
      adsense(env.VITE_ADSENSE_CLIENT || undefined),
      operatorInfo(env.VITE_OPERATOR_NAME?.trim() || OPERATOR, env.VITE_CONTACT?.trim() || CONTACT),
    ],
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
