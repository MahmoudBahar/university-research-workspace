import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface TreeProps<T> {
  nodes: T[];
  getId: (node: T) => string;
  getChildren: (node: T) => T[];
  getLabel: (node: T) => string;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Hide nodes for which this returns false (their subtrees included). */
  visible?: (node: T) => boolean;
  highlightId?: string | null;
  renderRow: (node: T, context: { depth: number; hasChildren: boolean; expanded: boolean }) => ReactNode;
}

/**
 * A collapsible tree. Each row is a `.node` element and its children live in a
 * sibling container, never inside the row, so `.tree .node` selectors match one
 * unit at a time. Collapsed children are zero height and inert.
 */
export function Tree<T>(props: TreeProps<T>) {
  return <ul className="tree">{renderLevel(props, props.nodes, 0)}</ul>;
}

function renderLevel<T>(props: TreeProps<T>, nodes: T[], depth: number): ReactNode {
  return nodes.map((node) => {
    if (props.visible && !props.visible(node)) return null;
    const id = props.getId(node);
    const children = props.getChildren(node);
    const hasChildren = children.length > 0;
    const open = hasChildren && props.expanded.has(id);
    const label = props.getLabel(node);
    const childrenId = `tree-children-${id}`;
    return (
      <li key={id}>
        <div className="node" data-depth={depth} data-highlight={props.highlightId === id ? 'true' : undefined} id={`tree-node-${id}`}>
          {hasChildren ? (
            <button
              type="button"
              className="tree-toggle"
              aria-expanded={open}
              aria-controls={childrenId}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
              onClick={() => props.onToggle(id)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          ) : (
            <span className="tree-toggle-spacer" aria-hidden="true" />
          )}
          {props.renderRow(node, { depth, hasChildren, expanded: open })}
        </div>
        {hasChildren ? (
          <div className="tree-children" id={childrenId} data-open={open ? 'true' : 'false'} inert={!open} aria-hidden={!open}>
            <div>
              <ul>{renderLevel(props, children, depth + 1)}</ul>
            </div>
          </div>
        ) : null}
      </li>
    );
  });
}

/** Ids of every node down to `maxDepth` (inclusive); all of them when omitted. */
export function collectIds<T>(nodes: T[], getId: (node: T) => string, getChildren: (node: T) => T[], maxDepth = Number.POSITIVE_INFINITY, depth = 0): string[] {
  if (depth > maxDepth) return [];
  return nodes.flatMap((node) => [getId(node), ...collectIds(getChildren(node), getId, getChildren, maxDepth, depth + 1)]);
}

/** Ids of every ancestor of any node in `matchIds`. */
export function ancestorsOf<T>(nodes: T[], getId: (node: T) => string, getChildren: (node: T) => T[], matchIds: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  const walk = (node: T, path: string[]): void => {
    const id = getId(node);
    if (matchIds.has(id)) for (const ancestor of path) result.add(ancestor);
    for (const child of getChildren(node)) walk(child, [...path, id]);
  };
  for (const node of nodes) walk(node, []);
  return result;
}

/** Ids of nodes that match or have a matching descendant. */
export function subtreeMatches<T>(nodes: T[], getId: (node: T) => string, getChildren: (node: T) => T[], matchIds: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  const walk = (node: T): boolean => {
    const id = getId(node);
    let hit = matchIds.has(id);
    for (const child of getChildren(node)) if (walk(child)) hit = true;
    if (hit) result.add(id);
    return hit;
  };
  for (const node of nodes) walk(node);
  return result;
}
