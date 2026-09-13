"use client";

/**
 * The transparency log, drawn as the tree it actually is.
 *
 * Correctness note. RFC 6962 trees are NOT balanced binary trees for sizes that
 * are not powers of two: the tree splits at the largest power of two strictly
 * below n, so the left subtree is always perfect and the right one is whatever
 * remains. Drawing a tidy balanced tree instead would be a prettier picture of
 * a structure that does not exist, and the audit path drawn on it would be
 * wrong. So the layout below recurses exactly the way the SDK's merkle.ts does.
 *
 * The audit path highlight is the point of the drawing: it shows that proving
 * one leaf belongs to the tree costs log2(n) hashes, not the whole log - which
 * is why a verifier can check membership without being handed every record.
 */

import { motion } from "motion/react";

interface Node {
  /** Leaf index, or null for an internal node. */
  leaf: number | null;
  left?: Node;
  right?: Node;
  x: number;
  depth: number;
  /** Leaf range this node covers, used to find the audit path. */
  from: number;
  to: number;
}

/** Largest power of two strictly below n — the RFC 6962 split point. */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function build(from: number, to: number, depth: number): Node {
  const n = to - from;
  if (n === 1) {
    return { leaf: from, x: 0, depth, from, to };
  }
  const k = splitPoint(n);
  const left = build(from, from + k, depth + 1);
  const right = build(from + k, to, depth + 1);
  return { leaf: null, left, right, x: 0, depth, from, to };
}

/** Assign x positions by in-order traversal of the leaves. */
function layout(node: Node, cursor: { next: number }): void {
  if (node.leaf !== null) {
    node.x = cursor.next++;
    return;
  }
  layout(node.left as Node, cursor);
  layout(node.right as Node, cursor);
  node.x = ((node.left as Node).x + (node.right as Node).x) / 2;
}

function flatten(node: Node, out: Node[]): Node[] {
  out.push(node);
  if (node.left) flatten(node.left, out);
  if (node.right) flatten(node.right, out);
  return out;
}

/**
 * The sibling nodes an inclusion proof for `leaf` consists of — the nodes a
 * verifier is given, and the only ones they need.
 */
function auditPath(node: Node, leaf: number, acc: Node[]): Node[] {
  if (node.leaf !== null) return acc;
  const left = node.left as Node;
  const right = node.right as Node;
  if (leaf < left.to) {
    acc.push(right);
    return auditPath(left, leaf, acc);
  }
  acc.push(left);
  return auditPath(right, leaf, acc);
}

export function MerkleTree({
  size,
  highlight,
  onSelect,
}: {
  size: number;
  highlight: number | null;
  onSelect?: (leaf: number) => void;
}) {
  if (size < 1) {
    return <p className="note">The log is empty — seal a receipt and the tree appears here.</p>;
  }

  const root = build(0, size, 0);
  layout(root, { next: 0 });
  const nodes = flatten(root, []);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  const path = highlight !== null && highlight < size ? auditPath(root, highlight, []) : [];
  const pathSet = new Set(path);

  // Nodes on the route from the highlighted leaf to the root — what the
  // verifier recomputes, as distinct from what it is given.
  const climbed = new Set<Node>();
  if (highlight !== null && highlight < size) {
    let cursor: Node | undefined = root;
    while (cursor) {
      climbed.add(cursor);
      if (cursor.leaf !== null) break;
      const left = cursor.left as Node;
      cursor = highlight < left.to ? left : (cursor.right as Node);
    }
  }

  const colWidth = 42;
  const rowHeight = 54;
  const padding = 26;
  const width = Math.max(size * colWidth + padding * 2, 320);
  const height = (maxDepth + 1) * rowHeight + padding * 2;

  const px = (n: Node) => padding + n.x * colWidth + colWidth / 2;
  const py = (n: Node) => padding + n.depth * rowHeight;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Merkle tree of ${size} leaves${highlight !== null ? `, leaf ${highlight} highlighted` : ""}`}
        >
          {/* edges */}
          {nodes
            .filter((n) => n.leaf === null)
            .flatMap((n) => [n.left as Node, n.right as Node].map((child) => ({ n, child })))
            .map(({ n, child }, index) => {
              const onRoute = climbed.has(n) && climbed.has(child);
              return (
                <motion.line
                  key={`e-${index}`}
                  x1={px(n)}
                  y1={py(n)}
                  x2={px(child)}
                  y2={py(child)}
                  stroke={onRoute ? "var(--primary)" : "var(--border)"}
                  strokeWidth={onRoute ? 2 : 1}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.35, delay: n.depth * 0.05 }}
                />
              );
            })}

          {/* nodes */}
          {nodes.map((n, index) => {
            const isHighlightLeaf = n.leaf !== null && n.leaf === highlight;
            const isProofNode = pathSet.has(n);
            const isRoot = n.depth === 0;
            const fill = isHighlightLeaf
              ? "var(--primary)"
              : isProofNode
                ? "var(--warn)"
                : isRoot
                  ? "var(--pass)"
                  : "var(--bg-raised)";
            const stroke = isHighlightLeaf
              ? "var(--primary)"
              : isProofNode
                ? "var(--warn)"
                : isRoot
                  ? "var(--pass)"
                  : "var(--border)";
            return (
              <motion.g
                key={`n-${index}`}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, delay: n.depth * 0.05 }}
                style={{ cursor: n.leaf !== null && onSelect ? "pointer" : "default" }}
                onClick={() => n.leaf !== null && onSelect?.(n.leaf)}
              >
                <circle
                  cx={px(n)}
                  cy={py(n)}
                  r={n.leaf !== null ? 9 : 7}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.5}
                />
                {n.leaf !== null && (
                  <text
                    x={px(n)}
                    y={py(n) + 22}
                    textAnchor="middle"
                    fontSize={9}
                    fill={isHighlightLeaf ? "var(--primary)" : "var(--text-faint)"}
                    fontFamily="var(--mono)"
                  >
                    {n.leaf}
                  </text>
                )}
              </motion.g>
            );
          })}
        </svg>
      </div>

      <div className="row" style={{ gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        <Legend color="var(--pass)" label="root (signed tree head)" />
        <Legend color="var(--primary)" label="your leaf" />
        <Legend color="var(--warn)" label={`audit path — ${path.length} hash${path.length === 1 ? "" : "es"}`} />
      </div>

      {highlight !== null && (
        <p className="note" style={{ marginTop: 10 }}>
          Proving leaf <strong>#{highlight}</strong> belongs to a tree of {size} takes{" "}
          <strong>{path.length}</strong> sibling hash{path.length === 1 ? "" : "es"} — not the other{" "}
          {size - 1} records. That is why a verifier can check membership without being handed the
          whole log, and why the log can be public without the records being.
        </p>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="note" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
