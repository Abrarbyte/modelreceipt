"use client";

/**
 * A small, safe Markdown renderer for model output.
 *
 * Model replies arrive as Markdown — `**bold**`, lists, fenced code — and
 * printing them raw made the product look broken. The obvious fixes are both
 * worse than this one: `dangerouslySetInnerHTML` would let model output inject
 * markup into a page about trustworthy evidence, and a full Markdown library is
 * a lot of bundle for the handful of constructs an assistant actually emits.
 *
 * So this parses to React nodes and never to HTML. Nothing here can produce an
 * element the code below does not explicitly create, which makes injection
 * structurally impossible rather than filtered.
 */

import { Fragment, type ReactNode } from "react";

/** Inline: **bold**, *italic*, `code`, [text](url). */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // One pass, alternation ordered so ** is matched before *.
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="md-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        const href = linkMatch[2];
        // Only http(s) and mailto become links; anything else renders as text,
        // so a model cannot emit a javascript: URL into the page.
        const safe = /^(https?:|mailto:)/i.test(href);
        nodes.push(
          safe ? (
            <a key={key} href={href} target="_blank" rel="noreferrer noopener">
              {linkMatch[1]}
            </a>
          ) : (
            <Fragment key={key}>{linkMatch[1]}</Fragment>
          ),
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p${key++}`} className="md-p">
        {inline(text, `p${key}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => (
      <li key={`li${index}`}>{inline(item, `l${key}-${index}`)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`ol${key++}`} className="md-list">
          {items}
        </ol>
      ) : (
        <ul key={`ul${key++}`} className="md-list">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const line of lines) {
    // fenced code
    if (/^\s*```/.test(line)) {
      if (fence) {
        blocks.push(
          <pre key={`pre${key++}`} className="md-pre">
            {fence.lines.join("\n")}
          </pre>,
        );
        fence = null;
      } else {
        flushParagraph();
        flushList();
        fence = { lang: line.replace(/^\s*```/, "").trim(), lines: [] };
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }

    // headings
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <div key={`h${key++}`} className="md-h">
          {inline(heading[2], `h${key}`)}
        </div>,
      );
      continue;
    }

    // list items
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const content = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(content);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  // An unterminated fence still renders — truncated output should not vanish.
  if (fence) {
    blocks.push(
      <pre key={`pre${key++}`} className="md-pre">
        {fence.lines.join("\n")}
      </pre>,
    );
  }
  flushParagraph();
  flushList();

  return <div className="md">{blocks}</div>;
}
