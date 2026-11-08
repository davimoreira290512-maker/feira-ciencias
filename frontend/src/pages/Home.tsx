import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  FlaskConical,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import type { AuthorizedMuralUser, AuthUser, MuralOwner, MuralUnlockRequest } from "@/lib/auth";
import type {
  FeedbackCreate,
  FeedbackReceipt,
  FeedbackSummary,
} from "@/lib/feedback";
import { Toaster } from "@/components/ui/sonner";
import { beginSession, endSession } from "@/lib/session";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import MuralMessages from "@/components/MuralMessages";
import type { UnreadCount } from "@/lib/mural";
import OwnerPasswordCard from "@/components/OwnerPasswordCard";
import OwnerFeedbackManager from "@/components/OwnerFeedbackManager";

const ratings = [
  { value: 1, label: "Horrível", face: "😡", color: "rose" },
  { value: 2, label: "Ruim", face: "🙁", color: "orange" },
  { value: 3, label: "Regular", face: "😐", color: "yellow" },
  { value: 4, label: "Bom", face: "😊", color: "emerald" },
  { value: 5, label: "Incrível", face: "🤩", color: "sky" },
] as const;

const ratingQuestions = [
  {
    key: "clarity",
    label: "O grupo explicou de forma clara e fácil de entender?",
    options: [
      { value: 1, label: "Muito confuso", face: "😡", color: "rose" },
      { value: 2, label: "Confuso", face: "🙁", color: "orange" },
      { value: 3, label: "Razoável", face: "😐", color: "yellow" },
      { value: 4, label: "Claro", face: "😊", color: "emerald" },
      { value: 5, label: "Muito claro", face: "🤩", color: "sky" },
    ],
  },
  {
    key: "visuals",
    label: "Os materiais visuais apresentados ajudaram no seu entendimento?",
    options: [
      { value: 1, label: "Não ajudaram", face: "😡", color: "rose" },
      { value: 2, label: "Ajudaram pouco", face: "🙁", color: "orange" },
      { value: 3, label: "Neutro", face: "😐", color: "yellow" },
      { value: 4, label: "Ajudaram", face: "😊", color: "emerald" },
      { value: 5, label: "Ajudaram muito", face: "🤩", color: "sky" },
    ],
  },
] as const;

type RatingQuestionKey = (typeof ratingQuestions)[number]["key"];
type View = "form" | "mural";

