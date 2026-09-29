'use client';

/**
 * CHAVES DE INTERAÇÃO DO CLONE — barra de topo do modo de edição.
 *
 * ⚠️ POR QUE AQUI E NÃO NO INSPETOR. O inspetor descreve o ELEMENTO SELECIONADO;
 * estas chaves são modo da SESSÃO — não mudam nada no elemento, mudam como o clone
 * responde ao mouse. Entre Container/Typography/Fill elas afirmariam ser propriedade
 * da seleção, e pior: desapareceriam quando nada está selecionado, que é exatamente o
 * momento em que se precisa delas (você clicou num cartão embrulhado em link e não
 * conseguiu selecionar nada). O vizinho certo é o Preview: os dois mudam como o clone
 * SE COMPORTA, não como ele parece.
 *
 * Um botão que abre um popover com as duas caixas, em vez de dois ícones novos
 * competindo na barra — e o popover dá lugar à explicação, que num ícone não cabe.
 */
import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import ShortcutKey from '../ShortcutKey.jsx';
import styles from './native-motion-editor.module.css';

export const TECLA_DE_LINK = 'L';

export default function InteractionSwitches({ interaction, linksHold, onChange, disabled = false }) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef(null);
  const botaoRef = useRef(null);

  // Fecha ao clicar fora e no Escape — padrão dos menus do canvas.
  useEffect(() => {
    if (!aberto) return undefined;
    const foraDaqui = (event) => {
      if (caixaRef.current?.contains(event.target) || botaoRef.current?.contains(event.target)) return;
      setAberto(false);
    };
    const escape = (event) => { if (event.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', foraDaqui, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', foraDaqui, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [aberto]);

  // A navegação está EFETIVAMENTE ligada pela caixa OU pela tecla segurada. O botão
  // reflete o efetivo (para o estado ser visível sem abrir), mas a CAIXA reflete só o
  // valor dela — segurar a tecla não deve fazer a caixa mentir sobre o que está salvo.
  const navegacaoEfetiva = Boolean(interaction?.links) || Boolean(linksHold);

  return (
    <div className={styles.interactionWrap}>
      <button
        ref={botaoRef}
        type="button"
        className={styles.historyButton}
        aria-label="Clone interaction"
        aria-expanded={aberto}
        aria-pressed={navegacaoEfetiva}
        data-active={navegacaoEfetiva || undefined}
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
      >
        <Link2 aria-hidden="true" />
      </button>
      {aberto && (
        <div ref={caixaRef} className={styles.interactionPopover} role="group" aria-label="Clone interaction">
          <label className={styles.interactionRow}>
            <input
              type="checkbox"
              checked={Boolean(interaction?.links)}
              onChange={(event) => onChange?.({ links: event.currentTarget.checked })}
            />
            <span className={styles.interactionLabel}>
              <span className={styles.interactionTitle}>
                Follow links
                <ShortcutKey>{TECLA_DE_LINK}</ShortcutKey>
              </span>
              <span className={styles.interactionHint}>
                While on, clicking a link opens it instead of selecting
              </span>
            </span>
          </label>
          <label className={styles.interactionRow}>
            <input
              type="checkbox"
              checked={interaction?.hover !== false}
              onChange={(event) => onChange?.({ hover: event.currentTarget.checked })}
            />
            <span className={styles.interactionLabel}>
              <span className={styles.interactionTitle}>Hover effects</span>
              <span className={styles.interactionHint}>
                Off freezes the page at rest, so you can see and measure it
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
