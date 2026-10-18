const base = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body && !(init.body instanceof File) ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Não foi possível conectar ao servidor. No celular, abra o endereço publicado do site ou, em desenvolvimento, use o IP local do computador na mesma rede Wi-Fi.");
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
  return payload as T;
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  organizations: () => request<{ organizations: Organization[] }>("/api/organizations"),
  createOrganization: (body: { name: string; slug: string; timezone: string }) =>
    request<{ organization: Organization }>("/api/organizations", { method: "POST", body: JSON.stringify(body) }),
  events: (orgId: string) => request<{ events: Event[] }>(`/api/organizations/${orgId}/events`),
  createEvent: (orgId: string, body: Record<string, unknown>) =>
    request<{ event: Event }>(`/api/organizations/${orgId}/events`, { method: "POST", body: JSON.stringify(body) }),
  trips: (orgId: string) => request<{ trips: Trip[] }>(`/api/organizations/${orgId}/trips`),
  createTrip: (orgId: string, body: Record<string, unknown>) =>
    request<{ trip: Trip }>(`/api/organizations/${orgId}/trips`, { method: "POST", body: JSON.stringify(body) }),
  attachEvent: (orgId: string, tripId: string, eventId: string) =>
    request(`/api/organizations/${orgId}/trips/${tripId}/events`, {
      method: "POST", body: JSON.stringify({ eventId, sortOrder: 0 })
    }),
  detachEvent: (orgId: string, tripId: string, eventId: string) =>
    request<void>(`/api/organizations/${orgId}/trips/${tripId}/events/${eventId}`, { method: "DELETE" }),
  orderTripEvents: (orgId: string, tripId: string, eventIds: string[]) =>
    request(`/api/organizations/${orgId}/trips/${tripId}/events`, { method: "PATCH", body: JSON.stringify({ eventIds }) }),
  createInvitation: (orgId: string, email: string, roleKey: string) =>
    request<{ invitation: { id: string; email: string; expiresAt: string }; token: string; note: string }>(`/api/organizations/${encodeURIComponent(orgId)}/invitations`, { method: "POST", body: JSON.stringify({ email, roleKey }) }),
  members: (orgId: string) => request<{ memberships: Membership[]; invitations: Invitation[] }>(`/api/organizations/${orgId}/members`),
  updateMember: (orgId: string, membershipId: string, body: { status?: string; roleKeys?: string[] }) =>
    request(`/api/organizations/${orgId}/members/${membershipId}`, { method: "PATCH", body: JSON.stringify(body) }),
  documents: (orgId: string) => request<{ documents: Document[] }>(`/api/organizations/${orgId}/documents`),
  uploadDocument: (orgId: string, file: File, title: string, visibility: string) => request(`/api/organizations/${orgId}/documents?${new URLSearchParams({ title, visibility })}`, {
    method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name, "X-File-Mime": file.type || "application/octet-stream" }
  }),
  deleteDocument: (orgId: string, documentId: string) => request<void>(`/api/organizations/${orgId}/documents/${documentId}`, { method: "DELETE" }),
  documentUrl: (orgId: string, documentId: string) => `${base}/api/organizations/${orgId}/documents/${documentId}/download`,
  acceptInvitation: (token: string, name: string, password?: string) => request<{ message: string }>("/api/auth/accept-invitation", { method: "POST", body: JSON.stringify({ token, name, password }) }),
  systemOverview: () => request<{ users: number; organizations: number; events: number }>("/api/system/overview")
};

export type User = {
  id: string; email: string; name: string; isSuperAdmin: boolean;
  memberships?: Array<{ organization: Organization; roles: Array<{ role: { key: string; name: string } }> }>;
};
export type Organization = { id: string; name: string; slug: string; timezone: string; status?: string; roles?: string[] };
export type Event = {
  id: string; type: string; status: string; title: string; startAt: string; endAt: string;
  venue?: string | null; conductor?: string | null; program?: string | null;
};
export type Trip = { id: string; title: string; startAt: string; endAt: string; status: string; eventLinks?: Array<{ event: Event }> };
export type Membership = { id: string; status: string; user: { id: string; name: string; email: string }; roles: Array<{ role: { key: string; name: string } }> };
export type Invitation = { id: string; email: string; roleKeys: string[]; expiresAt: string };
export type Document = { id: string; title: string; description?: string | null; fileName: string; mimeType: string; sizeBytes: string | number; visibility: string; createdAt: string; uploadedBy?: { name: string } };
