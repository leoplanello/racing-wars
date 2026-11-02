// Layout da tela dividida (puro, sem DOM): quantas colunas/linhas para n jogadores e o retangulo de cada celula.
// 1 = tela cheia; 2 = uma em cima da outra (como o SRB2Kart); 3-4 = 2x2; 5-6 = 3x2; 7-9 = 3x3; 10-12 = 4x3; 13-16 = 4x4.
// Coordenadas em pixels CSS com a origem no canto superior esquerdo.

/** [colunas, linhas] da grade para n celulas. */
export function splitGrid(n) {
  if (n <= 1) return [1, 1];
  if (n === 2) return [1, 2];
  if (n <= 4) return [2, 2];
  if (n <= 6) return [3, 2];
  if (n <= 9) return [3, 3];
  if (n <= 12) return [4, 3];
  return [4, 4];
}

/**
 * Retangulos das n celulas (ordem: esquerda->direita, cima->baixo) e o retangulo `spare` das celulas
 * que sobraram na ultima linha (para a classificacao); `spare` e null quando a grade esta cheia.
 */
export function splitRects(n, W, H, gap = 3) {
  const [cols, rows] = splitGrid(n);
  const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
  const cell = (i) => ({ x: (i % cols) * (cw + gap), y: Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
  const rects = [];
  for (let i = 0; i < Math.max(1, n); i++) rects.push(cell(i));
  const total = cols * rows;
  let spare = null;
  if (n >= 1 && n < total) {
    const first = cell(n), last = cell(total - 1);
    // a sobra ocupa o resto da ultima linha (as celulas livres ficam sempre juntas, no fim)
    spare = { x: first.x, y: first.y, w: last.x + last.w - first.x, h: first.h };
  }
  return { cols, rows, rects, spare };
}
