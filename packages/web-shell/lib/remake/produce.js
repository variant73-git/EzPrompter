/**
 * O MOTOR NOVO — reconstruir com o movimento medido.
 *
 * Nome: `remake`. Ele refaz o site nas NOSSAS regras (documento único, estilo
 * embutido, sem dependência externa) — que é o que faz o editor completo
 * funcionar em qualquer site — e, ao contrário do reconstrutor legado, devolve
 * o movimento, porque interroga a página viva em vez de olhar fotos paradas.
 *
 * O que ele soma às duas peças que já existiam:
 *   - assets REAIS (o experimento por vídeo de 2026-08-20 inventava a
 *     identidade visual justamente por não tê-los);
 *   - movimento MEDIDO (o reconstrutor legado entrega zero — medido).
 */
import { reconstructPage } from '../reconstruct.js';

export async function remakeSite(url, opts = {}) {
  return reconstructPage(url, { ...opts, comMovimento: true });
}
