'use client';

import { useState } from 'react';
import { Code2 } from 'lucide-react';
import {
  CodePanel,
  MotionPanel,
  PropertiesPanel,
} from './NativeMotionEditor.jsx';
import styles from './native-motion-canvas.module.css';

const TABS = ['properties', 'motion', 'code'];

export default function NativeMotionInspector({
  controller,
  activeTab: controlledTab,
  onActiveTabChange,
  onMotionOpen,
}) {
  const [localTab, setLocalTab] = useState('properties');
  const activeTab = controlledTab || localTab;
  const selected = controller?.selected || null;

  function selectTab(tab) {
    if (!controlledTab) setLocalTab(tab);
    onActiveTabChange?.(tab);
    if (tab === 'motion') onMotionOpen?.();
  }

  return (
    <aside className={styles.inspector} aria-label="Native website inspector">
      <div className={styles.selectionHeader}>
        <span className={styles.selectionGlyph}><Code2 aria-hidden="true" /></span>
        <span className={styles.selectionCopy}>
          <strong>{selected?.label || 'Nothing selected'}</strong>
          <small>{selected ? `${selected.tag}${selected.classes?.[0] ? `.${selected.classes[0]}` : ''}` : 'Choose an element on the website'}</small>
        </span>
      </div>
      <div className={styles.panelTabs} role="tablist" aria-label="Inspector tabs">
        {TABS.map((tab) => {
          const label = tab[0].toUpperCase() + tab.slice(1);
          return (
            <button
              key={tab}
              type="button"
              id={`native-motion-inspector-tab-${tab}`}
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`native-motion-inspector-panel-${tab}`}
              onClick={() => selectTab(tab)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div
        id={`native-motion-inspector-panel-${activeTab}`}
        className={styles.tabPanel}
        role="tabpanel"
        aria-label={activeTab[0].toUpperCase() + activeTab.slice(1)}
        aria-labelledby={`native-motion-inspector-tab-${activeTab}`}
      >
        {activeTab === 'properties' && (
          <PropertiesPanel
            selected={selected}
            runtime={controller.runtime}
            activeMotion={controller.activeMotion}
            timelineOffset={controller.timelineOffset}
            onStyle={controller.commands.applyStyle}
            onText={controller.commands.applyText}
            onAttribute={controller.commands.applyAttribute}
          />
        )}
        {activeTab === 'motion' && (
          <MotionPanel
            selected={selected}
            motion={controller.motion || []}
            activeMotionId={controller.activeMotionId}
            onMotion={controller.commands.applyMotion}
            onStagger={controller.commands.applyStagger}
          />
        )}
        {activeTab === 'code' && <CodePanel selected={selected} />}
      </div>
    </aside>
  );
}
