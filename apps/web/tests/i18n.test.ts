import { describe, expect, it } from "vitest";
import languages from "../src/languages.json";
import { apiErrorMessageKey, translate, validationMessageKey, type LanguageCode } from "../src/i18n";

describe("complete frontend translations", () => {
  const codes = Object.keys(languages) as LanguageCode[];
  const sourceKeys = Object.keys(languages.pt.translations).sort();

  it.each(codes)("provides every translation and interpolation parameter in %s", (code) => {
    const translations = languages[code].translations as Record<string, string>;
    expect(Object.keys(translations).sort()).toEqual(sourceKeys);
    for (const key of sourceKeys) {
      expect(translations[key]?.trim(), `${code}: ${key}`).toBeTruthy();
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(translations[key]!)).toEqual(placeholders((languages.pt.translations as Record<string, string>)[key]!));
    }
  });

  it("renders the Bulgarian password confirmation and password mismatch without English fallback", () => {
    expect(translate("bg", "Confirme a senha")).toBe("Потвърдете паролата");
    expect(translate("bg", "As senhas não coincidem.")).toBe("Паролите не съвпадат.");
  });

  it("translates application labels while preserving user-entered names", () => {
    expect(translate("bg", "Olá, {name}", { name: "Agenda" })).toBe("Здравейте, Agenda");
    expect(translate("de", 'Orquestra "{name}" criada. Adicione os membros em Administração de membros.', { name: "Nova viagem" })).toContain("Nova viagem");
  });

  it("maps the existing-account API error to the selected language instead of rendering Portuguese from the server", () => {
    const key = apiErrorMessageKey(409, { error: "ACCOUNT_EXISTS", message: "Entre na conta associada a este e-mail para aceitar o convite." });
    expect(key).toBe("error.accountExists");
    expect(translate("bg", key)).toMatch(/^Този профил вече съществува/);
    expect(translate("fr", key)).toMatch(/^Ce compte existe déjà/);
  });

  it.each([null, {}, "upstream error", { message: "Untranslated internal diagnostic" }])("handles unexpected API responses without leaking raw diagnostics: %j", (payload) => {
    expect(translate("bg", apiErrorMessageKey(520, payload))).toMatch(/^Сървърът/);
  });

  it("localizes schema validation, permissions, dates and rate limits", () => {
    expect(apiErrorMessageKey(400, { error: "VALIDATION_ERROR", issues: [{ format: "email" }] })).toBe("validation.email");
    expect(apiErrorMessageKey(400, { error: "VALIDATION_ERROR", issues: [{ path: ["password"], code: "too_small" }] })).toBe("error.password");
    expect(apiErrorMessageKey(400, { error: "VALIDATION_ERROR", issues: [{ message: "O término precisa ser posterior ao início." }] })).toBe("error.eventDates");
    expect(apiErrorMessageKey(403, { error: "ORG_PERMISSION_DENIED" })).toBe("error.forbidden");
    expect(apiErrorMessageKey(429, {})).toBe("error.rateLimit");
  });

  it("provides application-language messages for native form constraints", () => {
    expect(validationMessageKey({ valueMissing: true } as ValidityState)).toBe("validation.required");
    expect(translate("bg", validationMessageKey({ typeMismatch: true } as ValidityState))).toBe("Въведете валиден имейл адрес.");
    expect(validationMessageKey({ tooShort: true } as ValidityState)).toBe("validation.tooShort");
    expect(validationMessageKey({ patternMismatch: true } as ValidityState)).toBe("validation.pattern");
  });
});
