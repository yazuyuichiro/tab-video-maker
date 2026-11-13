/**
 * tfjs の WebAssembly 版の計算方式。WebGL（GPU）が使えない環境のために、その時だけ Worker から読み込む。
 * - 読み込むと tfjs に 'wasm' が登録される（tfjs-core と同じ 3.21.0 に固定すること）
 * - wasm ファイルはビルドに含めて自ドメインから配信する（CDN からは読まない）
 * - スレッド版はページがクロスオリジン分離（COOP/COEP）されている時だけ使われる。今は分離していないので SIMD 版か通常版になる
 */
import { Fill, getKernel, registerKernel, unregisterKernel, util, type TensorLike } from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedSimdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';

setWasmPaths({
  'tfjs-backend-wasm.wasm': wasmUrl,
  'tfjs-backend-wasm-simd.wasm': wasmSimdUrl,
  'tfjs-backend-wasm-threaded-simd.wasm': wasmThreadedSimdUrl,
});

// tfjs 3.21 の不具合への対処: wasm 版の Fill は型（dtype）を省略されると「Unknown dtype undefined」で止まる。
// Basic Pitch が使う tf.signal.frame の末尾のゼロ埋めがこれに当たる。CPU 版・WebGL 版と同じく、値から型を推定して渡す
const fill = getKernel(Fill, 'wasm');
if (fill) {
  unregisterKernel(Fill, 'wasm');
  registerKernel({
    ...fill,
    kernelFunc: (args) => {
      const attrs = args.attrs ?? {};
      return fill.kernelFunc({ ...args, attrs: { ...attrs, dtype: attrs.dtype ?? util.inferDtype(attrs.value as TensorLike) } });
    },
  });
}
