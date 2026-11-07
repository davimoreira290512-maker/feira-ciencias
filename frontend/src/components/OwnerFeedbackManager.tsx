import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet } from "@/lib/api";

interface FeedbackAdminItem {
  id: string;
  rating: number;
  decoration_rating: number;
  information_rating: number;
  project_name: string;
  suggestion: string;
  created_at: string;
}

const ratingFaces: Record<number, string> = {
  1: "😡",
  2: "🙁",
  3: "😐",
  4: "😊",
  5: "🤩",
};

function ratingLabel(value: number): string {
  return (ratingFaces[value] ?? "⭐") + " " + value + "/5";
}

export default function OwnerFeedbackManager() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const feedbackQuery = useQuery({
    queryKey: ["owner-feedback"],
    queryFn: () => apiGet<FeedbackAdminItem[]>("/feedback/manage"),
    retry: 1,
  });

  const deleteFeedback = useMutation({
    mutationFn: (id: string) => apiDelete<void>("/feedback/" + encodeURIComponent(id)),
    onSuccess: async () => {
      setPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-feedback"] }),
        queryClient.invalidateQueries({ queryKey: ["feedback-summary"] }),
      ]);
      toast.success("Avaliação excluída. Os resultados foram atualizados.");
    },
    onError: () => {
      toast.error("Não foi possível excluir esta avaliação. Tente novamente.");
    },
  });

  return (
    <section
      className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6"
      data-testid="owner-feedback-manager"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="size-5 text-teal-700" />
        <h3 className="font-heading text-lg font-bold text-slate-900">
          Gerenciar avaliações
        </h3>
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-800">
          Só o dono
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Aqui você pode revisar cada avaliação anônima e remover somente as que foram feitas para teste.
        A exclusão é permanente e atualiza as médias e os gráficos.
      </p>

      {feedbackQuery.isLoading && (
        <p className="mt-4 text-sm text-slate-600" data-testid="owner-feedback-loading">
          Carregando avaliações…
        </p>
      )}
      {feedbackQuery.isError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900" data-testid="owner-feedback-error">
            Não foi possível carregar a lista de avaliações.
          </p>
          <button
            className="mt-2 text-sm font-bold text-teal-800 underline"
            onClick={() => void feedbackQuery.refetch()}
            type="button"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {feedbackQuery.data && !feedbackQuery.isError && (
        feedbackQuery.data.length ? (
          <div className="mt-4 space-y-3" data-testid="owner-feedback-list">
            <p className="text-xs font-semibold text-slate-500" data-testid="owner-feedback-count">
              {feedbackQuery.data.length} avaliação(ões) encontrada(s)
            </p>
            {feedbackQuery.data.map((item, index) => (
              <article
                className="rounded-2xl border border-slate-200 bg-[#FAF9F5] p-4"
                data-testid={"owner-feedback-item-" + index}
                key={item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">
                      {item.project_name || "Apresentação geral"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(item.created_at).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  {pendingDelete === item.id ? (
                    <div className="flex flex-wrap items-center gap-2" data-testid={"owner-feedback-confirm-" + index}>
                      <span className="w-full text-xs font-semibold text-rose-800">
                        Excluir permanentemente?
                      </span>
                      <button
                        className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-bold text-white hover:bg-rose-800 disabled:opacity-50"
                        disabled={deleteFeedback.isPending}
                        onClick={() => deleteFeedback.mutate(item.id)}
                        type="button"
                      >
                        {deleteFeedback.isPending ? "Excluindo…" : "Sim, excluir"}
                      </button>
                      <button
                        className="min-h-9 rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-white"
                        onClick={() => setPendingDelete(null)}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      aria-label={"Excluir avaliação " + (index + 1)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50"
                      data-testid={"owner-feedback-delete-" + index}
                      onClick={() => setPendingDelete(item.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Excluir
                    </button>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-white p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Decoração</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{ratingLabel(item.decoration_rating)}</p>
                  </div>
                  <div className="rounded-xl bg-white p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Apresentação</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{ratingLabel(item.rating)}</p>
                  </div>
                  <div className="rounded-xl bg-white p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Informações</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">{ratingLabel(item.information_rating)}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-white p-3">
                  <p className="text-xs font-bold text-slate-600">Comentário escrito</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {item.suggestion?.trim() || "Nenhum comentário escrito nesta avaliação."}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-[#FAF9F5] p-4 text-sm text-slate-600" data-testid="owner-feedback-empty">
            Ainda não há avaliações para gerenciar.
          </p>
        )
      )}
    </section>
  );
}
