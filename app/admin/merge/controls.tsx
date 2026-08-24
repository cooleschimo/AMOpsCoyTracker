'use client';
import { useState } from 'react';

export function MergeControls(props: {
  entityType: 'person' | 'company' | 'organization';
  leftId: number; rightId: number; signals: string[]; score: number;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function send(decision: 'merged' | 'distinct' | 'unsure', keptId: number, mergedId: number) {
    setState('saving');
    const res = await fetch('/api/admin/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: props.entityType, keptId, mergedId, decision,
        signals: props.signals, score: props.score,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setState('done'); setMsg(decision === 'merged' ? `merged · ${j.repointed ?? 0} edges repointed` : decision); }
    else { setState('error'); setMsg(j.error ?? 'failed'); }
  }

  if (state === 'done') return <p style={{ fontSize: 12, color: '#0a7', marginTop: 10 }}>✓ {msg}</p>;

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <button disabled={state === 'saving'} onClick={() => send('merged', props.leftId, props.rightId)} style={btn('#0a7')}>
        Same — keep #{props.leftId}
      </button>
      <button disabled={state === 'saving'} onClick={() => send('merged', props.rightId, props.leftId)} style={btn('#0a7')}>
        Same — keep #{props.rightId}
      </button>
      <button disabled={state === 'saving'} onClick={() => send('distinct', props.leftId, props.rightId)} style={btn('#555')}>
        Different
      </button>
      <button disabled={state === 'saving'} onClick={() => send('unsure', props.leftId, props.rightId)} style={btn('#999')}>
        Not sure
      </button>
      {state === 'error' && <span style={{ fontSize: 12, color: '#c00' }}>{msg}</span>}
    </div>
  );
}

const btn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#fff', border: 0, borderRadius: 6,
  padding: '6px 11px', fontSize: 12, cursor: 'pointer',
});
