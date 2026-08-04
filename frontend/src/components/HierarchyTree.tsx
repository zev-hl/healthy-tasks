import type { OrgHierarchyNode } from '@healthy-tasks/shared';
import { userLabel } from './ui/Avatar';

/**
 * Reusable Team Hierarchy picker (shared by the Tasks list and the Due Date
 * Performance report). Selecting a supervisor toggles their whole downline as a
 * block; individuals within stay individually toggleable. Selection is held by
 * the parent as a Set of user ids; this component is purely presentational.
 */

/** Push a node's id plus every descendant's id into `into` (inclusive). */
export function collectSubtree(node: OrgHierarchyNode, into: string[]): void {
  into.push(node.user.id);
  for (const c of node.children) collectSubtree(c, into);
}

/**
 * The next selection Set after toggling `node`: if the node is currently
 * unselected, its whole subtree is added; otherwise the whole subtree is removed.
 * Pure — returns a new Set, never mutates `prev`.
 */
export function toggleSubtree(prev: Set<string>, node: OrgHierarchyNode): Set<string> {
  const subtree: string[] = [];
  collectSubtree(node, subtree);
  const next = new Set(prev);
  const turningOn = !next.has(node.user.id);
  for (const id of subtree) {
    if (turningOn) next.add(id);
    else next.delete(id);
  }
  return next;
}

function HierarchyRow({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: OrgHierarchyNode;
  depth: number;
  selected: Set<string>;
  onToggle: (n: OrgHierarchyNode) => void;
}) {
  return (
    <li>
      <label className="hierarchy-row" style={{ paddingLeft: `${depth * 18}px` }}>
        <input type="checkbox" checked={selected.has(node.user.id)} onChange={() => onToggle(node)} />
        <span>{userLabel(node.user)}</span>
        {node.user.title && <span className="muted"> · {node.user.title}</span>}
      </label>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <HierarchyRow key={c.user.id} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function HierarchyTree({
  nodes,
  selected,
  onToggle,
}: {
  nodes: OrgHierarchyNode[];
  selected: Set<string>;
  onToggle: (n: OrgHierarchyNode) => void;
}) {
  if (nodes.length === 0) return <p className="muted">No team members.</p>;
  return (
    <ul className="hierarchy-tree">
      {nodes.map((n) => (
        <HierarchyRow key={n.user.id} node={n} depth={0} selected={selected} onToggle={onToggle} />
      ))}
    </ul>
  );
}
