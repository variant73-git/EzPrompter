/**
 * ONDE ESTÃO AS STRINGS DENTRO DE UM JAVASCRIPT — pela gramática, não por palpite.
 *
 * O clone precisa traduzir a origem que o site MONTA em runtime: o JS concatena
 * `base + nome` e o navegador pede ao CDN, que a política de segurança bloqueia
 * — medido, 145 frames de uma sequência de rolagem morrendo assim, com os
 * arquivos já dentro do bundle.
 *
 * ⚠️ A PRIMEIRA VERSÃO DISTO ERA UM VARREDOR COM HEURÍSTICA, e caía. A barra
 * abre expressão regular ou é divisão conforme o token anterior — e a inserção
 * automática de ponto e vírgula muda essa resposta: depois de `break`, uma
 * barra na linha seguinte abre regex, e a heurística lia divisão. O resultado
 * era classificar o miolo do regex como string e traduzir dentro dele,
 * corrompendo o programa em silêncio. Nenhuma lista de palavras fecha isso
 * (achado do Sol). Aqui quem responde é o parser.
 *
 * Falha de parse deixa o arquivo INTOCADO: servir o original é sempre melhor
 * que corromper o script que faz o site se mexer.
 */
import { parse } from 'acorn';

function coletar(no, saida, visitados) {
  if (!no || typeof no !== 'object' || visitados.has(no)) return;
  visitados.add(no);
  if (Array.isArray(no)) {
    for (const item of no) coletar(item, saida, visitados);
    return;
  }
  if (typeof no.type !== 'string') return;
  // Só literal de string. Template não entra: o valor dele pode ser montado, e
  // substituir dentro mudaria o significado do que o autor escreveu.
  if (no.type === 'Literal' && typeof no.value === 'string') {
    // `start`/`end` incluem as aspas; o conteúdo é o miolo.
    saida.push({ inicio: no.start + 1, fim: no.end - 1, valor: no.value });
    return;
  }
  for (const chave of Object.keys(no)) {
    if (chave === 'loc' || chave === 'range' || chave === 'parent') continue;
    coletar(no[chave], saida, visitados);
  }
}

/**
 * @returns {{ completo: boolean, motivo: string|null, literais: Array<{inicio:number, fim:number, valor:string}> }}
 */
export function stringLiteralsDeJs(fonte) {
  const texto = String(fonte || '');
  if (!texto.trim()) return { completo: true, motivo: null, literais: [] };
  let arvore = null;
  let motivo = null;
  // Script primeiro (é o que um `<script>` sem type=module é); module depois,
  // para `import`/`export`. Um site pode ter qualquer um dos dois.
  for (const sourceType of ['script', 'module']) {
    try {
      arvore = parse(texto, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true, allowHashBang: true });
      motivo = null;
      break;
    } catch (erro) {
      motivo = `parse_falhou: ${String(erro?.message || erro).slice(0, 90)}`;
    }
  }
  if (!arvore) return { completo: false, motivo, literais: [] };
  const literais = [];
  coletar(arvore, literais, new Set());
  literais.sort((a, b) => a.inicio - b.inicio);
  return { completo: true, motivo: null, literais };
}
