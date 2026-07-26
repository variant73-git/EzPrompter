'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import NativeEditSidebar from './NativeEditSidebar.jsx';
import NativeMotionInspector from './NativeMotionInspector.jsx';
import NativeMotionTimelineDock, { hasNativeMotionContext } from './NativeMotionTimelineDock.jsx';
import { useNativeMotionController } from './useNativeMotionController.js';
import styles from './native-motion-canvas.module.css';

const NativeMotionEditContext = createContext(null);

export function nativeMotionEditShellLayout(hostWidth = 1280) {
  const width = Number(hostWidth) || 1280;
  if (width < 720) return { left: 52, right: 216, bottom: 200 };
  if (width < 900) return { left: 176, right: 224, bottom: 200 };
  return { left: 224, right: 248, bottom: 200 };
}

export function useNativeMotionEditSession() {
  return useContext(NativeMotionEditContext);
}

export function NativeMotionEditSessionProvider({ active, nodeId, children }) {
  const [activePanel, setActivePanel] = useState('properties');
  const [timelineOpen, setTimelineOpen] = useState(true);
  const controller = useNativeMotionController({ activePanel, timelineOpen });
  const hasTimeline = active && hasNativeMotionContext(controller);

  useEffect(() => {
    if (!active) return undefined;
    const body = document.body;
    let resizeFrame = null;
    const applyLayout = () => {
      const layout = nativeMotionEditShellLayout(window.innerWidth);
      body.style.setProperty('--native-motion-left-w', `${layout.left}px`);
      body.style.setProperty('--native-motion-right-w', `${layout.right}px`);
      body.style.setProperty('--native-motion-timeline-h', `${layout.bottom}px`);
      body.style.setProperty('--rb-layers-width', `${layout.left}px`);
      body.style.setProperty('--rb-insp-width', `${layout.right}px`);
    };
    const handleResize = () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(applyLayout);
    };
    body.classList.add('rb-ed-active', 'rb-ed-canvas', 'native-motion-editing');
    applyLayout();
    window.addEventListener('resize', handleResize);
    return () => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', handleResize);
      body.classList.remove('rb-ed-active', 'rb-ed-canvas', 'native-motion-editing');
      body.style.removeProperty('--native-motion-left-w');
      body.style.removeProperty('--native-motion-right-w');
      body.style.removeProperty('--native-motion-timeline-h');
      body.style.removeProperty('--rb-layers-width');
      body.style.removeProperty('--rb-insp-width');
    };
  }, [active]);

  useEffect(() => {
    if (active) return;
    controller.commands.resetSession();
    setActivePanel('properties');
    setTimelineOpen(true);
  }, [active, nodeId]);

  const value = useMemo(() => (
    active ? {
      nodeId,
      controller,
      activePanel,
      setActivePanel,
      timelineOpen,
      setTimelineOpen,
      hasTimeline,
    } : null
  ), [active, activePanel, controller, hasTimeline, nodeId, timelineOpen]);

  return (
    <NativeMotionEditContext.Provider value={value}>
      {children}
      {active && (
        <NativeMotionEditChrome
          controller={controller}
          activePanel={activePanel}
          onActivePanelChange={setActivePanel}
          timelineOpen={timelineOpen}
          onTimelineOpenChange={setTimelineOpen}
        />
      )}
    </NativeMotionEditContext.Provider>
  );
}

export function NativeMotionEditTopbarControls() {
  const session = useNativeMotionEditSession();
  if (!session) return null;
  const { controller } = session;
  const busy = controller.pendingTransactions > 0;
  return (
    <div className={styles.historyControls} role="toolbar" aria-label="Edit history">
      <button
        type="button"
        className={styles.historyButton}
        aria-label="Undo"
        disabled={!controller.canUndo || busy}
        onClick={controller.commands.undo}
      >
        <Undo2 aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.historyButton}
        aria-label="Redo"
        disabled={!controller.canRedo || busy}
        onClick={controller.commands.redo}
      >
        <Redo2 aria-hidden="true" />
      </button>
    </div>
  );
}

export default function NativeMotionEditChrome({
  controller,
  activePanel,
  onActivePanelChange,
  timelineOpen,
  onTimelineOpenChange,
}) {
  return (
    <>
      <NativeEditSidebar controller={controller} />
      <NativeMotionInspector
        controller={controller}
        activeTab={activePanel}
        onActiveTabChange={onActivePanelChange}
        onMotionOpen={() => onTimelineOpenChange(true)}
      />
      <NativeMotionTimelineDock
        controller={controller}
        open={timelineOpen}
        onOpenChange={onTimelineOpenChange}
      />
    </>
  );
}
