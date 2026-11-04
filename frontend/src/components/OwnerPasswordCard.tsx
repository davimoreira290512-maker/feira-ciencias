import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { apiPut } from "@/lib/api";
import type { MuralPasswordChange } from "@/lib/auth";

export default function OwnerPasswordCard() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const changePassword = useMutation({
    mutationFn: (payload: MuralPasswordChange) => apiPut<void>("/auth/mural-password", payload),
    onSuccess: () => {
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      toast.success("Senha do mural atualizada.");
    },
    onError: () => setError("Não foi possível trocar a senha. Tente novamente."),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 6) {
      setError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("As senhas não são iguais.");
      return;
    }
    setError("");
    changePassword.mutate({ new_password: newPassword });
  }

  const inputClass =
    "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 outline-none transition-[border-color,box-shadow] duration-200 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10";

  return (
    <div className="rounded-3xl border border-teal-100 bg-white p-5 shadow-sm sm:p-6" data-testid="owner-password-card">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden="true" className="size-5 text-teal-700" />
        <h3 className="font-heading text-lg font-bold text-slate-900" data-testid="owner-password-title">
          Trocar senha do mural
        </h3>
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-800" data-testid="owner-badge">
          Só você
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600" data-testid="owner-password-description">
        Quem já entrou continua com acesso. Novas entradas vão precisar da senha nova.
      </p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="owner-password-form" onSubmit={handleSubmit}>
        <label className="space-y-1 text-sm font-semibold text-slate-700" data-testid="owner-new-password-label">
          Nova senha
          <input
            autoComplete="new-password"
            className={inputClass}
            data-testid="owner-new-password-input"
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700" data-testid="owner-confirm-password-label">
          Repita a nova senha
          <input
            autoComplete="new-password"
            className={inputClass}
            data-testid="owner-confirm-password-input"
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            value={confirmPassword}
          />
        </label>
        {error && (
          <p className="text-sm font-medium text-rose-700 sm:col-span-2" data-testid="owner-password-error">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <button
            className="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-5 text-sm font-bold text-white transition-colors duration-200 hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            data-testid="owner-password-submit-button"
            disabled={!newPassword || !confirmPassword || changePassword.isPending}
            type="submit"
          >
            {changePassword.isPending ? "Salvando…" : "Salvar nova senha"}
          </button>
        </div>
      </form>
    </div>
  );
}
