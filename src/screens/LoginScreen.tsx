import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, AlertTriangle, ArrowRight, RefreshCw, Ghost } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface LoginScreenProps {
  onGuest: () => void;
  onAuthSuccess: () => void;
}

type Mode = 'signin' | 'signup';
type Phase = 'form' | 'verify';

export function LoginScreen({ onGuest, onAuthSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [phase, setPhase] = useState<Phase>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resetMode, setResetMode] = useState(false);
  const verifyRefs = useRef<(HTMLInputElement | null)[]>([]);

  const passwordStrength = useCallback(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z\d]/.test(password)) score++;
    return score;
  }, [password]);

  const strengthLabel = ['', 'FRACA', 'MÉDIA', 'BOA', 'FORTE'][passwordStrength()];
  const strengthColor = passwordStrength() <= 1 ? '#ff3366' : passwordStrength() === 2 ? '#ffaa00' : '#00ff41';

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSignUp = async () => {
    setError('');
    if (!email || !password) {
      setError('PREENCHA TODOS OS CAMPOS');
      return;
    }
    if (password !== confirmPassword) {
      setError('SENHAS NÃO COINCIDEM');
      return;
    }
    if (passwordStrength() < 2) {
      setError('SENHA MUITO FRACA — USE 8+ CARACTERES COM MAIÚSCULAS, NÚMEROS E SÍMBOLOS');
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message.toUpperCase());
        return;
      }
      if (data.user) {
        await sendVerificationCode(email);
        setPhase('verify');
      }
    } catch {
      setError('FALHA AO CRIAR CONTA');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError('');
    if (!email || !password) {
      setError('PREENCHA TODOS OS CAMPOS');
      return;
    }
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message.toUpperCase());
        return;
      }
      onAuthSuccess();
    } catch {
      setError('FALHA AO ENTRAR');
    } finally {
      setLoading(false);
    }
  };

  const sendVerificationCode = async (emailAddr: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-verification-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email: emailAddr }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to send code');
    }
    setCooldown(60);
  };

  const handleResendCode = async () => {
    if (cooldown > 0) return;
    setError('');
    try {
      await sendVerificationCode(email);
    } catch (err: any) {
      setError('FALHA AO REENVIAR CÓDIGO');
    }
  };

  const handleVerifyCode = async () => {
    setError('');
    const code = verifyCode.join('');
    if (code.length !== 6) {
      setError('DIGITE OS 6 DÍGITOS');
      return;
    }

    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      const response = await fetch(`${supabaseUrl}/functions/v1/verify-email-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, code }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error || 'CÓDIGO INVÁLIDO');
        setVerifyCode(['', '', '', '', '', '']);
        verifyRefs.current[0]?.focus();
        return;
      }

      onAuthSuccess();
    } catch {
      setError('FALHA AO VERIFICAR CÓDIGO');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError('');
    if (!email) {
      setError('DIGITE SEU E-MAIL');
      return;
    }
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) {
        setError(resetError.message.toUpperCase());
        return;
      }
      setError('');
      setResetMode(false);
      setMode('signin');
      alert('LINK DE RECUPERAÇÃO ENVIADO PARA ' + email);
    } catch {
      setError('FALHA AO ENVIAR LINK');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyInput = (i: number, val: string) => {
    if (val.length > 1) {
      val = val[val.length - 1];
    }
    if (!/^\d?$/.test(val)) return;
    const next = [...verifyCode];
    next[i] = val;
    setVerifyCode(next);
    if (val && i < 5) verifyRefs.current[i + 1]?.focus();
  };

  const handleVerifyKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !verifyCode[i] && i > 0) {
      verifyRefs.current[i - 1]?.focus();
    }
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#0a0a14]">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute -left-1/4 top-0 h-[600px] w-[600px] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute right-0 top-1/4 h-[500px] w-[500px] rounded-full bg-fuchsia-500/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-600/15 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[300px] w-[300px] rounded-full bg-amber-500/10 blur-[100px]" />
      </div>

      {/* Scanlines overlay */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 3px)',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-6"
      >
        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <motion.h1
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="relative font-mono text-4xl font-black tracking-[0.2em]"
            style={{
              background: 'linear-gradient(90deg, #00ffff, #ff00ff, #ffaa00)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 20px rgba(0,255,255,0.3))',
            }}
          >
            CIPHERLINE
          </motion.h1>
          <p className="mt-2 font-mono text-[10px] tracking-[0.3em] text-cyan-300/50">
            TOKYO OVERRIDE · SECURE COMMS
          </p>
        </div>

        {resetMode ? (
          <ResetPasswordView
            email={email}
            setEmail={setEmail}
            onReset={handleResetPassword}
            onCancel={() => { setResetMode(false); setError(''); }}
            error={error}
            loading={loading}
          />
        ) : phase === 'verify' ? (
          <VerifyCodeView
            email={email}
            verifyCode={verifyCode}
            verifyRefs={verifyRefs}
            onInput={handleVerifyInput}
            onKey={handleVerifyKey}
            onVerify={handleVerifyCode}
            onResend={handleResendCode}
            cooldown={cooldown}
            error={error}
            loading={loading}
          />
        ) : (
          <FormView
            mode={mode}
            setMode={setMode}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            passwordStrength={passwordStrength()}
            strengthLabel={strengthLabel}
            strengthColor={strengthColor}
            onSignUp={handleSignUp}
            onSignIn={handleSignIn}
            onResetPassword={() => { setResetMode(true); setError(''); }}
            error={error}
            loading={loading}
          />
        )}

        {/* Guest mode */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 flex flex-col items-center gap-2"
        >
          <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
          <button
            onClick={onGuest}
            className="group flex items-center gap-2 font-mono text-xs tracking-widest text-fuchsia-300/40 transition-colors hover:text-fuchsia-300"
          >
            <Ghost size={14} className="transition-transform group-hover:scale-110" />
            ENTRAR SEM CONTA
          </button>
          <p className="font-mono text-[9px] tracking-widest text-slate-500/40">
            MODO CONVIDADO · SALAS TEMPORÁRIAS APENAS
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

function FormView(props: any) {
  return (
    <div className="relative">
      {/* Tab switcher */}
      <div className="mb-6 flex gap-1 rounded-lg border border-cyan-500/20 bg-black/40 p-1 backdrop-blur-xl">
        {['signin', 'signup'].map((m) => (
          <button
            key={m}
            onClick={() => { props.setMode(m); props.setError(''); }}
            className={`flex-1 rounded-md py-2.5 font-mono text-xs tracking-widest transition-all ${
              props.mode === m
                ? 'bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,255,255,0.15)]'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m === 'signin' ? 'ENTRAR' : 'CRIAR CONTA'}
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-xl border border-cyan-500/10 bg-black/40 p-6 backdrop-blur-xl">
        {/* Email */}
        <div className="relative">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500/40" />
          <input
            type="email"
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
            placeholder="E-MAIL"
            className="w-full rounded-lg border border-cyan-500/20 bg-black/30 py-3 pl-10 pr-4 font-mono text-sm text-cyan-100 placeholder-slate-600 focus:border-cyan-400/50 focus:outline-none focus:shadow-[0_0_15px_rgba(0,255,255,0.1)]"
          />
        </div>

        {/* Password */}
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fuchsia-500/40" />
          <input
            type="password"
            value={props.password}
            onChange={(e) => props.setPassword(e.target.value)}
            placeholder="SENHA"
            className="w-full rounded-lg border border-fuchsia-500/20 bg-black/30 py-3 pl-10 pr-4 font-mono text-sm text-fuchsia-100 placeholder-slate-600 focus:border-fuchsia-400/50 focus:outline-none focus:shadow-[0_0_15px_rgba(255,0,255,0.1)]"
          />
        </div>

        {/* Confirm password + strength (signup only) */}
        <AnimatePresence>
          {props.mode === 'signup' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3 overflow-hidden"
            >
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500/40" />
                <input
                  type="password"
                  value={props.confirmPassword}
                  onChange={(e) => props.setConfirmPassword(e.target.value)}
                  placeholder="CONFIRMAR SENHA"
                  className="w-full rounded-lg border border-amber-500/20 bg-black/30 py-3 pl-10 pr-4 font-mono text-sm text-amber-100 placeholder-slate-600 focus:border-amber-400/50 focus:outline-none"
                />
              </div>

              {/* Strength bar */}
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <motion.div
                    className="h-full rounded-full"
                    animate={{ width: `${(props.passwordStrength / 4) * 100}%`, backgroundColor: props.strengthColor }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <span className="font-mono text-[10px] tracking-widest" style={{ color: props.strengthColor }}>
                  {props.strengthLabel}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        {props.error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 font-mono text-xs text-red-400"
          >
            <AlertTriangle size={14} />
            {props.error}
          </motion.div>
        )}

        {/* Submit */}
        <button
          onClick={props.mode === 'signup' ? props.onSignUp : props.onSignIn}
          disabled={props.loading}
          className="group relative w-full overflow-hidden rounded-lg border border-cyan-400/30 bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 py-3 font-mono text-sm tracking-widest text-cyan-200 transition-all hover:shadow-[0_0_25px_rgba(0,255,255,0.2)] disabled:opacity-50"
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            {props.loading ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <>
                {props.mode === 'signup' ? 'CRIAR CONTA' : 'ENTRAR'}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </>
            )}
          </span>
        </button>

        {/* Forgot password (signin only) */}
        {props.mode === 'signin' && (
          <button
            onClick={props.onResetPassword}
            className="block w-full text-center font-mono text-[10px] tracking-widest text-slate-500 transition-colors hover:text-fuchsia-300"
          >
            ESQUECI MINHA SENHA
          </button>
        )}
      </div>
    </div>
  );
}

