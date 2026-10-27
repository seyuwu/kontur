import { Fragment } from "react";

function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>)}</>;
}
/** Render text as React nodes, never as HTML supplied by the provider. */
export function SummaryText({ text }: { text: string }) {
  return <div className="summary-text">{text.split(/\n\s*\n/).filter(part => part.trim()).map((block, i) => {
    const lines = block.trim().split("\n");
    if (lines.every(line => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) return <ul key={i}>{lines.map((line, j) => <li key={j}><Inline text={line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")} /></li>)}</ul>;
    return <p key={i}>{lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={line.replace(/^#{1,4}\s+/, "")} /></Fragment>)}</p>;
  })}</div>;
}
