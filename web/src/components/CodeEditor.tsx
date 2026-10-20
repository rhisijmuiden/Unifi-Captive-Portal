import { html } from '@codemirror/lang-html';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', height: '100%', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'var(--surface-sunken)', color: 'var(--ink-muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--koraal) 8%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--koraal)' },
});

/** HTML editor with syntax highlighting (CodeMirror 6). */
export function CodeEditor({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    view.current = new EditorView({
      doc: value,
      parent: host.current!,
      extensions: [basicSetup, html(), theme, EditorView.lineWrapping, EditorView.updateListener.of((u) => u.docChanged && changeRef.current(u.state.doc.toString()))],
    });
    if (label) view.current.contentDOM.setAttribute('aria-label', label);
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside changes (e.g. "fill from visual design") replace the document
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-[560px] overflow-hidden rounded-xl border border-line" />;
}