function VerifyCodeView(props: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border border-cyan-500/20 bg-black/40 p-6 backdrop-blur-xl"
    >
      <div className="mb-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10"
        >
          <Mail size={20} className="text-cyan-300" />
        </motion.div>
        <p className="font-mono text-xs tracking-widest text-cyan-200">
          CÓDIGO ENVIADO PARA
        </p>
        <p className="mt-1 font-mono text-sm text-fuchsia-300">{props.email}</p>
      </div>

      {/* Code inputs */}
      <div className="mb-6 flex justify-center gap-2">
        {props.verifyCode.map((digit: string, i: number) => (
          <input
            key={i}
            ref={(el: any) => (props.verifyRefs.current[i] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => props.onInput(i, e.target.value)}
            onKeyDown={(e) => props.onKey(i, e)}
            className="h-14 w-12 rounded-lg border border-cyan-500/30 bg-black/30 text-center font-mono text-2xl font-bold text-cyan-200 focus:border-cyan-400/60 focus:outline-none focus:shadow-[0_0_15px_rgba(0,255,255,0.15)]"
          />
        ))}
      </div>

      {props.error && (
        <div className="mb-4 flex items-center justify-center gap-2 font-mono text-xs text-red-400">
          <AlertTriangle size={14} />
          {props.error}
        </div>
      )}

      <button
        onClick={props.onVerify}
        disabled={props.loading}
        className="w-full rounded-lg border border-cyan-400/30 bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 py-3 font-mono text-sm tracking-widest text-cyan-200 transition-all hover:shadow-[0_0_25px_rgba(0,255,255,0.2)] disabled:opacity-50"
      >
        {props.loading ? <RefreshCw size={16} className="mx-auto animate-spin" /> : 'VERIFICAR'}
      </button>

      <button
        onClick={props.onResend}
        disabled={props.cooldown > 0}
        className="mt-3 block w-full text-center font-mono text-[10px] tracking-widest text-slate-500 transition-colors hover:text-cyan-300 disabled:opacity-30"
      >
        {props.cooldown > 0 ? `REENVIAR EM ${props.cooldown}s` : 'REENVIAR CÓDIGO'}
      </button>
    </motion.div>
  );
}

