# Help translate

PDF Studio ships in English, Spanish, German, and French — and every string in
the app lives in a translation catalog, so adding your language is mostly a
matter of translating text. No code changes needed.

## The catalog

Each language is one JSON file:

```
src/locales/en/translation.json   ← English, the source of truth
src/locales/es/translation.json   ← Spanish
src/locales/de/translation.json   ← German
src/locales/fr/translation.json   ← French
```

The app bundles these files at build time: switching languages needs no
network request and works fully offline — consistent with PDF Studio's
privacy architecture.

## Two ways to contribute

**Crowdin (recommended, no code).** Translations are managed in Crowdin —
translate or vote on strings in your browser. Approved translations are pulled
into the repo automatically.

**Direct pull request.** Copy `src/locales/en/translation.json` to
`src/locales/<your-code>/translation.json` and translate every value:

- Keep every **key** byte-identical (including `_one` / `_other` plural forms).
- Keep every `{{placeholder}}` byte-identical — the app fills these in at runtime.
- Keep `<b>`, `<code>`, and `<i>` tags intact; they carry formatting.
- Don't translate brand names (PDF Studio, Reimagine), technical terms
  (AcroForm, OCR, AI, PDF, PNG), keyboard shortcuts (Ctrl+S, Esc), or font names.
- Then register the language in `src/i18n.ts` (`LANGUAGES`).

Run `npm test -- src/lib/i18n.test.ts` before opening the PR: the
catalog-completeness tests check your file key-for-key against English and fail
on missing keys, empty strings, or dropped placeholders.

## How language selection works

- The language picker in the top bar is always visible, with or without an open document.
- Your choice is saved on the device (`pdfstudio-lang`) and included in the
  one-click wipe, like every other PDF Studio preference.
- On first visit, the app follows your browser language when it's supported,
  and falls back to English otherwise.
- If a string is missing in your language, the English source shows instead of
  a blank or a raw key.
