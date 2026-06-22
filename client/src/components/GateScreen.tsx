import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { verifyAccess } from '../lib/api';

export function GateScreen({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    const r = await verifyAccess(code.trim());
    setBusy(false);
    if (r.ok) { onUnlock(); return; }
    setError(r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Incorrect passphrase.');
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#09090b]">
      <form onSubmit={submit} className="flex flex-col items-center gap-6 w-[320px]">
        <div className="w-16 h-16 rounded-[20px] flex items-center justify-center
                        bg-gradient-to-br from-indigo-600 via-violet-600 to-violet-700
                        shadow-[0_0_50px_rgba(139,92,246,0.45)]">
          <Lock size={26} className="text-white" strokeWidth={1.5} />
        </div>
        <p className="text-white text-sm font-semibold tracking-[0.35em] uppercase select-none">StreamBox</p>
        <input
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); if (error) setError(''); }}
          placeholder="Enter passphrase"
          autoFocus
          className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-white
                     placeholder-zinc-500 outline-none focus:border-violet-500"
        />
        {error && <p className="text-red-400 text-xs -mt-3 self-start">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50
                     text-white py-3 text-sm font-medium transition-colors"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
