import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";

interface FeedbackAdminItem {
  id: string;
  rating: number;
  decoration_rating: number;
  information_rating: number;
  project_name: string;
  suggestion: string;
  created_at: string;
}

interface FeedbackDeleteResult {
  deleted_count: number;
}

const faces: Record<number, string> = {
  1: "😡",
  2: "🙁",
  3: "😐",
  4: "😊",
  5: "🤩",
};

function ratingLabel(value: number) {
  return `${faces[value] ?? "⭐"} ${value}/5`;
}

export default function FeedbackManager() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const feedbackQuery = useQuery({
    queryKey: ["feedback-admin"],
    queryFn: () => apiGet<FeedbackAdminItem[]>("/feedback/manage"),
    retry: 1,
  });

  const deleteSelected = useMutation({
    mutationFn: (ids: string[]) =>
      apiPost<FeedbackDeleteResult>("/feedback/delete-selected", { ids }),
    onSuccess: async (result) => {
      setSelectedIds([]);
      await queryClient.invalidateQueries({ queryKey: ["feedback-admin"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback-summary"] });
      toast.success(
        result.deleted_count === 1
          ? "1 avaliação apagada dos resultados."
          : `${result.deleted_count} avaliações apagadas dos resultados.`,
      );
    },
    onError: () => toast.error("Não foi possível apagar as avaliações selecionadas."),
  });

  const entries = feedbackQuery.data ?? [];
  const allSelected = entries.length > 0 && selectedIds.length === entries.length;

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((selected) => selected !== id),
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : entries.map((entry) => entry.id));
  }

  function handleDelete() {
    if (!selectedIds.length) return;
    const confirmed = window.confirm(
      `Tem certeza de que deseja apagar ${selectedIds.length} avaliação(ões)? Essa ação é permanente e elas deixarão de contar nos resultados.`,
    );
    if (confirmed) deleteSelected.mutate(selectedIds);
  }

  return (
    <section
      className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6"
      data-testid="owner-feedback-manager"
    >
      <div className="flex items-center gap-2">
        <ClipboardList aria-hidden="true" className="size-5 text-amber-700" />
        <h3 className="font-heading text-lg font-bold text-slate-900">
          Gerenciar avaliações
        </h3>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
          Só você
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Marque as avaliações de teste ou duplicadas que deseja retirar dos resultados.
        As respostas continuam anônimas.
      </p>

      {feedbackQuery.isLoading && (
        <p className="mt-4 text-sm text-slate-600">Carregando avaliações…</p>
      )}
      {feedbackQuery.isError && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Não foi possível carregar a lista. Atualize a página e tente novamente.
        </p>
      )}

      {feedbackQuery.data && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 py-3">
            <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                checked={allSelected}
                className="size-4 accent-teal-700"
                data-testid="feedback-select-all"
                onChange={toggleAll}
                type="checkbox"
              />
              Selecionar todas ({entries.length})
            </label>
            <span className="text-xs font-semibold text-slate-500">
              {selectedIds.length} selecionada(s)
            </span>
          </div>

          {entries.length ? (
            <ul className="divide-y divide-slate-100" data-testid="owner-feedback-list">
              {entries.map((entry) => (
                <li
                  className="flex gap-3 py-4"
                  data-testid={`owner-feedback-${entry.id}`}
                  key={entry.id}
                >
                  <input
                    aria-label={`Selecionar avaliação de ${new Date(entry.created_at).toLocaleString("pt-BR")}`}
                    checked={selectedIds.includes(entry.id)}
                    className="mt-1 size-4 shrink-0 accent-teal-700"
                    data-testid={`owner-feedback-checkbox-${entry.id}`}
                    onChange={(event) => toggleOne(entry.id, event.target.checked)}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">
                        {entry.project_name || "Apresentação geral"}
                      </p>
                      <time className="text-xs text-slate-500">
                        {new Date(entry.created_at).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                      <span>Decoração: {ratingLabel(entry.decoration_rating)}</span>
                      <span>Apresentação: {ratingLabel(entry.rating)}</span>
                      <span>Informações: {ratingLabel(entry.information_rating)}</span>
                    </div>
                    {entry.suggestion ? (
                      <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#FAF9F5] p-3 text-sm leading-relaxed text-slate-700">
                        “{entry.suggestion}”
                      </p>
                    ) : (
                      <p className="mt-2 text-xs italic text-slate-500">
                        Somente notas e emojis; sem comentário escrito.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-[#FAF9F5] p-4 text-sm text-slate-600">
              Ainda não existem avaliações cadastradas.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              A exclusão é permanente e atualiza as médias e os gráficos.
            </p>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white transition-colors duration-200 hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              data-testid="feedback-delete-selected"
              disabled={!selectedIds.length || deleteSelected.isPending}
              onClick={handleDelete}
              type="button"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {deleteSelected.isPending
                ? "Apagando…"
                : `Apagar selecionadas (${selectedIds.length})`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
