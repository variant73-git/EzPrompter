import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKFLOWS, layoutWorkflowNodes, savedWorkflowToTemplate } from './workflow-templates.js';

describe('workflow templates', () => {
  it('keeps the five primary entry workflows first and fully connected', () => {
    const primary = BUILTIN_WORKFLOWS.filter((workflow) => workflow.primary);
    expect(primary.map((workflow) => workflow.id)).toEqual([
      'builder',
      'clone',
      'style-website',
      'style-screenshot',
      'multiple-references',
    ]);
    for (const workflow of primary) {
      const keys = new Set(workflow.nodes.map((node) => node.key));
      expect(workflow.edges.every((edge) => keys.has(edge.from) && keys.has(edge.to))).toBe(true);
    }
  });

  it('lays dependency columns apart without overwriting explicit saved geometry', () => {
    const planned = layoutWorkflowNodes(BUILTIN_WORKFLOWS[2].nodes);
    const byKey = new Map(planned.map((node) => [node.key, node]));
    expect(byKey.get('tokens').posX).toBeGreaterThan(byKey.get('reference').posX + byKey.get('reference').width);
    expect(byKey.get('result').posX).toBeGreaterThan(byKey.get('tokens').posX + byKey.get('tokens').width);

    const saved = layoutWorkflowNodes([{ key: 'a', kind: 'prompt', posX: 711, posY: 933, width: 300, height: 220 }]);
    expect(saved[0]).toMatchObject({ posX: 711, posY: 933, width: 300, height: 220 });
  });

  it('adapts persisted definitions into launchable user templates', () => {
    const workflow = savedWorkflowToTemplate({
      id: 'w1',
      name: 'My chain',
      definition: { nodes: [{ key: 'a', kind: 'site' }], edges: [] },
    });
    expect(workflow).toMatchObject({ id: 'saved-w1', name: 'My chain', saved: true });
    expect(workflow.nodes).toHaveLength(1);
  });
});
