/**
 * CONVENÇÃO DE ATALHO (Adilson, 2026-09-29) — "vale pra sempre que houver um atalho a
 * ser mostrado": a tecla dentro de um quadrado com 5px de canto arredondado.
 *
 * 5px não é literal: é `--radius-2xs`, que o design system já define com esse valor.
 * Usar o token mantém a convenção alinhada se o raio mudar.
 *
 * Semântica: `<kbd>` é o elemento do HTML para entrada de teclado — leitores de tela o
 * anunciam como tecla. `title` não entra aqui de propósito: quem explica o atalho é o
 * texto ao lado, e um tooltip na própria tecla competiria com ele.
 *
 * Uso:
 *   <ShortcutKey>L</ShortcutKey>
 *   <ShortcutKey keys={['⌘', 'Z']} />     // combinação: um quadrado por tecla
 */
import styles from './ShortcutKey.module.css';

export default function ShortcutKey({ children, keys = null, className = '' }) {
  const lista = Array.isArray(keys) && keys.length
    ? keys
    : [children].flat().filter((k) => k != null && k !== '');
  if (!lista.length) return null;
  return (
    <span className={`${styles.grupo} ${className}`.trim()}>
      {lista.map((tecla, i) => (
        // A tecla é a chave: uma combinação não repete a mesma tecla duas vezes, e se
        // repetir (um improvável "L L") o índice desempata.
        <kbd key={`${tecla}-${i}`} className={styles.tecla}>{String(tecla)}</kbd>
      ))}
    </span>
  );
}
