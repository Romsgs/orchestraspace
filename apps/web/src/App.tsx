import { cloneElement, FormEvent, isValidElement, ReactNode, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Crown, FileText, LogOut, MapPinned, Music2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { api, Document as OrgDocument, Event, Invitation, Membership, Organization, Trip, User } from "./api";
import languages from "./languages.json";

type Tab = "agenda" | "trips" | "team" | "documents" | "system";
type LanguageCode = keyof typeof languages;
const languageCodes = Object.keys(languages) as LanguageCode[];

function dateLabel(value: string, timezone = "Europe/Sofia", locale = "pt-BR") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: timezone
  }).format(new Date(value));
}

function dateTimeInputValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

function dateTimeInputToIso(value: string, timezone: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(candidate));
    const fields = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
    const adjustment = desired - represented;
    candidate += adjustment;
    if (!adjustment) break;
  }
  return new Date(candidate).toISOString();
}

export function App() {
  const [language, setLanguage] = useState<LanguageCode>(() => {
    const saved = typeof document !== "undefined" ? document.cookie.split("; ").find((row) => row.startsWith("language="))?.split("=")[1] : undefined;
    return saved && Object.prototype.hasOwnProperty.call(languages, saved) ? saved as LanguageCode : "pt";
  });
  const t = (key: string, values: Record<string, string> = {}) => {
    const activeTranslations = languages[language].translations as Record<string, string>;
    const fallbackTranslations = languages.en.translations as Record<string, string>;
    const sourceTranslations = languages.pt.translations as Record<string, string>;
    const template = activeTranslations[key] ?? fallbackTranslations[key] ?? sourceTranslations[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
  };
  const localizedDate = (value: string, timezone = selectedOrg?.timezone ?? "Europe/Sofia") => dateLabel(value, timezone, languages[language].locale);
  const localizedTime = (value: string, timezone = selectedOrg?.timezone ?? "Europe/Sofia") => new Intl.DateTimeFormat(languages[language].locale, { timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const localizeTree = (node: ReactNode): ReactNode => {
    if (typeof node === "string") {
      const key = node.trim();
      if (!key) return node;
      const start = node.indexOf(key);
      return `${node.slice(0, start)}${t(key)}${node.slice(start + key.length)}`;
    }
    if (Array.isArray(node)) return node.map(localizeTree);
    if (!isValidElement<Record<string, unknown>>(node)) return node;
    const props = { ...node.props };
    if (props.children !== undefined) props.children = localizeTree(props.children as ReactNode);
    for (const key of ["label", "title", "text", "placeholder", "aria-label", "aria-description", "alt"]) {
      if (typeof props[key] === "string") props[key] = t(props[key] as string);
    }
    return cloneElement(node, props);
  };

  const setAppLanguage = (newLang: LanguageCode) => {
    setLanguage(newLang);
    document.cookie = `language=${newLang}; path=/; max-age=31536000; SameSite=Lax`;
  };

  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tab, setTab] = useState<Tab>("agenda");
  const [busy, setBusy] = useState(false);
  const [acceptingInvitation, setAcceptingInvitation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showTripForm, setShowTripForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState("");
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [inviteToken, setInviteToken] = useState("");
  const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
  const [acceptName, setAcceptName] = useState("");
  const [acceptPassword, setAcceptPassword] = useState("");
  const [tripEventSelection, setTripEventSelection] = useState<Record<string, string>>({});
  const [overview, setOverview] = useState<{users:number;organizations:number;events:number}|null>(null);

  async function loadMe() {
    try {
      const result = await api.me();
      setUser(result.user);
      const orgResult = await api.organizations();
      setOrganizations(orgResult.organizations);
      setOrgId((current) => current || orgResult.organizations[0]?.id || "");
    } catch {
      setUser(null);
    }
  }

  async function loadOrgData(id = orgId) {
    if (!id) { setEvents([]); setTrips([]); return; }
    setBusy(true); setError("");
    try {
      const [eventResult, tripResult] = await Promise.all([api.events(id), api.trips(id)]);
      setEvents(eventResult.events);
      setTrips(tripResult.trips);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar os dados.");
    } finally { setBusy(false); }
  }

  async function loadTeam(id = orgId) {
    if (!id) return;
    const result = await api.members(id);
    setMembers(result.memberships); setInvitations(result.invitations);
  }

  async function loadDocuments(id = orgId) {
    if (!id) return;
    const result = await api.documents(id); setDocuments(result.documents);
  }

  useEffect(() => { void loadMe(); }, []);
  useEffect(() => { if (orgId) void loadOrgData(orgId); }, [orgId]);
  useEffect(() => { if (orgId && tab === "team") void loadTeam(orgId).catch((e) => setError(e.message)); }, [orgId, tab]);
  useEffect(() => { if (orgId && tab === "documents") void loadDocuments(orgId).catch((e) => setError(e.message)); }, [orgId, tab]);
  useEffect(() => {
    if (user?.isSuperAdmin && tab === "system") {
      api.systemOverview().then(setOverview).catch((e) => setError(e.message));
    }
  }, [user, tab]);

  const selectedOrg = organizations.find((o) => o.id === orgId);
  const canManage = Boolean(user?.isSuperAdmin || user?.memberships?.some((m) =>
    m.organization.id === orgId && m.roles.some((r) => ["ORG_ADMIN", "EVENT_MANAGER"].includes(r.role.key))
  ) || organizations.find((o) => o.id === orgId)?.roles?.some((r) => ["ORG_ADMIN", "EVENT_MANAGER"].includes(r)));
  const hasRole = (role: string) => Boolean(user?.isSuperAdmin || user?.memberships?.some((m) => m.organization.id === orgId && m.roles.some((r) => r.role.key === role)) || organizations.find((o) => o.id === orgId)?.roles?.includes(role));
  const canAdmin = hasRole("ORG_ADMIN");
  const canLibrary = canAdmin || hasRole("LIBRARIAN");
  const agendaItems = useMemo(() => {
    const linkedEventIds = new Set(trips.flatMap((trip) => trip.eventLinks?.map((link) => link.event.id) ?? []));
    return [
      ...trips.map((trip) => ({ kind: "trip" as const, id: trip.id, startAt: trip.startAt, trip })),
      ...events.filter((event) => !linkedEventIds.has(event.id)).map((event) => ({ kind: "event" as const, id: event.id, startAt: event.startAt, event }))
    ].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  }, [events, trips]);
  const renderAgendaEvent = (event: Event) => {
    const timezone = event.timezone ?? selectedOrg?.timezone ?? "Europe/Sofia";
    if (editingEventId === event.id) return <form className="event-edit-form" key={event.id} onSubmit={(e) => void saveEventEdits(e, event)}>
      <label>{t("Título")}<input name="title" defaultValue={event.title} required minLength={2}/></label>
      <label>{t("Status")}<select name="status" defaultValue={event.status}><option value="DRAFT">{t("DRAFT")}</option><option value="PUBLISHED">{t("PUBLISHED")}</option><option value="CANCELLED">{t("CANCELLED")}</option><option value="COMPLETED">{t("COMPLETED")}</option></select></label>
      <label>{t("Início")}<input name="startAt" type="datetime-local" defaultValue={dateTimeInputValue(event.startAt, timezone)} required/></label>
      <label>{t("Término")}<input name="endAt" type="datetime-local" defaultValue={dateTimeInputValue(event.endAt, timezone)} required/></label>
      <label>{t("Local")}<input name="venue" defaultValue={event.venue ?? ""}/></label>
      <label>{t("Regente")}<input name="conductor" defaultValue={event.conductor ?? ""}/></label>
      <label className="wide">{t("Programa")}<textarea name="program" rows={3} defaultValue={event.program ?? ""}/></label>
      <div className="form-actions wide"><button type="button" className="secondary" onClick={() => setEditingEventId("")}>{t("Cancelar")}</button><button className="primary">{t("Salvar alterações")}</button></div>
    </form>;
    return <article className="event-row" key={event.id}>
      <div className="date-tile"><strong>{new Date(event.startAt).toLocaleDateString(languages[language].locale,{day:"2-digit",timeZone:timezone})}</strong><small>{new Date(event.startAt).toLocaleDateString(languages[language].locale,{month:"short",timeZone:timezone}).replace(".","")}</small></div>
      <div className="event-info"><div className="event-title"><h4>{event.title}</h4><span className={`pill ${event.status==="PUBLISHED"?"green":"neutral"}`}>{t(event.status)}</span></div><p>{t(event.type)} · {localizedDate(event.startAt, timezone)} – {localizedTime(event.endAt, timezone)}</p><div className="event-meta">{event.venue && <span>⌖ {event.venue}</span>}{event.conductor && <span>♩ {t("Regente")}: {event.conductor}</span>}</div>{event.program && <p className="program">{event.program}</p>}</div>
      {canManage&&<div className="event-actions"><button className="secondary" aria-label={t("Editar evento")} title={t("Editar evento")} onClick={()=>setEditingEventId(event.id)}><Pencil size={15}/></button><button className="secondary danger-button" aria-label={t("Excluir evento")} title={t("Excluir evento")} onClick={()=>void deleteEvent(event)}><Trash2 size={15}/></button></div>}
    </article>;
  };

  async function submitLogin(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      await api.login(loginEmail, loginPassword);
      setLoginPassword("");
      await loadMe();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha no login."); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null); setOrganizations([]); setEvents([]); setTrips([]); setOrgId("");
  }

  async function submitOrganization(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setNotice("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await api.createOrganization({
        name: String(data.get("name")), slug: String(data.get("slug")).toLowerCase().trim().replace(/\s+/g, "-"),
        timezone: String(data.get("timezone") || "Europe/Sofia")
      });
      setNotice(t('Orquestra "{name}" criada. Adicione os membros em Administração de membros.', { name: result.organization.name }));
      setShowOrgForm(false);
      const orgs = await api.organizations();
      setOrganizations(orgs.organizations);
      setOrgId(result.organization.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao criar orquestra."); }
  }

  async function submitEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setNotice("");
    const data = new FormData(e.currentTarget);
    const start = new Date(String(data.get("startAt"))).toISOString();
    const end = new Date(String(data.get("endAt"))).toISOString();
    const type = String(data.get("type"));
    try {
      await api.createEvent(orgId, {
        type, title: String(data.get("title")), startAt: start, endAt: end,
        timezone: selectedOrg?.timezone ?? "Europe/Sofia", venue: String(data.get("venue") || "") || undefined,
        conductor: String(data.get("conductor") || "") || undefined,
        program: String(data.get("program") || "") || undefined,
        status: "PUBLISHED",
        ...(type === "CONCERT" ? { concertDetails: {
          requiredClothing: String(data.get("clothing") || "") || undefined,
          bringStand: data.get("bringStand") === "on",
          bringLights: data.get("bringLights") === "on"
        }} : {})
      });
      setShowEventForm(false); setNotice("Evento criado e publicado."); await loadOrgData();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao criar evento."); }
  }

  async function saveEventEdits(e: FormEvent<HTMLFormElement>, event: Event) {
    e.preventDefault(); setError("");
    const data = new FormData(e.currentTarget);
    const timezone = event.timezone ?? selectedOrg?.timezone ?? "Europe/Sofia";
    try {
      await api.updateEvent(orgId, event.id, {
        title: String(data.get("title")), status: String(data.get("status")),
        startAt: dateTimeInputToIso(String(data.get("startAt")), timezone),
        endAt: dateTimeInputToIso(String(data.get("endAt")), timezone), timezone,
        venue: String(data.get("venue") ?? ""), conductor: String(data.get("conductor") ?? ""),
        program: String(data.get("program") ?? "")
      });
      setEditingEventId(""); setNotice(t("Evento atualizado.")); await loadOrgData();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao atualizar evento."); }
  }

  async function deleteEvent(event: Event) {
    const confirmed = window.confirm(t('Tem certeza que deseja excluir o evento "{name}"?', { name: event.title }));
    if (!confirmed) return;
    setError("");
    try {
      await api.deleteEvent(orgId, event.id);
      setNotice(t("Evento excluído.")); await loadOrgData();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao excluir evento."); }
  }

  async function submitTrip(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setNotice("");
    const data = new FormData(e.currentTarget);
    try {
      await api.createTrip(orgId, {
        title: String(data.get("title")), description: String(data.get("description") || ""),
        startAt: new Date(String(data.get("startAt"))).toISOString(),
        endAt: new Date(String(data.get("endAt"))).toISOString(),
        timezone: selectedOrg?.timezone ?? "Europe/Sofia"
      });
      setShowTripForm(false); setNotice("Viagem criada. Agora você pode associar eventos existentes."); await loadOrgData();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao criar viagem."); }
  }

  async function submitInvitation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setInviteToken("");
    if (!orgId) { setError(t("Selecione uma orquestra")); return; }
    const data = new FormData(e.currentTarget);
    try {
      const result = await api.createInvitation(orgId, String(data.get("email")), String(data.get("roleKey")));
      setInviteToken(result.token); await loadTeam(); e.currentTarget.reset();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao criar convite."); }
  }

  async function submitDocument(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setNotice("");
    const data = new FormData(e.currentTarget); const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) { setError("Selecione um arquivo."); return; }
    try { await api.uploadDocument(orgId, file, String(data.get("title") || file.name), String(data.get("visibility"))); e.currentTarget.reset(); setNotice("Documento enviado."); await loadDocuments(); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao enviar documento."); }
  }

  async function acceptInvitation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    if (acceptingInvitation) return;
    setAcceptingInvitation(true);
    try { const result = await api.acceptInvitation(invitationToken, acceptName || user?.name || "Músico", acceptPassword || undefined); setNotice(result.message); setInvitationToken(""); setAcceptPassword(""); window.history.replaceState({}, "", window.location.pathname); await loadMe(); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao aceitar convite."); }
    finally { setAcceptingInvitation(false); }
  }

  async function saveTripEvents(trip: Trip, eventIds: string[]) {
    try { await api.orderTripEvents(orgId, trip.id, eventIds); await loadOrgData(); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao atualizar eventos da viagem."); }
  }

  async function toggleTripConfirmation(trip: Trip) {
    const status = trip.status === "PLANNING" ? "CONFIRMED" : "PLANNING";
    try { await api.updateTripStatus(orgId, trip.id, status); await loadOrgData(); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao atualizar o estado da viagem."); }
  }

  if (!user) return localizeTree(<main className="login-screen">
    <label className="language-picker login-language" aria-label={t("Idioma")}><span className="language-current"><span className="language-flag">{languages[language].flag}</span><span className="language-name">{languages[language].name}</span></span><select aria-label={t("Idioma")} value={language} onChange={(e) => setAppLanguage(e.target.value as LanguageCode)}>{languageCodes.map((code) => <option key={code} value={code}>{languages[code].flag} {languages[code].name}</option>)}</select><ChevronDown size={14}/></label>
    <div className="login-art">
      <div className="brand"><div className="brand-mark"><Music2 size={22}/></div><span>Orchestra<span className="brand-light"> Platform</span></span></div>
      <div className="hero-copy">
        <span className="eyebrow">ORCHESTRA OPERATIONS</span>
        <h1>Uma agenda.<br/><em>Toda a orquestra.</em></h1>
        <p>Ensaios, concertos, turnês e documentos em um só lugar.</p>
      </div>
      <div className="art-note"><CalendarDays size={17}/> Planejamento musical, sem ruído.</div>
    </div>
    <section className="login-panel">
      {invitationToken && <form className="login-card invite-card" onSubmit={acceptInvitation}><span className="eyebrow">CONVITE</span><h2>Aceitar convite</h2><p className="muted">Crie sua conta para entrar na orquestra.</p>{error && <div className="alert error">{error}</div>}<label>Seu nome<input value={acceptName} onChange={(e)=>setAcceptName(e.target.value)} required minLength={2}/></label><label>Senha nova<input type="password" value={acceptPassword} onChange={(e)=>setAcceptPassword(e.target.value)} minLength={14} required autoComplete="new-password"/></label><button className="primary full" disabled={acceptingInvitation}>Criar conta e aceitar</button></form>}
      <form className="login-card" onSubmit={submitLogin}>
        <span className="eyebrow">ÁREA RESTRITA</span><h2>Bem-vindo de volta</h2>
        <p className="muted">Entre com sua conta para acessar a plataforma.</p>
        {error && <div className="alert error">{error}</div>}
        <label>E-mail<input type="email" autoComplete="username" required value={loginEmail} onChange={(e)=>setLoginEmail(e.target.value)} placeholder="voce@orquestra.org"/></label>
        <label>Senha<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(e)=>setLoginPassword(e.target.value)} placeholder="Sua senha"/></label>
        <button className="primary full" disabled={busy}>{busy ? "Entrando..." : "Entrar"} <span>→</span></button>
        <p className="login-foot">Acesso criado pelo administrador da plataforma.</p>
      </form>
    </section>
  </main>);

  return localizeTree(<div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Music2 size={21}/></div><span>Orchestra<span className="brand-light"> Platform</span></span></div>
      <div className="side-caption">WORKSPACE</div>
      <label className="org-picker"><span>{t("Instituição ativa")}</span><select value={orgId} onChange={(e)=>{const nextOrgId=e.target.value;setOrgId(nextOrgId);if(!nextOrgId&&tab==="team")setTab("agenda");}}><option value="">{t("Selecione uma orquestra")}</option>{organizations.map((o)=><option key={o.id} value={o.id}>{o.name}</option>)}</select><ChevronDown size={14}/></label>
      <nav>
        <button className={tab==="agenda"?"nav-item active":"nav-item"} onClick={()=>setTab("agenda")}><CalendarDays size={18}/> {t("Agenda")}</button>
        <button className={tab==="trips"?"nav-item active":"nav-item"} onClick={()=>setTab("trips")}><MapPinned size={18}/> {t("Viagens e turnês")}</button>
        {orgId && canAdmin && <button className={tab==="team"?"nav-item active":"nav-item"} onClick={()=>setTab("team")}><Users size={18}/> {t("Equipe")}</button>}
        {orgId && <button className={tab==="documents"?"nav-item active":"nav-item"} onClick={()=>setTab("documents")}><FileText size={18}/> {t("Documentos")}</button>}
        {user.isSuperAdmin && <button className={tab==="system"?"nav-item active":"nav-item"} onClick={()=>setTab("system")}><Crown size={18}/> {t("Administração global")}</button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="secure-note"><ShieldCheck size={17}/><span><strong>{t("Área protegida")}</strong><small>{t("Permissões por instituição")}</small></span></div>
        <button className="profile" onClick={logout}><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><span><strong>{user.name}</strong><small>{user.isSuperAdmin ? "Superusuário" : user.email}</small></span><LogOut size={16}/></button>
      </div>
    </aside>

    <main className="main-content">
<header className="topbar">
  <div className="breadcrumb">{t("PLATAFORMA")} / {tab==="system"?t("SISTEMA"):selectedOrg?.name?.toUpperCase() ?? t("SELECIONE UMA ORQUESTRA")}</div>
  <h1>{(tab==="agenda"?"Agenda":tab==="trips"?"Viagens e turnês":tab==="team"?"Equipe":tab==="documents"?"Documentos":"Administração global")}</h1>
  <div className="top-actions">
    <span className="status-dot">● Conectado</span>
    <label className="language-picker" aria-label={t("Idioma")}><span className="language-current"><span className="language-flag">{languages[language].flag}</span><span className="language-name">{languages[language].name}</span></span><select aria-label={t("Idioma")} value={language} onChange={(e) => setAppLanguage(e.target.value as LanguageCode)}>{languageCodes.map((code) => <option key={code} value={code}>{languages[code].flag} {languages[code].name}</option>)}</select><ChevronDown size={14}/></label>
    <button className="icon-button" title="Atualizar" onClick={()=>void loadOrgData()}><RefreshCw size={17}/></button>
    <div className="avatar">{user.name.slice(0,1).toUpperCase()}</div>
  </div>
</header>

      {error && <div className="alert error">{error}<button onClick={()=>setError("")}>×</button></div>}
      {notice && <div className="alert success">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      {invitationToken && <form className="panel form-grid" onSubmit={acceptInvitation}><h3>Aceitar convite para outra orquestra</h3><label>Confirme seu nome<input value={acceptName || user.name} onChange={(e)=>setAcceptName(e.target.value)} required minLength={2}/></label><label>Senha atual da conta<input type="password" value={acceptPassword} onChange={(e)=>setAcceptPassword(e.target.value)} required autoComplete="current-password"/></label><div className="form-actions"><button className="primary" disabled={acceptingInvitation}>Aceitar convite</button></div></form>}

      {tab==="system" && user.isSuperAdmin ? <section>
        <div className="welcome-row"><div><h2>O centro de comando</h2><p className="muted">Visão geral das instituições e da atividade da plataforma.</p></div><button className="primary" onClick={()=>setShowOrgForm(!showOrgForm)}><Plus size={17}/> Nova orquestra</button></div>
        <div className="stats-grid">
          <Stat icon={<Users/>} label="Usuários" value={overview?.users ?? "—"}/>
          <Stat icon={<Music2/>} label="Orquestras" value={overview?.organizations ?? "—"}/>
          <Stat icon={<CalendarDays/>} label="Eventos" value={overview?.events ?? "—"}/>
        </div>
        {showOrgForm && <form className="panel form-grid" onSubmit={submitOrganization}><h3>Nova instituição</h3><label>Nome<input name="name" required minLength={2}/></label><label>Slug (URL)<input name="slug" required pattern="[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*" placeholder="sinfonietta-vidin"/></label><label>Fuso horário<input name="timezone" defaultValue="Europe/Sofia" required/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setShowOrgForm(false)}>Cancelar</button><button className="primary">Criar instituição</button></div></form>}
        <div className="panel"><div className="panel-heading"><div><h3>Instituições</h3><p className="muted">Organizações cadastradas na plataforma.</p></div><span className="count">{organizations.length}</span></div>
          {organizations.length===0 ? <Empty title="Nenhuma orquestra cadastrada" text="Crie a primeira instituição para começar."/> : <div className="org-list">{organizations.map((org)=><button key={org.id} className="org-row" onClick={()=>{setOrgId(org.id);setTab("agenda")}}><div className="org-symbol"><Music2/></div><span><strong>{org.name}</strong><small>/{org.slug} · {org.timezone}</small></span><span className="pill green">{t(org.status ?? "ACTIVE")}</span><span>→</span></button>)}</div>}
        </div>
      </section> : tab==="agenda" ? <section>
        <div className="welcome-row"><div><h2>{selectedOrg ? t("Olá, {name}", { name: user.name.split(" ")[0] }) : "Escolha sua orquestra"}</h2><p className="muted">{selectedOrg ? "Aqui está a programação da instituição." : "Selecione uma instituição no menu lateral para visualizar a agenda."}</p></div>{canManage && orgId && <button className="primary" onClick={()=>setShowEventForm(!showEventForm)}><Plus size={17}/> Novo evento</button>}</div>
        {orgId && <div className="stats-grid compact"><Stat icon={<CalendarDays/>} label="Eventos" value={events.length}/><Stat icon={<MapPinned/>} label="Viagens" value={trips.length}/><Stat icon={<Users/>} label="Instituição" value={selectedOrg?.name ?? "—"}/></div>}
        {showEventForm && <form className="panel form-grid" onSubmit={submitEvent}><h3>Novo evento</h3>
          <label>Título<input name="title" required minLength={2} placeholder="Ensaio de naipe / Concerto"/></label>
          <label>Tipo<select name="type" defaultValue="REHEARSAL"><option value="REHEARSAL">Ensaio</option><option value="GENERAL_REHEARSAL">Ensaio geral</option><option value="CONCERT">Concerto</option><option value="SOUND_CHECK">Passagem de som</option><option value="MEETING">Reunião</option><option value="OTHER">Outro</option></select></label>
          <label>Início<input type="datetime-local" name="startAt" required/></label><label>Término<input type="datetime-local" name="endAt" required/></label>
          <label>Local<input name="venue" placeholder="Sala / auditório"/></label><label>Regente<input name="conductor" placeholder="Nome do regente"/></label>
          <label className="wide">Programa<textarea name="program" rows={2} placeholder="Obras, compositores e observações do programa"/></label>
          <label className="wide">Roupa (concertos)<input name="clothing" placeholder="Ex.: traje preto"/></label>
          <label className="check-label"><input type="checkbox" name="bringStand"/> Levar estante</label><label className="check-label"><input type="checkbox" name="bringLights"/> Levar lâmpada</label>
          <div className="form-actions"><button type="button" className="secondary" onClick={()=>setShowEventForm(false)}>Cancelar</button><button className="primary">Salvar evento</button></div>
        </form>}
        {!orgId ? <Empty title="Nenhuma instituição selecionada" text="Escolha uma orquestra no seletor à esquerda."/> :
          <div className="panel"><div className="panel-heading"><div><h3>Agenda</h3><p className="muted">Viagens e eventos em ordem cronológica.</p></div><span className="count">{agendaItems.length}</span></div>
            {busy ? <p className="muted loading">Carregando agenda…</p> : agendaItems.length===0 ? <Empty title="Agenda vazia" text="Quando eventos ou viagens forem cadastrados, aparecerão aqui."/> :
              <div className="agenda-list">{agendaItems.map((item) => item.kind === "trip" ? <article className="agenda-trip-card" key={`trip-${item.id}`}>
                <div className="agenda-trip-heading"><div className="trip-card-icon"><MapPinned/></div><div><h3>{item.trip.title}</h3><p>{localizedDate(item.trip.startAt)} – {localizedDate(item.trip.endAt)}</p></div><span className="pill neutral">{t(item.trip.status)}</span>{canManage&&["PLANNING","CONFIRMED"].includes(item.trip.status)&&<button className="secondary trip-status-button" onClick={()=>void toggleTripConfirmation(item.trip)}>{t(item.trip.status==="PLANNING"?"Confirmar viagem":"Reabrir planejamento")}</button>}</div>
                <div className="agenda-trip-events">{item.trip.eventLinks?.length ? item.trip.eventLinks.map((link) => renderAgendaEvent(link.event)) : <p className="muted">Nenhum evento associado a esta viagem.</p>}</div>
              </article> : renderAgendaEvent(item.event))}</div>}
          </div>}
      </section> : <section>
        <div className="welcome-row"><div><h2>{t("Viagens e turnês")}</h2><p className="muted">{t("Agrupe eventos existentes em itinerários sem duplicá-los.")}</p></div>{canManage && orgId && <button className="primary" onClick={()=>setShowTripForm(!showTripForm)}><Plus size={17}/> {t("Nova viagem")}</button>}</div>
        {showTripForm && <form className="panel form-grid" onSubmit={submitTrip}><h3>Nova viagem / turnê</h3><label className="wide">Nome<input name="title" required placeholder="Turnê de outono"/></label><label>Início<input name="startAt" type="datetime-local" required/></label><label>Término<input name="endAt" type="datetime-local" required/></label><label className="wide">Descrição<textarea name="description" rows={2} placeholder="Objetivo e notas da viagem"/></label><div className="form-actions"><button type="button" className="secondary" onClick={()=>setShowTripForm(false)}>Cancelar</button><button className="primary">Criar viagem</button></div></form>}
        {!orgId ? <Empty title="Selecione uma orquestra" text="As viagens são separadas por instituição."/> : trips.length===0 ? <div className="panel"><Empty title="Nenhuma viagem cadastrada" text="Crie uma viagem e depois associe os eventos existentes."/></div> :
          <div className="trip-grid">{trips.map((trip)=><article className="trip-card" key={trip.id}><div className="trip-card-icon"><MapPinned/></div><span className="pill neutral">{t(trip.status)}</span><h3>{trip.title}</h3><p>{localizedDate(trip.startAt)} – {localizedDate(trip.endAt)}</p>{canManage&&["PLANNING","CONFIRMED"].includes(trip.status)&&<button className="secondary trip-status-button" onClick={()=>void toggleTripConfirmation(trip)}>{t(trip.status==="PLANNING"?"Confirmar viagem":"Reabrir planejamento")}</button>}<div className="trip-events"><strong>{trip.eventLinks?.length ?? 0} {t("eventos vinculados")}</strong>{trip.eventLinks?.map((link,index)=>{const ids=trip.eventLinks?.map((item)=>item.event.id)??[];return <div className="trip-event-link" key={link.event.id}><span>{index+1}. {link.event.title}</span>{canManage&&<span><button className="link-button" disabled={index===0} onClick={()=>void saveTripEvents(trip,ids.map((id,i)=>i===index?ids[index-1]!:i===index-1?ids[index]!:id))}>↑</button><button className="link-button" disabled={index===ids.length-1} onClick={()=>void saveTripEvents(trip,ids.map((id,i)=>i===index?ids[index+1]!:i===index+1?ids[index]!:id))}>↓</button><button className="link-button danger" title="Remover evento" onClick={()=>void api.detachEvent(orgId,trip.id,link.event.id).then(()=>loadOrgData()).catch((e)=>setError(e.message))}><X size={14}/></button></span>}</div>})}</div>{canManage&&<div className="trip-add"><select aria-label="Evento a adicionar" value={tripEventSelection[trip.id]??""} onChange={(e)=>setTripEventSelection({...tripEventSelection,[trip.id]:e.target.value})}><option value="">Escolha um evento</option>{events.filter((event)=>!trip.eventLinks?.some((link)=>link.event.id===event.id)).map((event)=><option key={event.id} value={event.id}>{event.title}</option>)}</select><button className="secondary" disabled={!tripEventSelection[trip.id]} onClick={()=>{const next=tripEventSelection[trip.id];if(next)void saveTripEvents(trip,[...(trip.eventLinks?.map((link)=>link.event.id)??[]),next]);}}>{t("Adicionar")}</button></div>}</article>)}</div>}
      </section>}
      {tab==="team" && orgId && canAdmin && <section><div className="welcome-row"><div><h2>Equipe da orquestra</h2><p className="muted">Convide músicos e gerencie os vínculos existentes.</p></div></div><form className="panel form-grid" onSubmit={submitInvitation}><h3>Novo convite</h3><label>E-mail<input name="email" type="email" required/></label><label>Role<select name="roleKey" defaultValue="MUSICIAN"><option value="ORG_ADMIN">Administrador</option><option value="EVENT_MANAGER">Gestor de eventos</option><option value="MUSICIAN">Músico</option><option value="LIBRARIAN">Bibliotecário</option><option value="READ_ONLY">Somente leitura</option></select></label><div className="form-actions"><button className="primary">Criar convite</button></div>{inviteToken&&<div className="alert success wide">Convite criado. Copie e envie este link com o token: <code>{`${window.location.origin}/?invite=${encodeURIComponent(inviteToken)}`}</code></div>}</form><div className="panel"><div className="panel-heading"><div><h3>Membros</h3><p className="muted">Selecione um ou mais roles para cada pessoa.</p></div><span className="count">{members.length}</span></div>{members.map((member)=><div className="member-row" key={member.id}><span><strong>{member.user.name}</strong><small>{member.user.email} · {t(member.status)}</small></span><select multiple aria-label={t("Roles de {name}", {name: member.user.name})} value={member.roles.map((item)=>item.role.key)} onChange={(e)=>void api.updateMember(orgId,member.id,{roleKeys:Array.from(e.currentTarget.selectedOptions,(option)=>option.value)}).then(()=>loadTeam()).catch((err)=>setError(err.message))}><option value="ORG_ADMIN">Administrador</option><option value="EVENT_MANAGER">Gestor de eventos</option><option value="MUSICIAN">Músico</option><option value="LIBRARIAN">Bibliotecário</option><option value="READ_ONLY">Somente leitura</option></select><button className="secondary" onClick={()=>void api.updateMember(orgId,member.id,{status:member.status==="ACTIVE"?"SUSPENDED":"ACTIVE"}).then(()=>loadTeam()).catch((err)=>setError(err.message))}>{t(member.status==="ACTIVE"?"Suspender":"Reativar")}</button></div>)}</div>{invitations.length>0&&<div className="panel"><h3>Convites pendentes</h3>{invitations.map((invitation)=><div className="member-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.roleKeys.map((role)=>t(role)).join(", ")} · {t("expira em")} {localizedDate(invitation.expiresAt)}</small></span></div>)}</div>}</section>}
      {tab==="documents" && <section><div className="welcome-row"><div><h2>Biblioteca</h2><p className="muted">Arquivos privados da instituição, com acesso conforme a visibilidade definida.</p></div></div>{canLibrary&&<form className="panel form-grid" onSubmit={submitDocument}><h3>Adicionar documento</h3><label>Título<input name="title" placeholder="Partitura, programa, comunicado"/></label><label>Visibilidade<select name="visibility" defaultValue="MEMBERS"><option value="ADMINS_ONLY">Somente administradores</option><option value="STAFF">Equipe (administração, eventos e biblioteca)</option><option value="MEMBERS">Membros da orquestra</option><option value="PUBLIC">Público da orquestra (membros autenticados)</option></select></label><label className="wide">Arquivo<input type="file" name="file" accept=".pdf,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.docx" required/></label><div className="form-actions"><button className="primary">Enviar arquivo</button></div></form>}<div className="panel"><div className="panel-heading"><h3>Documentos disponíveis</h3><span className="count">{documents.length}</span></div>{documents.length===0?<Empty title="Biblioteca vazia" text="Os documentos disponíveis para seu role aparecerão aqui."/>:documents.map((doc)=><div className="member-row" key={doc.id}><span><strong>{doc.title}</strong><small>{doc.fileName} · {t(doc.visibility)} · {Math.ceil(Number(doc.sizeBytes)/1024)} KB</small></span><a className="secondary" href={api.documentUrl(orgId,doc.id)}>{t("Baixar")}</a>{canLibrary&&<button className="link-button danger" onClick={()=>void api.deleteDocument(orgId,doc.id).then(()=>loadDocuments()).catch((e)=>setError(e.message))}><X size={15}/></button>}</div>)}</div></section>}
      <footer className="footer">ORCHESTRA PLATFORM <span>·</span> versão 0.2.0 <span>·</span> Feito para equipes musicais</footer>
    </main>
  </div>);
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string|number}) {
  return <div className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}
function Empty({title,text}:{title:string;text:string}) {
  return <div className="empty-state"><div className="empty-icon"><CalendarDays/></div><strong>{title}</strong><p>{text}</p></div>;
}
