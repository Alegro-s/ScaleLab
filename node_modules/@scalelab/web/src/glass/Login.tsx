import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, errText } from '../state';
import { Btn, Field, Input, Check } from '../ui/atoms';

export function GlassLogin() {
  const { login, register, demo, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [reg, setReg] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [touched, setTouched] = useState(false);
  const [remember, setRemember] = useState(true);
  useEffect(() => { if (user) nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true }); }, [user, nav, loc.state]);
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!email || pw.length < 6) return;
    void go(() => (reg ? register(email, pw, name) : login(email, pw)));
  };
  return (
    <div className="g-login">
      <section className="g-hero">
        <h1>МасштабЛаб</h1>
      </section>
      <form className="g-panel g-card-login" onSubmit={submit} noValidate>
        <h2>{reg ? 'Регистрация' : 'Вход'}</h2>
        <p className="g-dim">Продолжите работу с сессиями и отчётами</p>
        {reg && <Field label="Имя"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Фамилия И. О." autoComplete="name" /></Field>}
        <Field label="Электронная почта"><Input type="email" value={email} aria-invalid={touched && !email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.ru" autoComplete="email" /></Field>
        <Field label="Пароль" hint={reg ? 'Не короче 6 символов' : undefined}><Input type="password" value={pw} aria-invalid={touched && pw.length < 6} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete={reg ? 'new-password' : 'current-password'} /></Field>
        <div className="g-row g-between"><Check checked={remember} onChange={setRemember}>Запомнить меня</Check><button type="button" className="g-hl" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setReg(!reg)}>{reg ? 'У меня есть аккаунт' : 'Регистрация'}</button></div>
        {err && <div className="g-err" role="alert">{err}</div>}
        <Btn v="p" wide type="submit" disabled={busy}>{busy ? 'Подождите…' : reg ? 'Создать аккаунт' : 'Войти'}</Btn>
        <div className="g-or">или</div>
        <Btn wide icon="visibility" disabled={busy} onClick={() => go(demo)}>Демо-режим без регистрации</Btn>
      </form>
    </div>
  );
}
