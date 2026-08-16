'use client';

/**
 * Menu de contexto — a ferramenta tem que parecer software, não site.
 *
 * Regra do produto (Adilson, 2026-08-13): botão direito em QUALQUER lugar do
 * editor e do canvas abre um menu, por menor que seja. Área de painel sem dados
 * não abre menu nenhum, mas também não deixa o menu do navegador aparecer.
 *
 * Este componente não decide o QUE mostrar — só desenha e posiciona. Quem chama
 * monta os itens a partir do alvo do clique.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './native-motion-editor.module.css';

export function ContextMenu({ x, y, items = [], onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Encosta no canto: um menu aberto perto da borda não pode sair da tela nem
  // gerar barra de rolagem.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margem = 8;
    setPos({
      left: Math.max(margem, Math.min(x, window.innerWidth - width - margem)),
      top: Math.max(margem, Math.min(y, window.innerHeight - height - margem)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const fecharPorTecla = (e) => { if (e.key === 'Escape') onClose?.(); };
    const fecharPorClique = (e) => { if (!ref.current?.contains(e.target)) onClose?.(); };
    // ⚠️ Escuta `pointerdown`, NÃO `mousedown`. A timeline chama
    // `preventDefault()` no `pointerdown` dela para arrastar sem selecionar
    // texto — e isso SUPRIME o `mousedown` de compatibilidade que viria depois.
    // Com `mousedown`, clicar numa faixa da timeline não fechava o menu:
    // reproduzido com o clique 200px à esquerda do menu, sobre `rowTrack`.
    // `capture` para rodar antes de qualquer handler da página consumir o evento.
    document.addEventListener('keydown', fecharPorTecla);
    document.addEventListener('pointerdown', fecharPorClique, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', fecharPorTecla);
      document.removeEventListener('pointerdown', fecharPorClique, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (!items.length) return null;

  return (
    <div
      ref={ref}
      className={styles.contextMenu}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      // O menu não pode disparar outro menu por cima de si mesmo.
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((item, i) => (item.separator ? (
        <div key={`sep-${i}`} className={styles.contextMenuSeparator} role="separator" />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={styles.contextMenuItem}
          disabled={item.disabled}
          onClick={() => { item.onSelect?.(); onClose?.(); }}
        >
          <span>{item.label}</span>
          {item.hint ? <span className={styles.contextMenuHint}>{item.hint}</span> : null}
        </button>
      )))}
    </div>
  );
}

/**
 * Estado do menu + o handler de `contextmenu`.
 *
 * `montarItens(alvo, evento)` devolve a lista de itens, ou `[]` para "área sem
 * dados": nesse caso o menu do navegador continua bloqueado e nada aparece —
 * que é exatamente o pedido.
 */
export function useContextMenu(montarItens) {
  const [menu, setMenu] = useState(null);
  const aoAbrir = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const itens = montarItens(event.target, event) || [];
    setMenu(itens.length ? { x: event.clientX, y: event.clientY, items: itens } : null);
  };
  return { menu, aoAbrir, fechar: () => setMenu(null) };
}