function ResetPasswordView(props: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border border-fuchsia-500/20 bg-black/40 p-6 backdrop-blur-xl"
    >
      <div className="mb-4 text-center">
        <p className="font-mono text-sm tracking-widest text-fuchsia-300">RECUPERAR SENHA</p>
        <p className="mt-1 font-mono text-[10px] tracking-widest text-slate-500">
          ENVIAREMOS UM LINK PARA SEU E-MAIL
        </p>
      </div>

      <div className="relative mb-4">
        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500/40" />
        <input
          type="email"
          value={props.email}
          onChange={(e) => props.setEmail(e.target.value)}
          placeholder="E-MAIL"
          className="w-full rounded-lg border border-cyan-500/20 bg-black/30 py-3 pl-10 pr-4 font-mono text-sm text-cyan-100 placeholder-slate-600 focus:border-cyan-400/50 focus:outline-none"
        />
      </div>

      {props.error && (
        <div className="mb-4 flex items-center gap-2 font-mono text-xs text-red-400">
          <AlertTriangle size={14} />
          {props.error}
        </div>
      )}

      <button
        onClick={props.onReset}
        disabled={props.loading}
        className="w-full rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 py-3 font-mono text-sm tracking-widest text-fuchsia-200 transition-all hover:shadow-[0_0_25px_rgba(255,0,255,0.2)] disabled:opacity-50"
      >
        {props.loading ? <RefreshCw size={16} className="mx-auto animate-spin" /> : 'ENVIAR LINK'}
      </button>

      <button
        onClick={props.onCancel}
        className="mt-3 block w-full text-center font-mono text-[10px] tracking-widest text-slate-500 transition-colors hover:text-cyan-300"
      >
        VOLTAR
      </button>
    </motion.div>
  );
}
