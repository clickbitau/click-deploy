'use client';

// ============================================================
// Click-Deploy — Shared SMTP Configuration Form
// ============================================================
// Used in:
//   - Settings → Integrations → SMTP / Email
//   - Notifications → SMTP Settings tab
// ============================================================

import { useState, useEffect } from 'react';
import { Mail, Loader2, Save, CheckCircle, Zap } from 'lucide-react';
import { trpc } from '@/lib/trpc';

// ── Provider presets ─────────────────────────────────────────
const PROVIDERS = [
  { id: 'gmail',    label: 'Gmail',       host: 'smtp.gmail.com',          port: '587' },
  { id: 'sendgrid', label: 'SendGrid',    host: 'smtp.sendgrid.net',       port: '587' },
  { id: 'ses',      label: 'AWS SES',     host: 'email-smtp.us-east-1.amazonaws.com', port: '587' },
  { id: 'resend',   label: 'Resend',      host: 'smtp.resend.com',         port: '465' },
  { id: 'mailgun',  label: 'Mailgun',     host: 'smtp.mailgun.org',        port: '587' },
  { id: 'custom',   label: 'Custom',      host: '',                         port: '587' },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

export function SmtpConfigForm() {
  const smtpQuery = trpc.system.getSmtp.useQuery(undefined, { retry: 1 });
  const saveSmtp  = trpc.system.saveSmtp.useMutation();
  const testSmtp  = trpc.system.testSmtp.useMutation();

  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('custom');
  const [host, setHost]       = useState('');
  const [port, setPort]       = useState('587');
  const [user, setUser]       = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom]       = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Populate form from saved settings
  useEffect(() => {
    if (smtpQuery.data) {
      setHost(smtpQuery.data.host);
      setPort(smtpQuery.data.port);
      setUser(smtpQuery.data.user);
      setFrom(smtpQuery.data.from);
      // Try to detect provider from host
      const matched = PROVIDERS.find(p => p.host === smtpQuery.data!.host);
      if (matched) setSelectedProvider(matched.id);
    }
  }, [smtpQuery.data]);

  const handleProviderSelect = (providerId: ProviderId) => {
    setSelectedProvider(providerId);
    const p = PROVIDERS.find(x => x.id === providerId)!;
    if (p.host) setHost(p.host);
    if (p.port) setPort(p.port);
  };

  const handleSave = () => {
    setTestResult(null);
    saveSmtp.mutate({ host, port, user, password, from }, {
      onSuccess: () => smtpQuery.refetch(),
    });
  };

  const handleTest = () => {
    setTestResult(null);
    testSmtp.mutate({ host, port, user, password, from }, {
      onSuccess: (res) => setTestResult(res),
      onError: (err) => setTestResult({ success: false, error: err.message }),
    });
  };

  const isConfigured = !!smtpQuery.data?.configured;
  const canSubmit    = !!(host && user && password);

  return (
    <div className="space-y-5">
      {/* Configured Banner */}
      {isConfigured && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          <span>SMTP is configured — deployment email alerts are active</span>
        </div>
      )}

      {/* Provider Quick-Select */}
      <div>
        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Provider</p>
        <div className="grid grid-cols-3 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderSelect(p.id)}
              className={`px-3 py-2 rounded-lg border text-[11px] font-medium transition-all ${
                selectedProvider === p.id
                  ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                  : 'bg-white/[0.02] border-white/[0.06] text-white/40 hover:border-white/10 hover:text-white/60'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {selectedProvider === 'gmail' && (
          <p className="text-[10px] text-amber-400/70 mt-2 leading-relaxed">
            💡 Gmail requires an <strong>App Password</strong> (not your account password). 
            Enable 2FA then visit <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="underline">myaccount.google.com/apppasswords</a>
          </p>
        )}
        {selectedProvider === 'ses' && (
          <p className="text-[10px] text-amber-400/70 mt-2 leading-relaxed">
            💡 AWS SES requires <strong>SMTP credentials</strong> (separate from IAM keys). 
            Generate them in the SES console under <strong>SMTP Settings</strong>.
            The endpoint varies by region — update the host to match your SES region.
          </p>
        )}
        {selectedProvider === 'resend' && (
          <p className="text-[10px] text-amber-400/70 mt-2 leading-relaxed">
            💡 Resend SMTP: use <code className="text-brand-300">resend</code> as the username and your API key as the password.
          </p>
        )}
      </div>

      {/* Form Fields */}
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <div>
          <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">SMTP Host</label>
          <input
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="smtp.gmail.com"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none transition-colors"
          />
        </div>
        <div>
          <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Port</label>
          <input
            value={port}
            onChange={e => setPort(e.target.value)}
            placeholder="587"
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none transition-colors"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Username / Email</label>
        <input
          value={user}
          onChange={e => setUser(e.target.value)}
          placeholder="you@gmail.com"
          autoComplete="username"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none transition-colors"
        />
      </div>

      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">
          Password / App Password
          {isConfigured && <span className="ml-2 text-white/20">(leave blank to keep existing)</span>}
        </label>
        <input
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={isConfigured ? '••••••••  (saved)' : 'Enter password'}
          type="password"
          autoComplete="current-password"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none transition-colors"
        />
      </div>

      <div>
        <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">From Address <span className="text-white/20">(optional — defaults to username)</span></label>
        <input
          value={from}
          onChange={e => setFrom(e.target.value)}
          placeholder="noreply@yourdomain.com"
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/20 focus:border-brand-500/50 outline-none transition-colors"
        />
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`text-xs px-3 py-2.5 rounded-lg border ${
          testResult.success
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {testResult.success ? '✓ Test email sent successfully!' : `✗ ${testResult.error}`}
        </div>
      )}

      {/* Save error */}
      {saveSmtp.isError && (
        <div className="text-xs px-3 py-2.5 rounded-lg border bg-red-500/10 border-red-500/20 text-red-400">
          ✗ {saveSmtp.error?.message}
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={!canSubmit || testSmtp.isPending}
          className="px-4 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {testSmtp.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Zap className="w-3.5 h-3.5" />}
          {testSmtp.isPending ? 'Sending...' : 'Send Test Email'}
        </button>
        <button
          onClick={handleSave}
          disabled={!canSubmit || saveSmtp.isPending}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {saveSmtp.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Save className="w-3.5 h-3.5" />}
          {saveSmtp.isPending ? 'Saving...' : 'Save SMTP Settings'}
        </button>
      </div>
    </div>
  );
}
