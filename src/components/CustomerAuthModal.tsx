import { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  LogIn,
  Mail,
  Lock,
  Phone,
  User,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import {
  CustomerProfile,
  registerCustomer,
  loginCustomer,
  formatPhoneBr,
} from '../services/auth';

export type AuthModalMode = 'register' | 'login';

interface CustomerAuthModalProps {
  isOpen: boolean;
  initialMode?: AuthModalMode;
  reasonMessage?: string | null;
  onClose: () => void;
  onSuccess: (profile: CustomerProfile) => void;
}

export function CustomerAuthModal({
  isOpen,
  initialMode = 'register',
  reasonMessage,
  onClose,
  onSuccess,
}: CustomerAuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const profile =
        mode === 'register'
          ? await registerCustomer({ name, email, phone, password })
          : await loginCustomer({ email, password });

      setPassword('');
      onSuccess(profile);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao processar sua solicitação.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-auth-modal-title"
        className="w-full max-w-md bg-[#0E0E0E] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-white"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#141414] border-b border-zinc-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#E50914] block">
              STREET STORE · ÁREA DO CLIENTE
            </span>
            <h2
              id="customer-auth-modal-title"
              className="text-lg font-black uppercase tracking-wide font-oswald text-white"
            >
              {mode === 'register' ? 'Criar Cadastro de Cliente' : 'Entrar na Sua Conta'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Fechar janela de cadastro"
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Purchase Gate Notice */}
          {reasonMessage && (
            <div className="p-3 bg-[#E50914]/15 border border-[#E50914]/40 rounded-xl text-xs text-red-100 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-[#E50914] shrink-0 mt-0.5" />
              <span>{reasonMessage}</span>
            </div>
          )}

          {/* Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-[#E50914] text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Cadastrar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#E50914] text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Já tenho conta</span>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block mb-1">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: João Pedro Silva"
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block mb-1">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="w-full pl-9 pr-3 py-2.5 text-xs bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                />
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block mb-1">
                  Telefone / WhatsApp
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    maxLength={15}
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneBr(e.target.value))}
                    placeholder="(31) 98480-6556"
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 block mb-1">
                Senha {mode === 'register' && <span className="text-zinc-500 font-normal">(mín. 6 caracteres)</span>}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-xs bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-[#E50914] hover:bg-[#c90812] text-white font-black text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-red-950/60 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{mode === 'register' ? 'Criando cadastro...' : 'Entrando...'}</span>
                </>
              ) : mode === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>CONCLUIR CADASTRO</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>ENTRAR NA CONTA</span>
                </>
              )}
            </button>
          </form>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-400 pt-2 border-t border-zinc-800">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Seus dados ficam protegidos para agilizar seus pedidos</span>
          </div>
        </div>
      </div>
    </div>
  );
}
