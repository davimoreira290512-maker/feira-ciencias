import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Lock, MessagesSquare, Send, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPost, apiUpload } from "@/lib/api";
import type { AuthorizedMuralUser, AuthUser } from "@/lib/auth";
import { photoUrl, type MuralMessage, type MuralMessageCreate, type MuralPhotoUpload } from "@/lib/mural";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EVERYONE = "everyone";
const MAX_PHOTOS = 4;

interface PendingPhoto {
  id: string;
  preview: string;
}

interface MuralMessagesProps {
  me: AuthUser;
  people: AuthorizedMuralUser[];
}

function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body) {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export default function MuralMessages({ me, people }: MuralMessagesProps) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState<string>(EVERYONE);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Private messages flagged new during this visit stay highlighted until the user leaves the mural,
  // even though later polls (which already count as "read") return them with is_new = false.
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());

  const others = people.filter((person) => person.user_id !== me.user_id);
  const labels: Record<string, string> = { [EVERYONE]: "Todos do mural" };
  for (const person of others) labels[person.user_id] = person.name;
  // A recipient who lost access falls back to "everyone".
  const activeRecipient = labels[recipient] ? recipient : EVERYONE;

  const messagesQuery = useQuery({
    queryKey: ["mural-messages"],
    queryFn: async () => {
      const messages = await apiGet<MuralMessage[]>("/mural/messages");
      const fresh = messages.filter((message) => message.is_new).map((message) => message.id);
      if (fresh.length) setNewIds((current) => new Set([...current, ...fresh]));
      return messages;
    },
    refetchInterval: 15_000,
    retry: 1,
  });

  const sendMessage = useMutation({
    mutationFn: (payload: MuralMessageCreate) =>
      apiPost<MuralMessage>("/mural/messages", payload),
    onSuccess: async () => {
      setBody("");
      for (const photo of photos) URL.revokeObjectURL(photo.preview);
      setPhotos([]);
      await queryClient.invalidateQueries({ queryKey: ["mural-messages"] });
      toast.success("Mensagem enviada.");
    },
    onError: (error) => {
      toast.error(errorDetail(error, "Não foi possível enviar a mensagem."));
    },
  });

  const deleteMessage = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/mural/messages/${id}`),
    onSuccess: async () => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["mural-messages"] });
      toast.success("Mensagem apagada.");
    },
    onError: (error) => {
      toast.error(errorDetail(error, "Não foi possível apagar a mensagem."));
    },
  });

  async function handlePickPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const room = MAX_PHOTOS - photos.length - uploading;
    if (files.length > room) toast.error(`Você pode anexar até ${MAX_PHOTOS} fotos por mensagem.`);
    const chosen = files.slice(0, Math.max(room, 0));
    if (!chosen.length) return;
    setUploading((n) => n + chosen.length);
    await Promise.all(
      chosen.map(async (file) => {
        const form = new FormData();
        form.append("file", file);
        try {
          const uploaded = await apiUpload<MuralPhotoUpload>("/mural/photos", form);
          setPhotos((current) => [...current, { id: uploaded.id, preview: URL.createObjectURL(file) }]);
        } catch (error) {
          toast.error(errorDetail(error, "Não foi possível enviar a foto."));
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((photo) => photo.id !== id);
    });
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!body.trim() && !photos.length) || uploading) return;
    sendMessage.mutate({
      body,
      recipient_user_id: activeRecipient === EVERYONE ? null : activeRecipient,
      photo_ids: photos.map((photo) => photo.id),
    });
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="mural-messages-card">
      <div className="flex items-center gap-2">
        <MessagesSquare aria-hidden="true" className="size-5 text-teal-700" />
        <h3 className="font-heading text-lg font-bold text-slate-900" data-testid="mural-messages-title">
          Mensagens do mural
        </h3>
      </div>
      <p className="mt-1 text-sm text-slate-600" data-testid="mural-messages-description">
        Só quem tem acesso ao mural vê estas mensagens. Mensagens privadas aparecem apenas para quem enviou e quem recebeu.
      </p>

      <form className="mt-4 space-y-3 rounded-2xl bg-[#FAF9F5] p-4" data-testid="mural-message-form" onSubmit={handleSend}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700" data-testid="mural-message-recipient-label">
            Para:
          </span>
          <Select value={activeRecipient} onValueChange={setRecipient}>
            <SelectTrigger className="h-10 min-w-48 bg-white" data-testid="mural-message-recipient-select">
              <SelectValue>{(value) => labels[value as string] ?? labels[EVERYONE]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem data-testid="mural-message-recipient-everyone" value={EVERYONE}>
                Todos do mural
              </SelectItem>
              {others.map((person) => (
                <SelectItem
                  data-testid={`mural-message-recipient-${person.user_id}`}
                  key={person.user_id}
                  value={person.user_id}
                >
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <textarea
          className="min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10"
          data-testid="mural-message-input"
          maxLength={1000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            activeRecipient === EVERYONE
              ? "Escreva para todos do mural…"
              : `Mensagem privada para ${labels[activeRecipient]}…`
          }
          value={body}
        />
        {(photos.length > 0 || uploading > 0) && (
          <div className="grid grid-cols-4 gap-2" data-testid="mural-message-photo-previews">
            {photos.map((photo, index) => (
              <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-white" key={photo.id}>
                <img alt={`Foto ${index + 1} anexada`} className="size-full object-cover" data-testid={`mural-photo-preview-${index}`} src={photo.preview} />
                <button
                  aria-label="Remover foto"
                  className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-slate-900/70 text-white transition-colors duration-200 hover:bg-slate-900"
                  data-testid={`mural-photo-remove-${index}`}
                  onClick={() => removePhoto(photo.id)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, index) => (
              <div
                className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-teal-300 bg-teal-50"
                data-testid="mural-photo-uploading"
                key={`uploading-${index}`}
              >
                <Loader2 aria-hidden="true" className="size-5 animate-spin text-teal-700" />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            data-testid="mural-photo-input"
            multiple
            onChange={handlePickPhotos}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition-colors duration-200 hover:border-teal-600 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="mural-photo-add-button"
            disabled={photos.length + uploading >= MAX_PHOTOS}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <ImagePlus aria-hidden="true" className="size-4" />
            Fotos ({photos.length + uploading}/{MAX_PHOTOS})
          </button>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white transition-colors duration-200 hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          data-testid="mural-message-send-button"
          disabled={(!body.trim() && !photos.length) || uploading > 0 || sendMessage.isPending}
          type="submit"
        >
          <Send aria-hidden="true" className="size-4" />
          {sendMessage.isPending ? "Enviando…" : uploading ? "Enviando fotos…" : "Enviar mensagem"}
        </button>
        </div>
      </form>

      {messagesQuery.isLoading && (
        <p className="mt-4 text-sm text-slate-600" data-testid="mural-messages-loading">
          Carregando mensagens…
        </p>
      )}
      {messagesQuery.isError && (
        <p className="mt-4 text-sm text-amber-900" data-testid="mural-messages-error">
          Não foi possível carregar as mensagens agora.
        </p>
      )}
      {messagesQuery.data && !messagesQuery.isError && (
        messagesQuery.data.length ? (
          <>
          {(() => {
            const newCount = messagesQuery.data.filter((message) => newIds.has(message.id)).length;
            return newCount > 0 ? (
              <p
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800"
                data-testid="mural-messages-new-summary"
              >
                <span aria-hidden="true" className="size-2 rounded-full bg-rose-600" />
                {newCount === 1 ? "1 mensagem privada nova" : `${newCount} mensagens privadas novas`}
              </p>
            ) : null;
          })()}
          <ul className="mt-4 space-y-3" data-testid="mural-messages-list">
            {messagesQuery.data.map((message) => {
              const isPrivate = message.recipient_user_id !== null;
              const isNew = newIds.has(message.id);
              const mine = message.sender_user_id === me.user_id;
              const audience = !isPrivate
                ? "para todos"
                : mine
                  ? `privada para ${message.recipient_name ?? "membro"}`
                  : "privada para você";
              return (
                <li
                  className={`rounded-2xl border p-4 ${
                    isNew
                      ? "new-message-glow border-rose-300 bg-rose-50 ring-2 ring-rose-200"
                      : isPrivate
                        ? "border-amber-200 bg-amber-50/60"
                        : "border-slate-100 bg-[#FAF9F5]"
                  }`}
                  data-new={isNew ? "true" : undefined}
                  data-testid={`mural-message-${message.id}`}
                  key={message.id}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    {isNew && (
                      <span
                        className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white"
                        data-testid={`mural-message-new-badge-${message.id}`}
                      >
                        Nova
                      </span>
                    )}
                    <span className="text-sm font-bold text-slate-900" data-testid={`mural-message-sender-${message.id}`}>
                      {mine ? "Você" : message.sender_name}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 font-semibold"
                      data-testid={`mural-message-audience-${message.id}`}
                    >
                      {isPrivate ? <Lock aria-hidden="true" className="size-3" /> : <Users aria-hidden="true" className="size-3" />}
                      {audience}
                    </span>
                    <span data-testid={`mural-message-time-${message.id}`}>
                      {new Date(message.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    {(mine || me.is_owner) && (
                      <span className="ml-auto flex items-center gap-1.5">
                        {pendingDelete === message.id ? (
                          <>
                            <button
                              className="min-h-8 rounded-lg bg-rose-700 px-2.5 text-xs font-bold text-white transition-colors duration-200 hover:bg-rose-800 disabled:bg-slate-300"
                              data-testid={`mural-message-confirm-delete-${message.id}`}
                              disabled={deleteMessage.isPending}
                              onClick={() => deleteMessage.mutate(message.id)}
                              type="button"
                            >
                              {deleteMessage.isPending ? "Apagando…" : "Apagar"}
                            </button>
                            <button
                              className="min-h-8 rounded-lg px-2.5 text-xs font-semibold text-slate-600 transition-colors duration-200 hover:bg-white"
                              data-testid={`mural-message-cancel-delete-${message.id}`}
                              onClick={() => setPendingDelete(null)}
                              type="button"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            aria-label="Apagar mensagem"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors duration-200 hover:bg-rose-50 hover:text-rose-700"
                            data-testid={`mural-message-delete-${message.id}`}
                            onClick={() => setPendingDelete(message.id)}
                            title={mine ? "Apagar minha mensagem" : "Apagar mensagem (dono)"}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {message.body && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700" data-testid={`mural-message-body-${message.id}`}>
                      {message.body}
                    </p>
                  )}
                  {message.photo_ids.length > 0 && (
                    <div
                      className={`mt-3 grid gap-2 ${message.photo_ids.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
                      data-testid={`mural-message-photos-${message.id}`}
                    >
                      {message.photo_ids.map((photoId, index) => (
                        <a
                          className="group block overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                          data-testid={`mural-message-photo-${message.id}-${index}`}
                          href={photoUrl(photoId)}
                          key={photoId}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <img
                            alt={`Foto ${index + 1} de ${mine ? "você" : message.sender_name}`}
                            className={`w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${message.photo_ids.length === 1 ? "max-h-80" : "aspect-square"}`}
                            loading="lazy"
                            src={photoUrl(photoId)}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-600" data-testid="mural-messages-empty">
            Nenhuma mensagem ainda. Comece a conversa!
          </p>
        )
      )}
    </div>
  );
}
