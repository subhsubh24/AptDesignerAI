"use client";

/**
 * Chat-style refinement panel.
 *
 * Replaces the legacy "Something off?" textarea with a conversation thread
 * that records every user request and the assistant's patch + summary.
 * Designer warnings are surfaced inline below the assistant message that
 * triggered them.
 *
 * The panel is purely a controller — it doesn't own the analysis state.
 * Parent passes `onAnalysisUpdate` so the focus page can selectively
 * re-render only the fields that actually changed.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, AlertTriangle, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RefineMessage, DesignerWarning } from "@/lib/types/database";

interface RefineChatProps {
  roomId: string;
  /** Called when a patch produces a new analysis. Parent re-renders. */
  onAnalysisUpdate: (analysis: Record<string, unknown>, changedFields: string[]) => void;
  /** Called when palette/materials/direction change so parent can regen the vision preview. */
  onVisionShouldRegen?: () => void;
}

export function RefineChat({ roomId, onAnalysisUpdate, onVisionShouldRegen }: RefineChatProps) {
  const [messages, setMessages] = useState<RefineMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history on first expand
  useEffect(() => {
    if (collapsed || historyLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/area-analysis/refine-chat?room_id=${roomId}`);
        if (!res.ok) throw new Error("Failed to load chat history");
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages || []);
          setHistoryLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chat history");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [collapsed, historyLoaded, roomId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    const now = new Date().toISOString();
    // Optimistic user message
    const optimisticUser: RefineMessage = {
      id: `temp-user-${Date.now()}`,
      room_id: roomId,
      user_id: "",
      role: "user",
      content: trimmed,
      patch_json: null,
      warnings_json: null,
      analysis_snapshot: null,
      tokens_used: 0,
      created_at: now,
    };
    // Optimistic assistant placeholder so the user sees the chat ack immediately.
    const optimisticAssistant: RefineMessage = {
      id: `temp-assistant-${Date.now()}`,
      room_id: roomId,
      user_id: "",
      role: "assistant",
      content: "Re-running the full room assessment with your changes — this takes a couple of minutes…",
      patch_json: null,
      warnings_json: null,
      analysis_snapshot: null,
      tokens_used: 0,
      created_at: now,
    };
    setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
    setInput("");

    try {
      const res = await fetch("/api/area-analysis/refine-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, content: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Refinement failed");
      }
      const data = await res.json();

      // Replace optimistic placeholders with persisted user msg + assistant msg
      setMessages((prev) => {
        const cleaned = prev.filter(
          (m) => m.id !== optimisticUser.id && m.id !== optimisticAssistant.id,
        );
        return [...cleaned, data.user_message, data.assistant_message];
      });

      // Update parent analysis only if a patch actually applied
      const changedFields: string[] = data.changed_fields || [];
      if (changedFields.length > 0 && data.analysis) {
        onAnalysisUpdate(data.analysis, changedFields);
        // Regenerate the full-room Design Vision Preview whenever palette,
        // materials, style direction, or the item list changed. The preview
        // composites all what_it_needs items into the room shell, so adding
        // a throw blanket or swapping a sofa needs to be reflected there too.
        const visionRelevantFields = [
          "recommended_palette",
          "recommended_materials",
          "recommended_textures",
          "design_direction",
          "style_name",
          "what_it_needs",
        ];
        const shouldRegenVision = changedFields.some(
          (f) => visionRelevantFields.includes(f) || f.startsWith("what_it_needs."),
        );
        if (shouldRegenVision) onVisionShouldRegen?.();
      }
    } catch (err) {
      // Roll back optimistic messages on failure
      setMessages((prev) =>
        prev.filter((m) => m.id !== optimisticUser.id && m.id !== optimisticAssistant.id),
      );
      setInput(trimmed);
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  const headerHasUnread = !collapsed && messages.length > 0;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Chat with the designer</span>
          {messages.length > 0 && headerHasUnread && (
            <span className="text-xs text-muted-foreground">
              ({messages.filter((m) => m.role === "user").length} message{messages.filter((m) => m.role === "user").length === 1 ? "" : "s"})
            </span>
          )}
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <div className="border-t">
          {messages.length > 0 && (
            <div ref={scrollRef} className="max-h-96 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
            </div>
          )}

          {messages.length === 0 && historyLoaded && (
            <div className="px-4 py-6 text-center">
              <Sparkles className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Ask for tweaks: <em>&ldquo;swap the cognac sofa for cream&rdquo;</em>, <em>&ldquo;add a reading nook&rdquo;</em>, <em>&ldquo;make it cozier&rdquo;</em>.
              </p>
            </div>
          )}

          {error && (
            <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="border-t p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="What should change? (Cmd/Ctrl+Enter to send)"
              rows={2}
              disabled={sending}
              className="resize-none text-sm"
            />
            <Button onClick={send} disabled={sending || !input.trim()} size="sm" className="self-end">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatMessage({ message }: { message: RefineMessage }) {
  const isUser = message.role === "user";
  const warnings = (message.warnings_json as DesignerWarning[] | null) || [];
  const isPending = !isUser && message.id.startsWith("temp-assistant-");

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          isPending && "italic text-muted-foreground"
        )}
      >
        {isPending ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {message.content}
          </span>
        ) : (
          message.content
        )}
      </div>
      {!isUser && warnings.length > 0 && (
        <div className="max-w-[85%] space-y-1.5">
          {warnings.map((w, i) => (
            <DesignerWarningCard key={i} warning={w} />
          ))}
        </div>
      )}
    </div>
  );
}

function DesignerWarningCard({ warning }: { warning: DesignerWarning }) {
  const styles = {
    high: "bg-destructive/10 border-destructive/30 text-destructive",
    medium: "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
    low: "bg-muted border-border text-muted-foreground",
  } as const;

  return (
    <div className={cn("rounded-xl border px-3 py-2 text-xs", styles[warning.severity])}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium">{warning.message}</p>
          {warning.suggestion && (
            <p className="mt-1 opacity-80">→ {warning.suggestion}</p>
          )}
        </div>
      </div>
    </div>
  );
}
