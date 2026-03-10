"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Briefcase,
  CheckCircle2,
  CreditCard,
  FileText,
  Film,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wrench,
} from "lucide-react";
import type {
  LucideIcon,
} from "lucide-react";
import type {
  ToolCatalogItem,
  ToolConnectionType,
  UserToolEventRecord,
  UserToolRecord,
} from "@/lib/types";
import { fmtFull } from "@/lib/utils";
import {
  connectTool,
  fetchToolEvents,
  fetchToolsCatalog,
  fetchUserTools,
  reconnectTool,
  removeTool,
  setToolEnabled,
} from "@/services/tools";

const ICON_BY_KEY: Record<string, LucideIcon> = {
  stripe: CreditCard,
  netflix: Film,
  notion: FileText,
  gmail: Mail,
  linkedin: Briefcase,
};

const ICON_BY_ICON_NAME: Record<string, LucideIcon> = {
  stripe: CreditCard,
  netflix: Film,
  notion: FileText,
  gmail: Mail,
  linkedin: Briefcase,
};

function toolIcon(tool: UserToolRecord | null): LucideIcon {
  if (!tool) return AppWindow;
  const fromIconName = tool.tool.iconName ? ICON_BY_ICON_NAME[tool.tool.iconName] : null;
  if (fromIconName) return fromIconName;
  const fromKey = ICON_BY_KEY[tool.tool.key];
  if (fromKey) return fromKey;
  return Wrench;
}

function catalogIcon(catalog: ToolCatalogItem | null): LucideIcon {
  if (!catalog) return AppWindow;
  const fromIconName = catalog.iconName ? ICON_BY_ICON_NAME[catalog.iconName] : null;
  if (fromIconName) return fromIconName;
  const fromKey = ICON_BY_KEY[catalog.key];
  if (fromKey) return fromKey;
  return Wrench;
}

function statusLabel(tool: UserToolRecord): "Connected" | "Disabled" | "Needs login" {
  if (!tool.enabled) return "Disabled";
  if (tool.status === "connected") return "Connected";
  return "Needs login";
}

function statusClasses(tool: UserToolRecord): string {
  const status = statusLabel(tool);
  if (status === "Connected") {
    return "border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.1)] text-[var(--aw-success)]";
  }
  if (status === "Disabled") {
    return "border-[var(--aw-border)] bg-[var(--aw-surface-subtle)] text-[var(--aw-text-muted)]";
  }
  return "border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.12)] text-[var(--aw-warning)]";
}

function connectionLabel(connectionType: ToolConnectionType): string {
  if (connectionType === "password") return "Connected with password";
  if (connectionType === "oauth") return "Connected with OAuth";
  if (connectionType === "api_key") return "Connected with API key";
  return "Connected with session";
}

function createdByLabel(tool: UserToolRecord): string {
  if (tool.createdBy === "signup_flow") return "Created after signup";
  if (tool.createdBy === "oauth") return "OAuth";
  if (tool.createdBy === "imported") return "Imported";
  return "Manual";
}

function safeDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "Not available";
  return fmtFull(value);
}

function eventLabel(eventType: UserToolEventRecord["eventType"]): string {
  if (eventType === "connected") return "Connected";
  if (eventType === "updated") return "Updated";
  if (eventType === "login_used") return "Login used";
  if (eventType === "login_failed") return "Login failed";
  if (eventType === "disabled") return "Disabled";
  if (eventType === "enabled") return "Enabled";
  if (eventType === "removed") return "Removed";
  return "Created after signup";
}

function eventDotClass(eventType: UserToolEventRecord["eventType"]): string {
  if (eventType === "login_failed") return "bg-[var(--aw-danger)]";
  if (eventType === "disabled" || eventType === "removed") return "bg-[var(--aw-warning)]";
  return "bg-[var(--aw-primary)]";
}

function normalizeToolKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function ToolsPage() {
  const [catalog, setCatalog] = useState<ToolCatalogItem[]>([]);
  const [tools, setTools] = useState<UserToolRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [events, setEvents] = useState<UserToolEventRecord[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [isSubmittingConnect, setIsSubmittingConnect] = useState(false);
  const [connectMode, setConnectMode] = useState<"catalog" | "manual">("catalog");
  const [selectedCatalogKey, setSelectedCatalogKey] = useState("");
  const [manualToolKey, setManualToolKey] = useState("");
  const [manualDisplayName, setManualDisplayName] = useState("");
  const [connectionType, setConnectionType] = useState<ToolConnectionType>("password");
  const [connectLoginIdentifier, setConnectLoginIdentifier] = useState("");
  const [connectLabel, setConnectLabel] = useState("");
  const [connectSecret, setConnectSecret] = useState("");

  const [isSavingToolId, setIsSavingToolId] = useState<string | null>(null);
  const [reconnectSecret, setReconnectSecret] = useState("");
  const [reconnectIdentifier, setReconnectIdentifier] = useState("");

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) || null,
    [tools, selectedToolId],
  );

  const selectedCatalog = useMemo(
    () => catalog.find((item) => item.key === selectedCatalogKey) || null,
    [catalog, selectedCatalogKey],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [catalogData, toolsData] = await Promise.all([
        fetchToolsCatalog(),
        fetchUserTools(),
      ]);
      setCatalog(catalogData);
      setTools(toolsData);

      if (!selectedCatalogKey && catalogData.length > 0) {
        setSelectedCatalogKey(catalogData[0].key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tools");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCatalogKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedToolId) {
      setEvents([]);
      setEventsError(null);
      return;
    }

    void (async () => {
      setIsLoadingEvents(true);
      setEventsError(null);
      try {
        const data = await fetchToolEvents(selectedToolId);
        setEvents(data);
      } catch (err) {
        setEvents([]);
        setEventsError(
          err instanceof Error ? err.message : "Failed to load recent events",
        );
      } finally {
        setIsLoadingEvents(false);
      }
    })();
  }, [selectedToolId]);

  const submitConnect = async () => {
    if (!connectSecret.trim()) {
      setError("Secret is required.");
      return;
    }

    const toolKey = connectMode === "catalog"
      ? selectedCatalog?.key || ""
      : normalizeToolKey(manualToolKey);

    if (!toolKey) {
      setError("Tool is required.");
      return;
    }

    setIsSubmittingConnect(true);
    setError(null);
    try {
      const connected = await connectTool({
        toolKey,
        displayName: connectMode === "catalog"
          ? selectedCatalog?.displayName
          : (manualDisplayName.trim() || undefined),
        category: connectMode === "catalog" ? (selectedCatalog?.category || undefined) : undefined,
        loginUrl: connectMode === "catalog" ? (selectedCatalog?.loginUrl || undefined) : undefined,
        signupUrl: connectMode === "catalog" ? (selectedCatalog?.signupUrl || undefined) : undefined,
        supportsOauth: connectMode === "catalog" ? selectedCatalog?.supportsOauth : undefined,
        supportsPasswordLogin: connectMode === "catalog" ? selectedCatalog?.supportsPasswordLogin : undefined,
        supportsApiKey: connectMode === "catalog" ? selectedCatalog?.supportsApiKey : undefined,
        connectionType,
        secret: connectSecret.trim(),
        label: connectLabel.trim() || undefined,
        loginIdentifier: connectLoginIdentifier.trim() || undefined,
      });

      setTools((prev) => {
        const existing = prev.find((item) => item.id === connected.id);
        if (!existing) return [connected, ...prev];
        return prev.map((item) => (item.id === connected.id ? connected : item));
      });

      setConnectSecret("");
      setConnectLoginIdentifier("");
      setConnectLabel("");
      if (connectMode === "manual") {
        setManualToolKey("");
        setManualDisplayName("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect tool");
    } finally {
      setIsSubmittingConnect(false);
    }
  };

  const toggleEnabled = async (tool: UserToolRecord, enabled: boolean) => {
    setIsSavingToolId(tool.id);
    setError(null);
    try {
      const updated = await setToolEnabled({
        userToolId: tool.id,
        enabled,
      });
      setTools((prev) => prev.map((item) => (item.id === tool.id ? updated : item)));
      if (selectedToolId === tool.id) {
        setSelectedToolId(updated.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tool status");
    } finally {
      setIsSavingToolId(null);
    }
  };

  const submitReconnect = async (tool: UserToolRecord) => {
    if (!reconnectSecret.trim()) {
      setEventsError("Secret is required.");
      return;
    }

    setIsSavingToolId(tool.id);
    setEventsError(null);
    try {
      const updated = await reconnectTool({
        userToolId: tool.id,
        secret: reconnectSecret.trim(),
        connectionType: tool.connectionType,
        loginIdentifier: reconnectIdentifier.trim() || undefined,
      });

      setTools((prev) => prev.map((item) => (item.id === tool.id ? updated : item)));
      setReconnectSecret("");
      setReconnectIdentifier("");
      setSelectedToolId(updated.id);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : "Failed to reconnect tool");
    } finally {
      setIsSavingToolId(null);
    }
  };

  const submitRemove = async (tool: UserToolRecord) => {
    const shouldRemove = window.confirm(`Remove ${tool.tool.displayName}?`);
    if (!shouldRemove) return;

    setIsSavingToolId(tool.id);
    setError(null);
    try {
      await removeTool({ userToolId: tool.id, deleteSecrets: true });
      setTools((prev) => prev.filter((item) => item.id !== tool.id));
      if (selectedToolId === tool.id) {
        setSelectedToolId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove tool");
    } finally {
      setIsSavingToolId(null);
    }
  };

  return (
    <div className="aw-page">
      <div className="aw-page-header">
        <p className="aw-page-kicker">Tools</p>
        <h1 className="aw-page-title">Tools</h1>
        <p className="aw-page-subtitle">Connected apps and saved logins</p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-[var(--aw-danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="aw-surface p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="aw-kicker">Connected tools</p>
              <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">
                Connected tools list
              </h2>
            </div>
            <button
              onClick={() => {
                void load();
              }}
              className="aw-button-secondary px-3 py-1.5 text-xs"
              disabled={isLoading}
            >
              <span className="inline-flex items-center gap-1">
                <RefreshCw size={12} />
                Refresh
              </span>
            </button>
          </div>

          {isLoading ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-3 text-sm text-[var(--aw-text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Loading tools...
            </div>
          ) : tools.length === 0 ? (
            <div className="aw-empty-state mt-4 px-3 py-5">
              <p className="text-sm font-medium text-[var(--aw-text-soft)]">No tools yet</p>
              <p className="mt-1 text-xs text-[var(--aw-text-muted)]">Connected apps will show up here.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <div className="hidden grid-cols-[minmax(0,1.15fr)_0.65fr_0.95fr_0.95fr_0.85fr_0.75fr] gap-2 px-2 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)] md:grid">
                <span>Tool</span>
                <span>Status</span>
                <span>Connection</span>
                <span>Login</span>
                <span>Created</span>
                <span>Last used</span>
              </div>

              {tools.map((tool) => {
                const ToolIcon = toolIcon(tool);
                return (
                  <article
                    key={tool.id}
                    className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-3"
                  >
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.15fr)_0.65fr_0.95fr_0.95fr_0.85fr_0.75fr] md:items-center">
                      <div className="min-w-0">
                        <button
                          onClick={() => {
                            setSelectedToolId(tool.id);
                            setReconnectIdentifier("");
                            setReconnectSecret("");
                          }}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--aw-border)] bg-white text-[var(--aw-primary-strong)]">
                            <ToolIcon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[var(--aw-text)]">
                              {tool.tool.displayName}
                            </span>
                            <span className="block truncate text-xs text-[var(--aw-text-muted)]">
                              {tool.label || tool.tool.key}
                            </span>
                          </span>
                        </button>
                      </div>

                      <div>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusClasses(tool)}`}>
                          {statusLabel(tool)}
                        </span>
                        <p className="mt-1 text-[11px] text-[var(--aw-text-muted)]">
                          {tool.enabled ? "Enabled" : "Disabled"}
                        </p>
                      </div>

                      <p className="text-xs text-[var(--aw-text-soft)]">
                        {connectionLabel(tool.connectionType)}
                      </p>

                      <p className="text-xs text-[var(--aw-text-soft)]">
                        {tool.loginIdentifierMasked || "Not available"}
                      </p>

                      <p className="text-xs text-[var(--aw-text-soft)]">
                        {createdByLabel(tool)}
                      </p>

                      <p className="text-xs text-[var(--aw-text-soft)]">
                        {safeDate(tool.lastUsedAt)}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--aw-border)] pt-2">
                      <button
                        onClick={() => {
                          setSelectedToolId(tool.id);
                          setReconnectIdentifier("");
                          setReconnectSecret("");
                        }}
                        className="aw-button-secondary px-2.5 py-1 text-[11px]"
                      >
                        Details
                      </button>

                      <button
                        onClick={() => {
                          void toggleEnabled(tool, !tool.enabled);
                        }}
                        className="aw-button-secondary px-2.5 py-1 text-[11px]"
                        disabled={isSavingToolId === tool.id}
                      >
                        {tool.enabled ? "Disable" : "Enable"}
                      </button>

                      <button
                        onClick={() => {
                          setSelectedToolId(tool.id);
                          setReconnectIdentifier("");
                          setReconnectSecret("");
                        }}
                        className="aw-button-secondary px-2.5 py-1 text-[11px]"
                      >
                        Reconnect
                      </button>

                      <button
                        onClick={() => {
                          void submitRemove(tool);
                        }}
                        className="aw-button-secondary px-2.5 py-1 text-[11px] text-[var(--aw-danger)]"
                        disabled={isSavingToolId === tool.id}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="aw-surface p-4 md:p-5">
          <div>
            <p className="aw-kicker">Add tool</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--aw-text)]">Connect a tool</h2>
            <p className="mt-1 text-sm text-[var(--aw-text-soft)]">
              Save a login so the agent can use it later.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setConnectMode("catalog")}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                connectMode === "catalog"
                  ? "border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]"
                  : "border-[var(--aw-border)] bg-[var(--aw-surface-muted)] text-[var(--aw-text-soft)]"
              }`}
            >
              From catalog
            </button>
            <button
              onClick={() => setConnectMode("manual")}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                connectMode === "manual"
                  ? "border-[var(--aw-border-strong)] bg-[var(--aw-primary-soft)] text-[var(--aw-primary-strong)]"
                  : "border-[var(--aw-border)] bg-[var(--aw-surface-muted)] text-[var(--aw-text-soft)]"
              }`}
            >
              Manual
            </button>
          </div>

          {connectMode === "catalog" ? (
            <div className="mt-3 space-y-2">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Tool</span>
                <select
                  value={selectedCatalogKey}
                  onChange={(event) => setSelectedCatalogKey(event.target.value)}
                  className="aw-input h-10 text-sm"
                >
                  {catalog.map((item) => (
                    <option key={item.id} value={item.key}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>

              {selectedCatalog && (
                <div className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--aw-border)] bg-white text-[var(--aw-primary-strong)]">
                      {(() => {
                        const Icon = catalogIcon(selectedCatalog);
                        return <Icon size={14} />;
                      })()}
                    </span>
                    <p className="text-sm font-medium text-[var(--aw-text)]">
                      {selectedCatalog.displayName}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--aw-text-muted)]">
                    {selectedCatalog.loginUrl || "Login URL not available"}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Tool key</span>
                <input
                  value={manualToolKey}
                  onChange={(event) => setManualToolKey(event.target.value)}
                  className="aw-input h-10 text-sm"
                  placeholder="stripe"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--aw-text-muted)]">Display name</span>
                <input
                  value={manualDisplayName}
                  onChange={(event) => setManualDisplayName(event.target.value)}
                  className="aw-input h-10 text-sm"
                  placeholder="Stripe"
                />
              </label>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Connection type</span>
              <select
                value={connectionType}
                onChange={(event) => setConnectionType(event.target.value as ToolConnectionType)}
                className="aw-input h-10 text-sm"
              >
                <option value="password">Password</option>
                <option value="oauth">OAuth</option>
                <option value="api_key">API key</option>
                <option value="session">Session</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Login identifier</span>
              <input
                value={connectLoginIdentifier}
                onChange={(event) => setConnectLoginIdentifier(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="you@company.com"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Label</span>
              <input
                value={connectLabel}
                onChange={(event) => setConnectLabel(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Work account"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-[var(--aw-text-muted)]">Secret</span>
              <input
                type="password"
                value={connectSecret}
                onChange={(event) => setConnectSecret(event.target.value)}
                className="aw-input h-10 text-sm"
                placeholder="Enter password or token"
              />
            </label>
          </div>

          <button
            onClick={() => {
              void submitConnect();
            }}
            className="aw-button-primary mt-4 h-10 w-full text-sm"
            disabled={isSubmittingConnect || isLoading}
          >
            {isSubmittingConnect ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" />
                Connecting
              </span>
            ) : (
              "Connect"
            )}
          </button>
        </section>
      </div>

      {selectedTool && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(15,23,42,0.24)] p-3 backdrop-blur-[2px] md:items-center md:p-6">
          <section className="aw-surface-elevated w-full max-w-3xl p-4 md:p-5 animate-sheet-rise">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--aw-border)] bg-white text-[var(--aw-primary-strong)]">
                  {(() => {
                    const Icon = toolIcon(selectedTool);
                    return <Icon size={16} />;
                  })()}
                </span>
                <div>
                  <p className="aw-kicker">Tool details</p>
                  <h3 className="text-base font-semibold text-[var(--aw-text)]">
                    {selectedTool.tool.displayName}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedToolId(null);
                  setEvents([]);
                  setEventsError(null);
                  setReconnectSecret("");
                }}
                className="aw-button-secondary px-3 py-1.5 text-xs"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Status</p>
                <p className="mt-1 text-sm font-medium text-[var(--aw-text)]">{statusLabel(selectedTool)}</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{selectedTool.enabled ? "Enabled" : "Disabled"}</p>
              </article>

              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Connection</p>
                <p className="mt-1 text-sm font-medium text-[var(--aw-text)]">{connectionLabel(selectedTool.connectionType)}</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">{createdByLabel(selectedTool)}</p>
              </article>

              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Masked login</p>
                <p className="mt-1 text-sm font-medium text-[var(--aw-text)]">{selectedTool.loginIdentifierMasked || "Not available"}</p>
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">Last verified: {safeDate(selectedTool.lastVerifiedAt)}</p>
              </article>

              <article className="rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Links</p>
                {selectedTool.tool.loginUrl ? (
                  <a
                    href={selectedTool.tool.loginUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm text-[var(--aw-primary)] transition-colors hover:text-[var(--aw-primary-strong)]"
                  >
                    <Link2 size={13} />
                    Login URL
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-[var(--aw-text-soft)]">Not available</p>
                )}
                <p className="mt-1 text-xs text-[var(--aw-text-soft)]">Last used: {safeDate(selectedTool.lastUsedAt)}</p>
              </article>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Reconnect</p>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <label className="space-y-1">
                  <span className="text-xs text-[var(--aw-text-muted)]">Login identifier</span>
                  <input
                    value={reconnectIdentifier}
                    onChange={(event) => setReconnectIdentifier(event.target.value)}
                    className="aw-input h-10 text-sm"
                    placeholder={selectedTool.loginIdentifierMasked || "you@company.com"}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs text-[var(--aw-text-muted)]">Secret</span>
                  <input
                    type="password"
                    value={reconnectSecret}
                    onChange={(event) => setReconnectSecret(event.target.value)}
                    className="aw-input h-10 text-sm"
                    placeholder="Enter new password or token"
                  />
                </label>

                <button
                  onClick={() => {
                    void submitReconnect(selectedTool);
                  }}
                  className="aw-button-primary h-10 px-4 text-sm"
                  disabled={isSavingToolId === selectedTool.id}
                >
                  {isSavingToolId === selectedTool.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" />
                      Saving
                    </span>
                  ) : (
                    "Reconnect"
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--aw-border)] bg-[var(--aw-surface-muted)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">Recent events</p>
                {isLoadingEvents && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--aw-text-muted)]">
                    <Loader2 size={11} className="animate-spin" />
                    Loading
                  </span>
                )}
              </div>

              {eventsError ? (
                <p className="mt-2 text-xs text-[var(--aw-danger)]">{eventsError}</p>
              ) : events.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--aw-text-muted)]">No events yet</p>
              ) : (
                <div className="aw-scroll mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <article
                      key={event.id}
                      className="rounded-lg border border-[var(--aw-border)] bg-white px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--aw-text)]">
                          <span className={`inline-flex h-2 w-2 rounded-full ${eventDotClass(event.eventType)}`} />
                          {eventLabel(event.eventType)}
                        </p>
                        <p className="text-[10px] text-[var(--aw-text-muted)]">
                          {safeDate(event.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--aw-text-soft)]">
                        {event.message || "Not available"}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--aw-border)] pt-3">
              <button
                onClick={() => {
                  void toggleEnabled(selectedTool, !selectedTool.enabled);
                }}
                className="aw-button-secondary px-3 py-1.5 text-xs"
                disabled={isSavingToolId === selectedTool.id}
              >
                <span className="inline-flex items-center gap-1">
                  {selectedTool.enabled ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
                  {selectedTool.enabled ? "Disable" : "Enable"}
                </span>
              </button>

              <button
                onClick={() => {
                  void submitRemove(selectedTool);
                }}
                className="aw-button-secondary px-3 py-1.5 text-xs text-[var(--aw-danger)]"
                disabled={isSavingToolId === selectedTool.id}
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={12} />
                  Remove
                </span>
              </button>

              <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--aw-border)] bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--aw-text-muted)]">
                <KeyRound size={11} />
                Secrets stay vaulted
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
