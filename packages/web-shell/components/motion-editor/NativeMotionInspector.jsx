'use client';

import { useEffect, useState } from 'react';
import { Code2 } from 'lucide-react';
import {
  CodePanel,
  MotionPanel,
  PropertiesPanel,
} from './NativeMotionEditor.jsx';
import CustomControlsSection from './CustomControlsSection.jsx';
import MotionOwnershipChoice from './MotionOwnershipChoice.jsx';
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
  const selectionLoop = activeTab === 'motion'
    && controller?.selectionSettlement?.status === 'settled'
    && controller.selectionSettlement.elementId === selected?.id
    && controller.selectionSettlement.loop === true;

  function selectTab(tab) {
    if (!controlledTab) setLocalTab(tab);
    onActiveTabChange?.(tab);
    if (tab === 'motion') onMotionOpen?.();
  }

  useEffect(() => {
    if (!controller?.ownershipConflict?.requestId) return;
    selectTab('motion');
  }, [controller?.ownershipConflict?.requestId]);

  return (
    <aside className={styles.inspector} aria-label="Native website inspector">
      <div className={styles.selectionHeader}>
        <span className={styles.selectionGlyph}><Code2 aria-hidden="true" /></span>
        <span className={styles.selectionCopy}>
          <strong>{selected?.label || 'Nothing selected'}</strong>
          <small>{selected ? `${selected.tag}${selected.classes?.[0] ? `.${selected.classes[0]}` : ''}` : 'Choose an element on the website'}</small>
        </span>
        {selectionLoop && (
          <span className={styles.loopIndicator} data-motion-loop="true">Loop</span>
        )}
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
            propertyOwnership={controller.propertyOwnership}
            device={controller.device}
            responsiveScopeFor={controller.responsiveScopeFor}
            onScopeRequest={controller.commands.requestResponsiveScopeChange}
            onOwnershipOpen={(property) => {
              controller.commands.focusOwnership(property);
              selectTab('motion');
              // The indicator that was clicked unmounts with the tab switch — land
              // focus on the Motion tab so keyboard users are not dropped on body.
              document.getElementById('native-motion-inspector-tab-motion')?.focus();
            }}
            onStyle={controller.commands.applyStyle}
            onText={controller.commands.applyText}
            onAttribute={controller.commands.applyAttribute}
          />
        )}
        {activeTab === 'motion' && (
          <>
            <MotionOwnershipChoice
              conflict={controller.ownershipConflict}
              onChoose={controller.commands.chooseOwnership}
            />
            <CustomControlsSection
              controls={controller.customControls || []}
              activeMotionId={controller.activeMotionId}
              onChange={controller.commands.applyCustomControl}
              onReset={controller.commands.resetCustomControl}
            />
            <MotionPanel
              selected={selected}
              motion={controller.motion || []}
              activeMotionId={controller.activeMotionId}
              onMotion={controller.commands.applyMotion}
              onStagger={controller.commands.applyStagger}
            />
          </>
        )}
        {activeTab === 'code' && <CodePanel selected={selected} />}
      </div>
    </aside>
  );
}
