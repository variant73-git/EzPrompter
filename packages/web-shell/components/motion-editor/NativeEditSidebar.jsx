'use client';

import { useMemo, useState } from 'react';
import { Box, Image as ImageIcon, Layers3, PanelTop } from 'lucide-react';
import { AssetsPanel } from './NativeMotionEditor.jsx';
import styles from './native-motion-canvas.module.css';

const TABS = [
  { id: 'layers', label: 'Layers', Icon: Layers3 },
  { id: 'sections', label: 'Sections', Icon: PanelTop },
  { id: 'assets', label: 'Assets', Icon: ImageIcon },
];

function LayerList({ rows, selectedRowId, onSelect, emptyCopy }) {
  if (!rows.length) return <p className={styles.emptyState}>{emptyCopy}</p>;
  return (
    <div className={styles.layerList}>
      {rows.map((row) => (
        <button
          key={row.elementId}
          type="button"
          className={styles.layerButton}
          data-selected={selectedRowId === row.elementId}
          aria-label={`${row.label || 'Website element'}, ${row.kind || 'element'}, ${row.count || 0} motion${row.count === 1 ? '' : 's'}`}
          onClick={() => onSelect(row.elementId)}
        >
          <Box aria-hidden="true" />
          <span>{row.label || 'Website element'}</span>
          <small>{row.count || 0}</small>
        </button>
      ))}
    </div>
  );
}

export default function NativeEditSidebar({ controller, initialTab = 'layers' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const rows = controller?.viewportRows || [];
  const sectionRows = useMemo(
    () => rows.filter((row) => row.kind === 'container' || row.kind === 'section'),
    [rows],
  );
  const panelId = `native-edit-sidebar-${activeTab}`;

  return (
    <aside className={styles.sidebar} aria-label="Website editing sidebar">
      <div className={styles.panelTabs} role="tablist" aria-label="Website structure">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            id={`native-edit-sidebar-tab-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`native-edit-sidebar-${id}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        id={panelId}
        className={styles.tabPanel}
        role="tabpanel"
        aria-labelledby={`native-edit-sidebar-tab-${activeTab}`}
      >
        {activeTab === 'layers' && (
          <LayerList
            rows={rows}
            selectedRowId={controller?.selectedRowId}
            onSelect={controller.commands.focusElement}
            emptyCopy="Animated layers will appear here as the website becomes ready."
          />
        )}
        {activeTab === 'sections' && (
          <LayerList
            rows={sectionRows}
            selectedRowId={controller?.selectedRowId}
            onSelect={controller.commands.focusElement}
            emptyCopy="No animated sections are available in this view."
          />
        )}
        {activeTab === 'assets' && (
          <AssetsPanel
            assets={controller?.runtime?.assets || []}
            onSelect={controller.commands.selectElement}
            onReplace={controller.commands.replaceAsset}
          />
        )}
      </div>
    </aside>
  );
}
