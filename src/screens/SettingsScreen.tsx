import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronRight, Bell, Info, FileText, Bug, MessageSquarePlus,
  UserX, LogOut, Instagram, Mail, Phone, AlertTriangle, Palette, User, Camera, Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { requestNotificationPermission } from '@/lib/push';
import { ImageUploader } from '@/components/ImageUploader';
import type { UserProfile } from '@/types';

type SettingsView = 'menu' | 'geral' | 'sobre' | 'termos' | 'bug' | 'sugestao' | 'conta' | 'perfil';

interface SettingsScreenProps {
  profile: UserProfile | null;
  onClose: () => void;
  onSignOut: () => void;
  onAccountDeleted: () => void;
  theme: 'default' | 'overide';
  onSetTheme: (theme: 'default' | 'overide') => void;
  onProfileUpdated: () => void;
}

export function SettingsScreen({ profile, onClose, onSignOut, onAccountDeleted, theme, onSetTheme, onProfileUpdated }: SettingsScreenProps) {
  const [view, setView] = useState<SettingsView>('menu');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [notifStatus, setNotifStatus] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [profileDisplayName, setProfileDisplayName] = useState(profile?.display_name || '');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState<Blob | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (profile?.avatar_path) {
      import('@/lib/media').then(({ getImageUrl }) => {
        getImageUrl(profile.avatar_path!).then(setProfileAvatarUrl);
      });
    }
  }, [profile?.avatar_path]);

  const saveProfile = async () => {
    if (!profile) return;
    setProfileSaving(true);
    try {
      let avatarPath = profile.avatar_path;
      if (pendingAvatarBlob) {
        const { uploadAvatar } = await import('@/lib/media');
        avatarPath = await uploadAvatar(profile.id, pendingAvatarBlob);
      }
      await supabase
        .from('profiles')
        .update({ display_name: profileDisplayName.trim() || null, avatar_path: avatarPath })
        .eq('id', profile.id);
      setPendingAvatarBlob(null);
      setProfileSaved(true);
      onProfileUpdated();
      setTimeout(() => setProfileSaved(false), 2000);
    } finally {
      setProfileSaving(false);
    }
  };

  const submitFeedback = async (type: 'bug' | 'suggestion') => {
    if (!feedbackText.trim()) return;
    await supabase.from('feedback').insert({
      user_id: profile?.id || null,
      type,
      message: feedbackText.trim(),
      contact_email: feedbackEmail.trim() || null,
    });
    setFeedbackSent(true);
    setFeedbackText('');
    setFeedbackEmail('');
    setTimeout(() => {
      setFeedbackSent(false);
      setView('menu');
    }, 2000);
  };

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifStatus(granted ? 'granted' : 'denied');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('SESSÃO INVÁLIDA');

      const { error } = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;

      await supabase.auth.signOut();
      onAccountDeleted();
    } catch {
      setDeleteError('FALHA AO ELIMINAR CONTA — TENTE NOVAMENTE');
      setDeleting(false);
    }
  };

  const menuItems: { view: SettingsView; icon: typeof Info; label: string }[] = [
    { view: 'geral', icon: Bell, label: 'GERAL' },
    ...(profile ? [{ view: 'perfil' as SettingsView, icon: User, label: 'PERFIL' }] : []),
    { view: 'sobre', icon: Info, label: 'SOBRE' },
    { view: 'termos', icon: FileText, label: 'TERMOS DE USO' },
    { view: 'bug', icon: Bug, label: 'REPORTAR BUG' },
    { view: 'sugestao', icon: MessageSquarePlus, label: 'CAIXA DE SUGESTÕES' },
    ...(profile ? [{ view: 'conta' as SettingsView, icon: UserX, label: 'CONTA' }] : []),
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex flex-col bg-cyber-bg"
    >
      {/* Header */}
      <div className="glass clip-hud-sm relative z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {view !== 'menu' && (
            <button
              onClick={() => setView('menu')}
              className="mr-1 text-cyber-text-dim transition-colors hover:text-cyber-green"
            >
              <ChevronRight size={16} className="rotate-180" />
            </button>
          )}
          <span className="font-mono text-sm tracking-widest text-cyber-green">
            {view === 'menu' ? 'DEFINIÇÕES' : menuItems.find((m) => m.view === view)?.label || 'DEFINIÇÕES'}
          </span>
        </div>
        <button onClick={onClose} className="text-cyber-text-dim transition-colors hover:text-cyber-red">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md">
          <AnimatePresence mode="wait">
            {view === 'menu' && (
              <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                {menuItems.map((item) => (
                  <button
                    key={item.view}
                    onClick={() => setView(item.view)}
                    className="glass clip-hud-sm flex w-full items-center justify-between px-4 py-4 transition-colors hover:bg-cyber-green/5"
                  >
                    <div className="flex items-center gap-3">
                      <item.icon size={16} className="text-cyber-green" />
                      <span className="font-mono text-xs tracking-widest text-cyber-text">{item.label}</span>
                    </div>
                    <ChevronRight size={14} className="text-cyber-text-dim" />
                  </button>
                ))}
              </motion.div>
            )}

            {view === 'geral' && (
              <motion.div key="geral" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="glass clip-hud-sm p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Palette size={14} className="text-cyber-magenta" />
                    <span className="font-mono text-xs tracking-widest text-cyber-magenta">TEMA VISUAL</span>
                  </div>
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-cyber-text-dim">
                    ESCOLHA A IDENTIDADE VISUAL DE TODA A PLATAFORMA.
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={() => onSetTheme('default')}
                      className={`clip-hud-sm flex w-full items-center justify-between px-4 py-3 font-mono text-[10px] tracking-widest transition-colors ${
                        theme === 'default'
                          ? 'border border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                          : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                      }`}
                    >
                      PADRÃO — VERDE MATRIX
                      {theme === 'default' && <span>●</span>}
                    </button>
                    <button
                      onClick={() => onSetTheme('overide')}
                      className={`clip-hud-sm flex w-full items-center justify-between px-4 py-3 font-mono text-[10px] tracking-widest transition-colors ${
                        theme === 'overide'
                          ? 'border border-cyber-magenta/40 bg-cyber-magenta/10 text-cyber-magenta'
                          : 'border border-cyber-border text-cyber-text-dim hover:text-cyber-text'
                      }`}
                    >
                      OVER RIDE — HOLOGRAMA VIBRANTE
                      {theme === 'overide' && <span>●</span>}
                    </button>
                  </div>
                  {!profile && (
                    <p className="mt-2 font-mono text-[9px] text-cyber-text-faint">
                      SEM CONTA: A ESCOLHA VALE SÓ PARA ESTE NAVEGADOR
                    </p>
                  )}
                </div>

                <div className="glass clip-hud-sm p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Bell size={14} className="text-cyber-cyan" />
                    <span className="font-mono text-xs tracking-widest text-cyber-cyan">NOTIFICAÇÕES</span>
                  </div>
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-cyber-text-dim">
                    RECEBA UM AVISO QUANDO CHEGAR MENSAGEM NOVA, MESMO COM O APP FECHADO.
                  </p>
                  <button
                    onClick={handleEnableNotifications}
                    disabled={notifStatus === 'granted'}
                    className="clip-hud-sm w-full border border-cyber-cyan/30 bg-cyber-cyan/10 px-4 py-2 font-mono text-[10px] tracking-widest text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:opacity-50"
                  >
                    {notifStatus === 'granted' ? 'ATIVADAS' : notifStatus === 'denied' ? 'PERMISSÃO NEGADA — VERIFIQUE O NAVEGADOR' : 'ATIVAR NOTIFICAÇÕES'}
                  </button>
                </div>
              </motion.div>
            )}

            {view === 'perfil' && profile && (
              <motion.div key="perfil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="glass clip-hud-sm p-4">
                  <p className="mb-3 font-mono text-[9px] leading-relaxed text-cyber-text-faint">
                    ISSO É OPCIONAL. POR PADRÃO VOCÊ CONTINUA ANÔNIMO (CÓDIGO GERADO) EM TODA SALA — SÓ APARECE COM SEU PERFIL NAS SALAS ONDE VOCÊ LIGAR ISSO EXPLICITAMENTE (EM "CONFIGURAÇÕES DO CANAL").
                  </p>

                  <div className="mb-4 flex items-center gap-4">
                    <button
                      onClick={() => setShowAvatarPicker(true)}
                      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-cyber-green/30 bg-cyber-panel-2"
                    >
                      {profileAvatarUrl ? (
                        <img src={profileAvatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-cyber-text-dim">
                          <User size={24} />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
                        <Camera size={16} className="text-white" />
                      </div>
                    </button>
                    <div className="flex-1">
                      <p className="mb-1 font-mono text-[10px] tracking-widest text-cyber-text-dim">NOME DE PERFIL</p>
                      <input
                        type="text"
                        value={profileDisplayName}
                        onChange={(e) => setProfileDisplayName(e.target.value)}
                        maxLength={40}
                        placeholder={profile.nickname}
                        className="w-full border border-cyber-border bg-transparent px-2 py-1.5 font-mono text-sm text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-green/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    onClick={saveProfile}
                    disabled={profileSaving}
                    className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-50"
                  >
                    {profileSaved ? (
                      <>
                        <Check size={14} /> SALVO
                      </>
                    ) : profileSaving ? (
                      'SALVANDO...'
                    ) : (
                      'SALVAR PERFIL'
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {showAvatarPicker && (
              <ImageUploader
                onSend={(blob) => {
                  setPendingAvatarBlob(blob);
                  setProfileAvatarUrl(URL.createObjectURL(blob));
                  setShowAvatarPicker(false);
                }}
                onCancel={() => setShowAvatarPicker(false)}
              />
            )}

            {view === 'sobre' && (
              <motion.div key="sobre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="glass clip-hud-sm p-4 text-center">
                  <h3 className="font-mono text-lg font-bold tracking-[0.15em] text-cyber-green glow-green">CIPHERLINE</h3>
                  <p className="mt-1 font-mono text-[10px] text-cyber-text-dim">CHAT CRIPTOGRAFADO E EFÊMERO</p>
                </div>
                <div className="glass clip-hud-sm p-4">
                  <p className="mb-3 font-mono text-[10px] tracking-widest text-cyber-text-dim">CRIADO POR</p>
                  <p className="font-mono text-sm text-cyber-text">José Eduardo Numa Canjo</p>
                  <p className="mb-3 font-mono text-[10px] text-cyber-text-dim">CEO — EiVORAK</p>
                  <div className="space-y-2">
                    <a
                      href="https://www.instagram.com/joseeduardonuma/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-mono text-xs text-cyber-cyan transition-colors hover:text-cyber-green"
                    >
                      <Instagram size={14} /> @joseeduardonuma
                    </a>
                    <a
                      href="mailto:Edivaldotc16@gmail.com"
                      className="flex items-center gap-2 font-mono text-xs text-cyber-cyan transition-colors hover:text-cyber-green"
                    >
                      <Mail size={14} /> Edivaldotc16@gmail.com
                    </a>
                    <div className="flex items-center gap-2 font-mono text-xs text-cyber-text-dim">
                      <Phone size={14} /> 797 390 0858 · 956 498 238
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'termos' && (
              <motion.div key="termos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass clip-hud-sm space-y-3 p-4 font-mono text-[11px] leading-relaxed text-cyber-text-dim">
                <p><span className="text-cyber-cyan">1. NATUREZA DO SERVIÇO —</span> o CipherLine é um chat efêmero e criptografado ponta-a-ponta. Mensagens podem se autodestruir conforme configurado por cada sala.</p>
                <p><span className="text-cyber-cyan">2. RESPONSABILIDADE —</span> o usuário é responsável pelo conteúdo que envia e compartilha. É proibido usar a plataforma para atividades ilegais, assédio ou disseminação de conteúdo prejudicial.</p>
                <p><span className="text-cyber-cyan">3. PRIVACIDADE —</span> o conteúdo das mensagens é cifrado no seu dispositivo antes de ser enviado — o servidor não tem acesso ao texto original.</p>
                <p><span className="text-cyber-cyan">4. CONTA —</span> você pode eliminar sua conta a qualquer momento em Definições → Conta. Isso remove seu acesso a salas persistentes associadas ao seu perfil.</p>
                <p><span className="text-cyber-cyan">5. LIMITAÇÃO —</span> o serviço é fornecido "como está", sem garantias de disponibilidade contínua.</p>
              </motion.div>
            )}

            {(view === 'bug' || view === 'sugestao') && (
              <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass clip-hud-sm space-y-3 p-4">
                {feedbackSent ? (
                  <p className="py-6 text-center font-mono text-xs tracking-widest text-cyber-green">
                    ENVIADO — OBRIGADO!
                  </p>
                ) : (
                  <>
                    <p className="font-mono text-[10px] tracking-widest text-cyber-text-dim">
                      {view === 'bug' ? 'DESCREVA O PROBLEMA ENCONTRADO' : 'CONTE SUA IDEIA OU SUGESTÃO'}
                    </p>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      rows={5}
                      className="w-full resize-none border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-green/50 focus:outline-none"
                      placeholder={view === 'bug' ? 'O que aconteceu?' : 'O que você gostaria de ver no app?'}
                    />
                    <input
                      type="email"
                      value={feedbackEmail}
                      onChange={(e) => setFeedbackEmail(e.target.value)}
                      className="w-full border border-cyber-border bg-transparent px-3 py-2 font-mono text-xs text-cyber-text placeholder:text-cyber-text-faint focus:border-cyber-green/50 focus:outline-none"
                      placeholder="Seu e-mail (opcional, para resposta)"
                    />
                    <button
                      onClick={() => submitFeedback(view === 'bug' ? 'bug' : 'suggestion')}
                      disabled={!feedbackText.trim()}
                      className="clip-hud-sm w-full border border-cyber-green/30 bg-cyber-green/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-green transition-colors hover:bg-cyber-green/20 disabled:opacity-30"
                    >
                      ENVIAR
                    </button>
                  </>
                )}
              </motion.div>
            )}

            {view === 'conta' && profile && (
              <motion.div key="conta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                {profile && (
                  <div className="glass clip-hud-sm p-4">
                    <p className="font-mono text-[10px] text-cyber-text-dim">LOGADO COMO</p>
                    <p className="font-mono text-sm text-cyber-text">{profile.email}</p>
                  </div>
                )}

                <button
                  onClick={onSignOut}
                  className="clip-hud-sm flex w-full items-center justify-center gap-2 border border-cyber-border px-4 py-3 font-mono text-xs tracking-widest text-cyber-text-dim transition-colors hover:text-cyber-text"
                >
                  <LogOut size={14} /> SAIR DA CONTA
                </button>

                <div className="glass clip-hud-sm border-cyber-red/30 p-4">
                  <div className="mb-2 flex items-center gap-2 text-cyber-red">
                    <AlertTriangle size={14} />
                    <span className="font-mono text-xs tracking-widest">ZONA DE PERIGO</span>
                  </div>
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-cyber-text-dim">
                    ELIMINAR A CONTA É PERMANENTE. SALAS PERMANENTES CRIADAS POR VOCÊ FICAM SEM DONO, MAS NÃO SÃO APAGADAS AUTOMATICAMENTE.
                  </p>
                  {!deleteConfirm ? (
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      className="clip-hud-sm w-full border border-cyber-red/40 bg-cyber-red/10 px-4 py-3 font-mono text-xs tracking-widest text-cyber-red transition-colors hover:bg-cyber-red/20"
                    >
                      ELIMINAR CONTA
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-mono text-[10px] tracking-widest text-cyber-red">TEM CERTEZA? ISSO NÃO PODE SER DESFEITO.</p>
                      {deleteError && <p className="font-mono text-[10px] text-cyber-red">{deleteError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDeleteConfirm(false)}
                          className="clip-hud-sm flex-1 border border-cyber-border px-4 py-2 font-mono text-[10px] tracking-widest text-cyber-text-dim"
                        >
                          CANCELAR
                        </button>
                        <button
                          onClick={handleDeleteAccount}
                          disabled={deleting}
                          className="clip-hud-sm flex-1 border border-cyber-red/50 bg-cyber-red/20 px-4 py-2 font-mono text-[10px] tracking-widest text-cyber-red disabled:opacity-50"
                        >
                          {deleting ? 'ELIMINANDO...' : 'CONFIRMAR'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
