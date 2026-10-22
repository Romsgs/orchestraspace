import languages from "./languages.json";

export type LanguageCode = keyof typeof languages;

export function translate(language: LanguageCode, key: string, values: Record<string, string> = {}) {
  const active = languages[language].translations as Record<string, string>;
  const english = languages.en.translations as Record<string, string>;
  const portuguese = languages.pt.translations as Record<string, string>;
  const template = active[key] ?? english[key] ?? portuguese[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

const apiErrors: Record<string, string> = {
  AUTH_REQUIRED: "error.auth", INVALID_SESSION: "error.auth",
  FORBIDDEN: "error.forbidden", ORG_PERMISSION_DENIED: "error.forbidden", DOCUMENT_ACCESS_DENIED: "error.forbidden",
  ORG_ACCESS_DENIED: "error.orgAccess", UNTRUSTED_ORIGIN: "error.origin",
  NOT_FOUND: "error.notFound", EVENT_NOT_FOUND: "error.notFound", TRIP_NOT_FOUND: "error.notFound",
  TRIP_OR_EVENT_NOT_FOUND: "error.notFound", DOCUMENT_NOT_FOUND: "error.notFound", MEMBERSHIP_NOT_FOUND: "error.notFound",
  ORGANIZATION_NOT_FOUND: "error.orgMissing", USER_NOT_FOUND: "error.userMissing",
  ROLE_NOT_FOUND: "error.roleMissing", INVALID_ROLE: "error.roleMissing", INVITATION_ROLES_INVALID: "error.roleMissing",
  ORPHANED_MEMBERSHIP: "error.memberMissing", INSTRUMENT_REQUIRED: "error.instrument",
  DUPLICATE_EVENTS: "error.duplicates", DUPLICATE_MUSICIANS: "error.duplicates",
  INVALID_EVENTS: "error.events", INVALID_MUSICIANS: "error.musicians",
  REQUEST_TOO_LARGE: "error.tooLarge", FILE_TOO_LARGE: "error.tooLarge",
  UNSUPPORTED_FILE_TYPE: "error.fileType", EMPTY_FILE: "error.emptyFile", FILE_CONTENT_MISMATCH: "error.fileMismatch",
  INTERNAL_ERROR: "error.internal", INVITATION_NOT_FOUND: "error.invitationMissing",
  INVITATION_ALREADY_USED: "error.invitationUsed", INVITATION_EXPIRED: "error.invitationExpired",
  ACCOUNT_INACTIVE: "error.inactive", ACCOUNT_EXISTS: "error.accountExists",
  INVITATION_EMAIL_MISMATCH: "error.invitationAccount", INVALID_CREDENTIALS: "error.credentials",
  PASSWORD_REQUIRED: "error.password", ACCOUNT_CREATED_CONCURRENTLY: "error.accountConflict"
};

export function apiErrorMessageKey(status: number, response: unknown) {
  const payload = (response && typeof response === "object" ? response : {}) as {
    error?: string;
    issues?: Array<{ code?: string; format?: string; path?: unknown[]; message?: string }>;
  };
  if (payload.error === "VALIDATION_ERROR") {
    const issues = Array.isArray(payload.issues) ? payload.issues.filter((issue) => issue && typeof issue === "object") : [];
    if (issues.some((issue) => issue.message === "O término precisa ser posterior ao início.")) return "error.eventDates";
    if (issues.some((issue) => issue.message === "A data final não pode ser anterior à inicial.")) return "error.tripDates";
    if (issues.some((issue) => issue.format === "email")) return "validation.email";
    if (issues.some((issue) => Array.isArray(issue.path) && issue.path.includes("password") && issue.code === "too_small")) return "error.password";
    return "error.validation";
  }
  if (typeof payload.error === "string" && apiErrors[payload.error]) return apiErrors[payload.error];
  if (status === 401) return "error.auth";
  if (status === 403) return "error.forbidden";
  if (status === 404) return "error.notFound";
  if (status === 429) return "error.rateLimit";
  if (status >= 502) return "error.serviceUnavailable";
  return status >= 500 ? "error.internal" : "error.request";
}

export function validationMessageKey(validity: ValidityState) {
  if (validity.valueMissing) return "validation.required";
  if (validity.typeMismatch) return "validation.email";
  if (validity.tooShort) return "validation.tooShort";
  if (validity.tooLong) return "validation.tooLong";
  if (validity.patternMismatch) return "validation.pattern";
  if (validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch || validity.badInput) return "validation.value";
  return "error.validation";
}
