// Divide um arquivo .sql nos comandos que serao enviados ao banco.
//
// Dividir por ponto e virgula cru nao serve: um bloco `DO $$ ... END $$` tem
// ponto e virgula DENTRO, e parti-lo entrega pedacos invalidos ao banco. E' por
// isso que as migracoes com blocos condicionais (as que acrescentam constraint
// so se ela ainda nao existir) nunca puderam ser aplicadas pelo caminho antigo.
//
// Reconhece: comentario de linha (--), comentario de bloco, texto entre aspas
// simples (com '' interno), identificador entre aspas duplas, e texto delimitado
// por cifrao, com ou sem etiqueta ($$ ou $etiqueta$).
export function splitSqlStatements(sqlText) {
  const texto = String(sqlText || '');
  const comandos = [];
  let atual = '';
  let i = 0;

  while (i < texto.length) {
    const dois = texto.slice(i, i + 2);

    if (dois === '--') {
      const fim = texto.indexOf('\n', i);
      i = fim === -1 ? texto.length : fim + 1;
      atual += ' ';
      continue;
    }
    if (dois === '/*') {
      const fim = texto.indexOf('*/', i + 2);
      i = fim === -1 ? texto.length : fim + 2;
      atual += ' ';
      continue;
    }
    if (texto[i] === "'" || texto[i] === '"') {
      const aspa = texto[i];
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === aspa) {
          if (texto[j + 1] === aspa) { j += 2; continue; } // aspa escapada
          j += 1;
          break;
        }
        j += 1;
      }
      atual += texto.slice(i, j);
      i = j;
      continue;
    }
    if (texto[i] === '$') {
      const etiqueta = texto.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (etiqueta) {
        const marca = etiqueta[0];
        const fim = texto.indexOf(marca, i + marca.length);
        const ate = fim === -1 ? texto.length : fim + marca.length;
        atual += texto.slice(i, ate);
        i = ate;
        continue;
      }
    }
    if (texto[i] === ';') {
      const limpo = atual.trim();
      if (limpo) comandos.push(limpo);
      atual = '';
      i += 1;
      continue;
    }
    atual += texto[i];
    i += 1;
  }

  const resto = atual.trim();
  if (resto) comandos.push(resto);
  return comandos;
}
