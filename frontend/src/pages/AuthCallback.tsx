import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, apiPost } from "@/lib/api";
import type { AuthUser } from "@/lib/auth";
import { beginSession } from "@/lib/session";

interface AuthCallbackProps {
  sessionId: string;
}

export default function AuthCallback({ sessionId }: AuthCallbackProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const processed = useRef(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    "Não foi possível validar a entrada Google. Tente novamente.",
  );

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    apiPost<AuthUser>("/auth/session", {
      session_id: sessionId,
    })
      .then((user) => {
        beginSession();
        queryClient.setQueryData(["auth-me"], user);
        navigate("/?view=mural", { replace: true });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && typeof error.body === "object" && error.body) {
          const detail = (error.body as { detail?: unknown }).detail;
          if (typeof detail === "string") setErrorMessage(detail);
        }
        setHasError(true);
      });
  }, [navigate, queryClient, sessionId]);

  if (hasError) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[#FAF9F5] p-5">
        <section className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-6 shadow-sm" data-testid="google-login-error">
          <h1 className="font-heading text-xl font-bold text-slate-900" data-testid="google-login-error-title">
            Não foi possível confirmar sua conta Google
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600" data-testid="google-login-error-copy">
            {errorMessage} A avaliação anônima continua disponível.
          </p>
          <a
            className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-teal-700 px-5 font-bold text-white transition-colors duration-200 hover:bg-teal-800"
            data-testid="google-login-error-return"
            href="/?view=mural"
          >
            Voltar ao mural
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#FAF9F5] p-5">
      <p className="text-sm font-semibold text-slate-600" data-testid="google-login-processing">
        Conectando à sua conta Google…
      </p>
    </main>
  );
}