export default function Home() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const startOnMural = new URLSearchParams(location.search).get("view") === "mural";
  const [view, setView] = useState<View>(startOnMural ? "mural" : "form");
  const [selectedRatings, setSelectedRatings] = useState<
    Record<RatingQuestionKey, number | null>
  >({
    clarity: null,
    visuals: null,
  });
  const [suggestion, setSuggestion] = useState("");
  const [sent, setSent] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [pendingOwnerRemoval, setPendingOwnerRemoval] = useState<string | null>(null);

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiGet<AuthUser>("/auth/me"),
    enabled: view === "mural",
    retry: false,
    staleTime: 30_000,
  });

  const feedbackStatusQuery = useQuery({
    queryKey: ["feedback-status"],
    queryFn: () =>
      apiGet<{ already_submitted: boolean; can_repeat: boolean }>("/feedback/status"),
    enabled: view === "form",
    retry: 1,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const summaryQuery = useQuery({
    queryKey: ["feedback-summary"],
    queryFn: () => apiGet<FeedbackSummary>("/feedback/summary"),
    retry: 1,
    enabled:
      view === "mural" &&
      !authQuery.isError &&
      authQuery.data?.mural_unlocked === true,
  });

  // Soft endpoint: anonymous visitors simply get 0, so it is safe to poll everywhere.
  const unreadQuery = useQuery({
    queryKey: ["mural-unread"],
    queryFn: () => apiGet<UnreadCount>("/mural/unread-count"),
    enabled: view !== "mural",
    refetchInterval: 20_000,
    retry: false,
  });

  const authorizedUsersQuery = useQuery({
    queryKey: ["authorized-users"],
    queryFn: () => apiGet<AuthorizedMuralUser[]>("/auth/authorized-users"),
    retry: 1,
    enabled:
      view === "mural" &&
      !authQuery.isError &&
      authQuery.data?.mural_unlocked === true,
  });

  const ownersQuery = useQuery({
    queryKey: ["mural-owners"],
    queryFn: () => apiGet<MuralOwner[]>("/auth/owners"),
    retry: 1,
    enabled: view === "mural" && authQuery.data?.is_owner === true && authQuery.data?.mural_unlocked === true,
  });

  const removeAccess = useMutation({
    mutationFn: (userId: string) => apiDelete<void>(`/auth/authorized-users/${userId}`),
    onSuccess: async () => {
      setPendingRemoval(null);
      await queryClient.invalidateQueries({ queryKey: ["authorized-users"] });
      toast.success("Pessoa bloqueada. Ela não poderá voltar apenas digitando a senha.");
    },
    onError: () => toast.error("Não foi possível remover o acesso."),
  });

  const authorizeAccess = useMutation({
    mutationFn: (userId: string) => apiPost<void>(`/auth/authorized-users/${userId}/authorize`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["authorized-users"] });
      toast.success("Acesso autorizado novamente. A pessoa poderá entrar com a senha do mural.");
    },
    onError: () => toast.error("Não foi possível autorizar essa pessoa."),
  });

  const grantOwner = useMutation({
    mutationFn: (email: string) => apiPost<MuralOwner>("/auth/owners", { email }),
    onSuccess: async () => {
      setOwnerEmail("");
      await queryClient.invalidateQueries({ queryKey: ["mural-owners"] });
      toast.success("Permissão de dono concedida.");
    },
    onError: () => toast.error("Não foi possível conceder essa permissão. Verifique o e-mail."),
  });

  const revokeOwner = useMutation({
    mutationFn: (email: string) => apiDelete<void>(`/auth/owners/${encodeURIComponent(email)}`),
    onSuccess: async () => {
      setPendingOwnerRemoval(null);
      await queryClient.invalidateQueries({ queryKey: ["mural-owners"] });
      toast.success("Permissão de dono removida.");
    },
    onError: () => toast.error("Não foi possível remover essa permissão."),
  });

  const unlockMural = useMutation({
    mutationFn: (payload: MuralUnlockRequest) =>
      apiPost<AuthUser>("/auth/unlock", payload),
    onSuccess: async (user) => {
      queryClient.setQueryData(["auth-me"], user);
      setAccessPassword("");
      setPasswordError("");
      await queryClient.invalidateQueries({ queryKey: ["feedback-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["authorized-users"] });
      toast.success("Acesso ao mural liberado.");
    },
    onError: (error) => {
      const detail =
        error instanceof ApiError && typeof error.body === "object" && error.body
          ? (error.body as { detail?: unknown }).detail
          : null;
      setPasswordError(
        typeof detail === "string"
          ? detail
          : "Não foi possível verificar a senha. Tente novamente.",
      );
    },
  });

  const submitFeedback = useMutation({
    mutationFn: (payload: FeedbackCreate) =>
      apiPost<FeedbackReceipt>("/feedback", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["feedback-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback-status"] });
      if (feedbackStatusQuery.data?.can_repeat === true) {
        setSelectedRatings({ clarity: null, visuals: null });
        setSuggestion("");
        setSent(false);
      } else {
        setSent(true);
      }
      toast.success("Avaliação enviada! Obrigado por apoiar a ciência jovem.");
    },
    onError: (error) => {
      const detail =
        error instanceof ApiError && typeof error.body === "object" && error.body
          ? (error.body as { detail?: unknown }).detail
          : null;
      toast.error(
        typeof detail === "string"
          ? detail
          : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { clarity, visuals } = selectedRatings;
    if (clarity === null || visuals === null) return;
    submitFeedback.mutate({
      rating: clarity,
      // Keep the existing API fields compatible while the form uses the two new criteria.
      decoration_rating: clarity,
      information_rating: visuals,
      suggestion,
    });
  }

  function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    unlockMural.mutate({ password: accessPassword });
  }

  async function handleGoogleCredential(credential: string) {
    try {
      const user = await apiPost<AuthUser>("/auth/google", { credential });
      beginSession();
      queryClient.setQueryData(["auth-me"], user);
    } catch (error) {
      const message =
        error instanceof ApiError && typeof error.body === "object" && error.body
          ? (error.body as { detail?: unknown }).detail
          : null;
      toast.error(typeof message === "string" ? message : "Não foi possível entrar com Google. Tente novamente.");
    }
  }

  async function handleLogout() {
    await endSession("/?view=mural");
  }

  const summary = summaryQuery.data;
  const authIsUnauthorized =
    authQuery.error instanceof ApiError && authQuery.error.status === 401;

  return (
    <div className="min-h-svh bg-[#FAF9F5] text-slate-900">
      <Toaster />
      <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-5 sm:px-6 sm:pt-8">
        <div
          className="mb-6 mt-5 aspect-[0.9] overflow-hidden rounded-2xl bg-[#211f1b] sm:aspect-[2.69]"
          data-testid="feedback-header-image"
        >
          <img
            src="/tiradentes-header.jpg"
            alt="Identidade visual do Colégio Tiradentes para a Feira de Ciências 2026."
            className="relative left-1/2 block h-full w-[300%] max-w-none -translate-x-1/2 object-cover sm:left-0 sm:h-auto sm:w-full sm:translate-x-0"
          />
        </div>

        <nav
          aria-label="Seções da feira"
          className="mb-5 flex gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-1.5 shadow-sm"
          data-testid="feedback-navigation"
        >
          <button
            aria-current={view === "form" ? "page" : undefined}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors duration-200 ${
              view === "form"
                ? "bg-[#201F1B] text-white shadow-sm"
                : "text-slate-600 hover:bg-teal-50 hover:text-teal-900"
            }`}
            data-testid="tab-avaliar"
            onClick={() => { setView("form"); void queryClient.invalidateQueries({ queryKey: ["feedback-status"] }); }}
            type="button"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            Avaliar apresentação
          </button>
          <button
            aria-current={view === "mural" ? "page" : undefined}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors duration-200 ${
              view === "mural"
                ? "bg-[#201F1B] text-white shadow-sm"
                : "text-slate-600 hover:bg-teal-50 hover:text-teal-900"
            }`}
            data-testid="tab-mural"
            onClick={() => setView("mural")}
            type="button"
          >
            <BarChart3 aria-hidden="true" className="size-4" />
            Mural da Feira
            {view !== "mural" && (unreadQuery.data?.count ?? 0) > 0 && (
              <span
                aria-label={`${unreadQuery.data?.count} mensagens privadas novas`}
                className="ml-0.5 inline-flex min-w-5 animate-in zoom-in-50 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-white shadow-sm duration-200"
                data-testid="mural-unread-badge"
              >
                {(unreadQuery.data?.count ?? 0) > 9 ? "9+" : unreadQuery.data?.count}
              </span>
            )}
          </button>
        </nav>

        {view === "form" && (
          feedbackStatusQuery.isLoading ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-7 text-sm text-slate-600 shadow-sm" data-testid="feedback-status-loading">
              Verificando se você já enviou uma avaliação…
            </section>
          ) : feedbackStatusQuery.isError ? (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-7 text-sm text-amber-950" data-testid="feedback-status-error">
              Não foi possível verificar se você já enviou uma avaliação. Tente novamente.
              <button
                className="mt-4 block min-h-11 rounded-lg bg-amber-900 px-4 font-bold text-white"
                onClick={() => void feedbackStatusQuery.refetch()}
                type="button"
              >
                Tentar novamente
              </button>
            </section>
          ) : sent || feedbackStatusQuery.data?.already_submitted ? (
            <section
              className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-7 shadow-sm sm:p-9"
              data-testid="feedback-success-card"
            >
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-3xl">
                <span aria-hidden="true">🌱</span>
              </div>
              <h2 className="font-heading text-2xl font-bold text-slate-900" data-testid="feedback-success-message">
                Você já enviou sua avaliação!
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600" data-testid="feedback-success-description">
                Cada visitante pode enviar apenas uma avaliação. Obrigado por participar!
              </p>
            </section>
          ) : (
            <form
              className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.4)] sm:p-7"
              data-testid="feedback-form"
              onSubmit={handleSubmit}
            >
              <div className="space-y-5" data-testid="rating-questionnaire">
                <p className="text-sm font-medium text-slate-600" data-testid="rating-required-note">
                  Escolha um rostinho para cada pergunta.
                </p>
                {ratingQuestions.map((question) => (
                  <fieldset
                    className="rounded-2xl border border-slate-200 p-4"
                    data-testid={`rating-question-${question.key}`}
                    key={question.key}
                  >
                    <legend
                      className="max-w-full px-1 text-sm font-bold leading-relaxed text-slate-900 sm:text-base"
                      data-testid={`rating-question-label-${question.key}`}
                    >
                      {question.label}
                    </legend>
                    <div
                      aria-label={question.label}
                      className="mt-2 grid grid-cols-5 gap-2 sm:gap-3"
                      data-testid={`rating-options-${question.key}`}
                      role="radiogroup"
                    >
                      {question.options.map((option) => {
                        const selected = selectedRatings[question.key] === option.value;
                        const palette = {
                          rose: selected
                            ? "border-rose-500 bg-rose-50 ring-2 ring-rose-200"
                            : "border-rose-200 bg-rose-50/60 hover:border-rose-400",
                          orange: selected
                            ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
                            : "border-orange-200 bg-orange-50/60 hover:border-orange-400",
                          yellow: selected
                            ? "border-yellow-500 bg-yellow-50 ring-2 ring-yellow-200"
                            : "border-yellow-200 bg-yellow-50/60 hover:border-yellow-400",
                          emerald: selected
                            ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                            : "border-emerald-200 bg-emerald-50/60 hover:border-emerald-400",
                          sky: selected
                            ? "border-sky-500 bg-sky-50 ring-2 ring-sky-200"
                            : "border-sky-200 bg-sky-50/60 hover:border-sky-400",
                        }[option.color];
                        const ratingSlug = option.label.toLowerCase().replace("í", "i");

                        return (
                          <button
                            aria-checked={selected}
                            aria-label={`${option.value} de 5: ${option.label}`}
                            className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-95 sm:min-h-20 ${palette}`}
                            data-testid={`rating-btn-${question.key}-${ratingSlug}`}
                            key={option.value}
                            onClick={() =>
                              setSelectedRatings((current) => ({
                                ...current,
                                [question.key]: option.value,
                              }))
                            }
                            role="radio"
                            type="button"
                          >
                            <span
                              className="text-2xl leading-none sm:text-3xl"
                              data-testid={`rating-face-${question.key}-${option.value}`}
                            >
                              {option.face}
                            </span>
                            <span
                              className="text-[10px] font-bold leading-tight text-slate-800 sm:text-xs"
                              data-testid={`rating-label-${question.key}-${option.value}`}
                            >
                              {option.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>

              <div className="mt-7">
                <label className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800" htmlFor="suggestion" data-testid="suggestion-label">
                  <MessageCircle aria-hidden="true" className="size-4 text-teal-700" />
                  Deixe seu Feedback
                </label>
                <p className="mb-2 text-sm leading-relaxed text-slate-600">
                  Tem alguma sugestão, elogio ou comentário para o nosso grupo? Conte para a gente! (Opcional)
                </p>
                <textarea
                  className="min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-base leading-relaxed text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10"
                  data-testid="suggestion-textarea"
                  id="suggestion"
                  maxLength={280}
                  onChange={(event) => setSuggestion(event.target.value)}
                  placeholder="Digite seu feedback aqui..."
                  value={suggestion}
                />
                <p className="mt-1 text-right text-xs text-slate-500" data-testid="suggestion-character-count">
                  {suggestion.length}/280
                </p>
              </div>

              <div
                className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950"
                data-testid="privacy-assurance"
              >
                <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blue-800" />
                <p data-testid="privacy-assurance-copy">
                  Avaliação 100% anônima. Nenhum dado pessoal é coletado ou exibido aos alunos.
                </p>
              </div>

              <button
                className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-base font-bold text-white shadow-sm transition-[background-color,transform,box-shadow] duration-200 hover:bg-teal-800 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                data-testid="submit-feedback-btn"
                disabled={
                  Object.values(selectedRatings).some((value) => value === null) ||
                  submitFeedback.isPending
                }
                type="submit"
              >
                <Send aria-hidden="true" className="size-4" />
                {submitFeedback.isPending ? "Enviando avaliação…" : "Enviar avaliação anônima"}
              </button>
            </form>
          )
        )}

        {view === "mural" && (
          <section className="space-y-5" data-testid="mural-access-area">
            {authQuery.isLoading && (
              <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600" data-testid="mural-auth-loading">
                Verificando seu acesso…
              </p>
            )}

            {authIsUnauthorized && (
              <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6 sm:p-7" data-testid="google-login-gate">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white text-blue-800 shadow-sm">
                  <ShieldCheck aria-hidden="true" className="size-6" />
                </div>
                <h2 className="font-heading text-xl font-bold text-slate-900" data-testid="google-login-gate-title">
                  Mural reservado
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-700" data-testid="google-login-gate-copy">
                  Entre com sua conta Google e depois digite a senha compartilhada para ver as avaliações e sugestões.
                </p>
                <div className="mt-5" data-testid="google-login-button">
                  <GoogleSignInButton onCredential={handleGoogleCredential} />
                </div>
              </div>
            )}

            {authQuery.isError && !authIsUnauthorized && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5" data-testid="mural-auth-error">
                <p className="text-sm text-amber-950" data-testid="mural-auth-error-copy">
                  Não foi possível verificar seu acesso agora.
                </p>
                <button
                  className="mt-3 min-h-11 rounded-lg bg-amber-900 px-4 text-sm font-bold text-white"
                  data-testid="mural-auth-retry-button"
                  onClick={() => void authQuery.refetch()}
                  type="button"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {authQuery.data && !authQuery.isError && !authQuery.data.mural_unlocked && (
              <div className="rounded-3xl border border-teal-100 bg-white p-6 shadow-sm sm:p-7" data-testid="mural-password-gate">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-800">
                  <LockKeyhole aria-hidden="true" className="size-6" />
                </div>
                <h2 className="font-heading text-xl font-bold text-slate-900" data-testid="mural-password-title">
                  Confirme a senha de acesso
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600" data-testid="mural-password-copy">
                  A senha é compartilhada somente com as pessoas autorizadas por você.
                </p>
                <form className="mt-5 space-y-3" data-testid="mural-password-form" onSubmit={handleUnlock}>
                  <label className="block text-sm font-bold text-slate-800" htmlFor="mural-password" data-testid="mural-password-label">
                    Senha do mural
                  </label>
                  <input
                    autoComplete="new-password"
                    className="min-h-12 w-full rounded-xl border border-slate-300 px-4 outline-none transition-[border-color,box-shadow] duration-200 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10"
                    data-testid="mural-password-input"
                    id="mural-password"
                    onChange={(event) => setAccessPassword(event.target.value)}
                    type="password"
                    value={accessPassword}
                  />
                  {passwordError && (
                    <p className="text-sm font-medium text-rose-700" data-testid="mural-password-error">
                      {passwordError}
                    </p>
                  )}
                  <button
                    className="inline-flex min-h-12 items-center justify-center rounded-xl bg-teal-700 px-5 font-bold text-white transition-colors duration-200 hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    data-testid="mural-password-submit-button"
                    disabled={!accessPassword || unlockMural.isPending}
                    type="submit"
                  >
                    {unlockMural.isPending ? "Verificando…" : "Abrir mural"}
                  </button>
                </form>
                <button
                  className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-600 transition-colors duration-200 hover:text-slate-900"
                  data-testid="mural-password-logout-button"
                  onClick={handleLogout}
                  type="button"
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  Sair da conta Google
                </button>
              </div>
            )}

            {authQuery.data?.mural_unlocked && !authQuery.isError && (
              <section className="space-y-5" data-testid="feedback-mural">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3" data-testid="mural-user-bar">
                  <p className="text-sm font-semibold text-slate-700" data-testid="mural-user-name">
                    Acesso autorizado: {authQuery.data.name}
                  </p>
                  <button
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900"
                    data-testid="mural-logout-button"
                    onClick={handleLogout}
                    type="button"
                  >
                    <LogOut aria-hidden="true" className="size-4" />
                    Sair
                  </button>
                </div>

            <div className="rounded-3xl border border-teal-100 bg-teal-50 p-5 sm:p-6" data-testid="mural-summary-card">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800" data-testid="mural-eyebrow">
                Vozes da feira
              </p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="font-heading text-2xl font-extrabold text-slate-900" data-testid="mural-title">
                    Mural de avaliações
                  </h2>
                  <p className="mt-1 text-sm text-slate-600" data-testid="mural-description">
                    Opiniões anônimas para inspirar as próximas descobertas.
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 shadow-sm" data-testid="mural-total-stat">
                  <p className="text-2xl font-extrabold text-teal-800" data-testid="mural-total-value">
                    {summary?.total ?? "—"}
                  </p>
                  <p className="text-xs font-medium text-slate-500" data-testid="mural-total-label">
                    avaliações
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700" data-testid="mural-average-stat">
                <span aria-hidden="true" className="text-lg">⭐</span>
                <span data-testid="mural-average-value">
                  {summary?.average_rating != null ? `${summary.average_rating.toFixed(1)} de 5` : "Ainda sem avaliações"}
                </span>
              </div>
            </div>

            <div
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              data-testid="criteria-averages-card"
            >
              <h3
                className="font-heading text-lg font-bold text-slate-900"
                data-testid="criteria-averages-title"
              >
                Médias por pergunta
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-rose-50 p-4" data-testid="criteria-average-decoration">
                  <p className="text-sm font-semibold text-rose-900" data-testid="criteria-label-decoration">
                    Decoração da feira
                  </p>
                  <p className="mt-2 text-xl font-extrabold text-rose-900" data-testid="criteria-value-decoration">
                    {summary?.criteria_averages.decoration != null
                      ? `${summary.criteria_averages.decoration.toFixed(1)} de 5`
                      : "Sem avaliações"}
                  </p>
                </div>
                <div className="rounded-2xl bg-teal-50 p-4" data-testid="criteria-average-presentation">
                  <p className="text-sm font-semibold text-teal-900" data-testid="criteria-label-presentation">
                    Apresentação da feira
                  </p>
                  <p className="mt-2 text-xl font-extrabold text-teal-900" data-testid="criteria-value-presentation">
                    {summary?.average_rating != null
                      ? `${summary.average_rating.toFixed(1)} de 5`
                      : "Sem avaliações"}
                  </p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-4" data-testid="criteria-average-information">
                  <p className="text-sm font-semibold text-sky-900" data-testid="criteria-label-information">
                    Quantidade de informações
                  </p>
                  <p className="mt-2 text-xl font-extrabold text-sky-900" data-testid="criteria-value-information">
                    {summary?.criteria_averages.information != null
                      ? `${summary.criteria_averages.information.toFixed(1)} de 5`
                      : "Sem avaliações"}
                  </p>
                </div>
              </div>
            </div>

            {summaryQuery.isError && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="mural-load-error">
                Não foi possível carregar as avaliações agora. Tente novamente em instantes.
              </p>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="authorized-users-card">
              <div className="flex items-center gap-2">
                <Users aria-hidden="true" className="size-5 text-teal-700" />
                <h3 className="font-heading text-lg font-bold text-slate-900" data-testid="authorized-users-title">
                  Quem acessou o mural
                </h3>
              </div>
              <p className="mt-1 text-sm text-slate-600" data-testid="authorized-users-description">
                Contas Google que entraram com a senha. As avaliações continuam anônimas.
              </p>
              {authorizedUsersQuery.isLoading && (
                <p className="mt-4 text-sm text-slate-600" data-testid="authorized-users-loading">
                  Carregando acessos…
                </p>
              )}
              {authorizedUsersQuery.isError && (
                <p className="mt-4 text-sm text-amber-900" data-testid="authorized-users-error">
                  Não foi possível carregar a lista de acessos agora.
                </p>
              )}
              {authorizedUsersQuery.data && !authorizedUsersQuery.isError && (
                authorizedUsersQuery.data.length ? (
                  <ul className="mt-4 divide-y divide-slate-100" data-testid="authorized-users-list">
                    {authorizedUsersQuery.data.map((person, index) => (
                      <li className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid={`authorized-user-${index}`} key={person.email}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900" data-testid={`authorized-user-name-${index}`}>
                            {person.name}
                          </p>
                          <p className="truncate text-sm text-slate-600" data-testid={`authorized-user-email-${index}`}>
                            {person.email}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-xs text-slate-500" data-testid={`authorized-user-last-access-${index}`}>
                            Último acesso:{" "}
                            {new Date(person.last_access_at).toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </p>
                          {person.is_owner && (
                            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-800" data-testid={`authorized-user-owner-badge-${index}`}>
                              Dono
                            </span>
                          )}
                          {person.access_revoked && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">Bloqueado</span>}
                          {authQuery.data?.is_owner && !person.is_owner && person.access_revoked && (
                            <button className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50" disabled={authorizeAccess.isPending} onClick={() => authorizeAccess.mutate(person.user_id)} type="button">
                              Autorizar novamente
                            </button>
                          )}
                          {authQuery.data?.is_owner && !person.is_owner && !person.access_revoked && (
                            pendingRemoval === person.user_id ? (
                              <span className="flex items-center gap-2">
                                <button
                                  className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-bold text-white transition-colors duration-200 hover:bg-rose-800 disabled:bg-slate-300"
                                  data-testid={`authorized-user-confirm-remove-${index}`}
                                  disabled={removeAccess.isPending}
                                  onClick={() => removeAccess.mutate(person.user_id)}
                                  type="button"
                                >
                                  {removeAccess.isPending ? "Removendo…" : "Confirmar"}
                                </button>
                                <button
                                  className="min-h-9 rounded-lg px-3 text-xs font-semibold text-slate-600 transition-colors duration-200 hover:bg-slate-100"
                                  data-testid={`authorized-user-cancel-remove-${index}`}
                                  onClick={() => setPendingRemoval(null)}
                                  type="button"
                                >
                                  Cancelar
                                </button>
                              </span>
                            ) : (
                              <button
                                className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 transition-colors duration-200 hover:bg-rose-50"
                                data-testid={`authorized-user-remove-${index}`}
                                onClick={() => setPendingRemoval(person.user_id)}
                                type="button"
                              >
                                Remover acesso
                              </button>
                            )
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-slate-600" data-testid="authorized-users-empty">
                    Ninguém acessou o mural ainda.
                  </p>
                )
              )}
            </div>

            {authQuery.data.is_owner && (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="mural-owner-management">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-5 text-teal-700" />
                  <h3 className="font-heading text-lg font-bold text-slate-900">Gerenciar donos</h3>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Donos podem administrar o mural e avaliações. Somente o dono original pode conceder ou retirar essa permissão.
                </p>
                {ownersQuery.isLoading && <p className="mt-3 text-sm text-slate-600">Carregando donos…</p>}
                {ownersQuery.isError && <p className="mt-3 text-sm text-amber-800">Não foi possível carregar a lista de donos.</p>}
                {ownersQuery.data && (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {ownersQuery.data.map((person) => (
                      <li key={person.email} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{person.email}</p>
                          <p className="text-xs text-slate-500">{person.is_original ? "Dono original — não pode ser removido" : "Dono delegado"}</p>
                        </div>
                        {authQuery.data.is_original_owner && !person.is_original && (
                          pendingOwnerRemoval === person.email ? (
                            <span className="flex items-center gap-2">
                              <button className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-bold text-white disabled:bg-slate-300" disabled={revokeOwner.isPending} onClick={() => revokeOwner.mutate(person.email)} type="button">
                                {revokeOwner.isPending ? "Removendo…" : "Confirmar"}
                              </button>
                              <button className="min-h-9 rounded-lg px-3 text-xs font-semibold text-slate-600" onClick={() => setPendingOwnerRemoval(null)} type="button">Cancelar</button>
                            </span>
                          ) : (
                            <button className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 hover:bg-rose-50" onClick={() => setPendingOwnerRemoval(person.email)} type="button">Remover dono</button>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {authQuery.data.is_original_owner && (
                  <form className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (ownerEmail.trim()) grantOwner.mutate(ownerEmail.trim()); }}>
                    <input aria-label="E-mail Google do novo dono" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm" type="email" placeholder="E-mail da conta Google" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} required />
                    <button className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-bold text-white disabled:bg-slate-300" disabled={!ownerEmail.trim() || grantOwner.isPending} type="submit">{grantOwner.isPending ? "Concedendo…" : "Tornar dono"}</button>
                  </form>
                )}
              </section>
            )}

            <MuralMessages me={authQuery.data} people={authorizedUsersQuery.data ?? []} />

            {authQuery.data.is_owner && <OwnerFeedbackManager />}
            {authQuery.data.is_owner && <OwnerPasswordCard />}
            {summaryQuery.isLoading && (
              <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" data-testid="mural-loading">
                Carregando avaliações…
              </p>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="rating-breakdown-card">
              <h3 className="font-heading text-lg font-bold text-slate-900" data-testid="rating-breakdown-title">
                Como a feira está se sentindo
              </h3>
              <div className="mt-4 space-y-3">
                {ratings.map((option) => {
                  const count = summary?.rating_counts.find((item) => item.rating === option.value)?.count ?? 0;
                  const share = summary?.total ? (count / summary.total) * 100 : 0;
                  return (
                    <div className="flex items-center gap-3" data-testid={`mural-rating-row-${option.value}`} key={option.value}>
                      <span className="w-8 text-xl" data-testid={`mural-rating-face-${option.value}`}>{option.face}</span>
                      <span className="w-20 text-sm font-semibold text-slate-700" data-testid={`mural-rating-label-${option.value}`}>
                        {option.label}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" data-testid={`mural-rating-bar-${option.value}`}>
                        <div
                          className="h-full rounded-full bg-teal-600 transition-[width] duration-500"
                          data-testid={`mural-rating-fill-${option.value}`}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="w-7 text-right text-sm font-bold tabular-nums text-slate-600" data-testid={`mural-rating-count-${option.value}`}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="suggestions-card">
              <div className="flex items-center gap-2">
                <MessageCircle aria-hidden="true" className="size-5 text-teal-700" />
                <h3 className="font-heading text-lg font-bold text-slate-900" data-testid="suggestions-title">
                  Sugestões da comunidade
                </h3>
              </div>
              {summary?.suggestions.length ? (
                <ul className="mt-4 space-y-3" data-testid="suggestions-list">
                  {summary.suggestions.map((item, index) => (
                    <li className="rounded-2xl bg-[#FAF9F5] p-4" data-testid={`suggestion-item-${index}`} key={`${item.project_name}-${index}`}>
                      <p className="text-sm font-bold text-teal-800" data-testid={`suggestion-project-${index}`}>
                        {item.project_name}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700" data-testid={`suggestion-copy-${index}`}>
                        “{item.suggestion}”
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 rounded-2xl bg-[#FAF9F5] p-5" data-testid="suggestions-empty-state">
                  <p className="text-sm font-semibold text-slate-700" data-testid="suggestions-empty-title">
                    Ainda não há sugestões por aqui.
                  </p>
                  <p className="mt-1 text-sm text-slate-600" data-testid="suggestions-empty-copy">
                    Deixe a primeira dica para ajudar os estudantes.
                  </p>
                </div>
              )}
            </div>

            <button
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-teal-700 px-5 font-bold text-white transition-colors duration-200 hover:bg-teal-800"
              data-testid="mural-back-to-form-button"
              onClick={() => setView("form")}
              type="button"
            >
              <Sparkles aria-hidden="true" className="size-4" />
              Deixar uma avaliação
            </button>
              </section>
            )}
          </section>
        )}

        <footer className="mt-8 flex items-center gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500" data-testid="feedback-footer">
          <span aria-hidden="true">🔬</span>
          <p data-testid="footer-copy">Feito para a ciência aprender com cada encontro.</p>
        </footer>
      </div>
    </div>
  );
}
