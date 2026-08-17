"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type WordStatus = "learning" | "known" | "error";
type Word = {
  id: string;
  dictionaryId?: string;
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  addedAt: string;
  status: WordStatus;
  errorCount: number;
  correctStreak: number;
};
const STATUS_THRESHOLD = 5; // recommend 5 over 10 for session length; user asked about 10
const STATUS_LABEL: Record<WordStatus, string> = { learning: "Не изучены", known: "Без ошибок", error: "С ошибками" };
type PracticePromptMode = "source" | "target" | "mixed";

function resolvePromptSide(mode: PracticePromptMode, wordId: string): "source" | "target" {
  if (mode === "source" || mode === "target") return mode;
  let hash = 0;
  for (let index = 0; index < wordId.length; index += 1) hash = (hash * 33 + wordId.charCodeAt(index)) >>> 0;
  return hash % 2 === 0 ? "source" : "target";
}

function getPracticeSides(word: Word, mode: PracticePromptMode) {
  const side = resolvePromptSide(mode, word.id);
  if (side === "source") {
    return { side, prompt: word.source, promptLang: word.sourceLang, answer: word.target, answerLang: word.targetLang };
  }
  return { side, prompt: word.target, promptLang: word.targetLang, answer: word.source, answerLang: word.sourceLang };
}
type Dictionary = { id: string; sourceLang: string; targetLang: string };
type Scope = "all" | "clean" | "errors" | "known" | "unlearned";
type View = "library" | "calendar" | "cards" | "match" | "type";
type AddMode = "paste" | "file" | "single";
type ExportFormat = "csv" | "txt" | "json";
type ContextWordFilter = "day" | "known" | "errors";
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const TODAY = "2026-08-12";
const DEFAULT_DICTIONARY_ID = "english-russian";
const LANGUAGES = ["Автоопределение", "English", "Русский", "Deutsch", "Español", "Français", "ქართული"];
const DICTIONARY_LANGUAGES = LANGUAGES.slice(1);
const starterDictionaries: Dictionary[] = [{ id: DEFAULT_DICTIONARY_ID, sourceLang: "English", targetLang: "Русский" }];
const starterWords: Word[] = [
  ["circumstances", "обстоятельства", "2026-08-12"],
  ["to intend", "намереваться", "2026-08-12"],
  ["headphones", "наушники", "2026-08-12"],
  ["invasion", "вторжение", "2026-08-11"],
  ["residence permission", "вид на жительство", "2026-08-11"],
  ["to treat", "лечить; обращаться с кем-то", "2026-07-22"],
  ["recently", "недавно, в последнее время", "2026-07-22"],
  ["thorough", "тщательный", "2026-07-22"],
].map(([source, target, addedAt], index) => ({ id: `starter-${index}`, source, target, addedAt, sourceLang: "English", targetLang: "Русский", status: index === 3 ? "error" : index === 6 ? "known" : "learning", errorCount: index === 3 ? 2 : 0, correctStreak: 0 } as Word));

const monthNames = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const langCode: Record<string, string> = { English: "en-US", Русский: "ru-RU", Deutsch: "de-DE", Español: "es-ES", Français: "fr-FR", ქართული: "ka-GE" };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function normalizeForMatch(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function matchSimilarity(query: string, candidate: string) {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedCandidate = normalizeForMatch(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;
  const score = 1 - levenshteinDistance(normalizedQuery, normalizedCandidate) / Math.max(normalizedQuery.length, normalizedCandidate.length);
  return Math.min(1, score + (normalizedQuery[0] === normalizedCandidate[0] ? 0.08 : 0));
}

function findSimilarWords(query: string, words: Word[]) {
  const normalizedQuery = normalizeForMatch(query);
  if (normalizedQuery.length < 3) return [];
  const threshold = normalizedQuery.length <= 4 ? 0.58 : 0.46;
  return words
    .map((word) => ({ word, score: Math.max(matchSimilarity(query, word.source), matchSimilarity(query, word.target)) }))
    .filter(({ word, score }) => score >= threshold && normalizeForMatch(word.source) !== normalizedQuery && normalizeForMatch(word.target) !== normalizedQuery)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ word }) => word);
}

function detectLanguage(value: string) {
  if (/[а-яё]/i.test(value)) return "Русский";
  if (/[Ⴀ-ჿ]/.test(value)) return "ქართული";
  return "English";
}

const translationLanguageCode: Record<string, string> = {
  English: "en",
  Русский: "ru",
  Deutsch: "de",
  Español: "es",
  Français: "fr",
  ქართული: "ka",
};

async function translateText(value: string, sourceLanguage: string, targetLanguage: string) {
  const source = translationLanguageCode[sourceLanguage] ?? "auto";
  const target = translationLanguageCode[targetLanguage] ?? "ru";
  if (source === target) return value;
  const params = new URLSearchParams({ client: "gtx", sl: source, tl: target, dt: "t", q: value });
  try {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
    if (!response.ok) return "";
    const payload = await response.json() as Array<Array<Array<string>>>;
    return payload[0]?.map((segment) => segment[0] ?? "").join("").trim() ?? "";
  } catch {
    return "";
  }
}

function normalizeDate(value: string, fallback = TODAY) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const parts = clean.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return parts ? `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}` : fallback;
}

function parsePairs(text: string, fallbackDate: string, sourceLanguage: string, targetLanguage: string): Word[] {
  let currentDate = fallbackDate;
  const result: Word[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/^[-•]\s*/, "");
    if (!line) continue;
    const dateLine = line.match(/^(?:дата|date)?\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})$/i);
    if (dateLine) { currentDate = normalizeDate(dateLine[1], fallbackDate); continue; }
    let parts = line.split(/\t|;|\s+[—–→=]\s+|\s+-\s+/).map((item) => item.replace(/^"|"$/g, "").trim()).filter(Boolean);
    if (parts.length < 2 && line.includes(",")) parts = line.split(",").map((item) => item.replace(/^"|"$/g, "").trim()).filter(Boolean);
    if (parts.length < 2 && line.includes(":")) parts = line.split(/:\s+/).map((item) => item.trim()).filter(Boolean);
    let rowDate = currentDate;
    if (/^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})$/.test(parts[0])) rowDate = normalizeDate(parts.shift()!, currentDate);
    const source = parts.shift()!;
    const target = parts.join("; ").trim();
    if (/^(word|слово|english)$/i.test(source) && /^(translation|перевод|russian)$/i.test(target)) continue;
    result.push({ id: uid(), source, target, addedAt: rowDate, sourceLang: sourceLanguage === LANGUAGES[0] ? detectLanguage(source) : sourceLanguage, targetLang: targetLanguage === LANGUAGES[0] ? detectLanguage(target) : targetLanguage, status: "learning", errorCount: 0, correctStreak: 0 });
  }
  return result;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatInputDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatWordCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "слов" : last === 1 ? "слово" : last >= 2 && last <= 4 ? "слова" : "слов";
  return `${count} ${word}`;
}

function formatDayCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней";
  return `${count} ${word}`;
}

function matchesScope(word: Word, scope: Scope) {
  if (scope === "errors") return word.status === "error" || word.errorCount > 0;
  if (scope === "known") return word.status === "known";
  if (scope === "unlearned") return word.status === "learning";
  if (scope === "clean") return word.status !== "error" && word.errorCount === 0;
  return true;
}

function normalizeWord(word: Word): Word {
  return { ...word, errorCount: word.errorCount ?? 0, correctStreak: word.correctStreak ?? 0 };
}

function practicePatch(word: Word, ok: boolean): { patch: Partial<Word>; promoted: WordStatus | null } {
  if (ok) {
    const correctStreak = (word.correctStreak ?? 0) + 1;
    if (correctStreak >= STATUS_THRESHOLD) {
      return {
        patch: { correctStreak, status: "known", errorCount: 0 },
        promoted: word.status === "known" ? null : "known",
      };
    }
    return { patch: { correctStreak }, promoted: null };
  }
  const errorCount = word.errorCount + 1;
  const correctStreak = 0;
  if (errorCount >= STATUS_THRESHOLD) {
    return {
      patch: { errorCount, correctStreak, status: "error" },
      promoted: word.status === "error" ? null : "error",
    };
  }
  return {
    patch: { errorCount, correctStreak, status: word.status === "known" ? "learning" : word.status },
    promoted: null,
  };
}

function downloadDictionary(words: Word[], format: ExportFormat) {
  const sortedWords = [...words].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.source.localeCompare(b.source));
  let content = "";
  let mimeType = "text/plain;charset=utf-8";

  if (format === "csv") {
    const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = sortedWords.map(word => [word.addedAt, word.source, word.target, word.sourceLang, word.targetLang, STATUS_LABEL[word.status], word.errorCount].map(escapeCell).join(";"));
    content = `\uFEFF${["Дата добавления", "Слово", "Перевод", "Язык слова", "Язык перевода", "Статус", "Количество ошибок"].map(escapeCell).join(";")}\n${rows.join("\n")}`;
    mimeType = "text/csv;charset=utf-8";
  } else if (format === "json") {
    content = JSON.stringify({ exportedAt: new Date().toISOString(), words: sortedWords }, null, 2);
    mimeType = "application/json;charset=utf-8";
  } else {
    const groups = sortedWords.reduce<Record<string, Word[]>>((result, word) => {
      result[word.addedAt] = [...(result[word.addedAt] ?? []), word];
      return result;
    }, {});
    content = Object.entries(groups).map(([date, items]) => `Дата: ${date}\n${items.map(word => `${word.source} — ${word.target}\n#META ${word.sourceLang}|${word.targetLang}|${STATUS_LABEL[word.status]}|${word.errorCount}`).join("\n")}`).join("\n\n");
  }

  const blobUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `lingua-dictionary-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export default function Home() {
  const [words, setWords] = useState<Word[]>(starterWords);
  const [dictionaries, setDictionaries] = useState<Dictionary[]>(starterDictionaries);
  const [selectedDictionaryId, setSelectedDictionaryId] = useState(DEFAULT_DICTIONARY_ID);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("library");
  const [scope, setScope] = useState<Scope>("all");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date("2026-08-01T12:00:00"));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [trainingCalendarOpen, setTrainingCalendarOpen] = useState(false);
  const [contextWordFilter, setContextWordFilter] = useState<ContextWordFilter>("day");
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("paste");
  const [addTargetId, setAddTargetId] = useState<string | "new">(DEFAULT_DICTIONARY_ID);
  const [newSourceLang, setNewSourceLang] = useState("English");
  const [newTargetLang, setNewTargetLang] = useState("Русский");
  const [bulkText, setBulkText] = useState("");
  const [addDate, setAddDate] = useState(TODAY);
  const [addDateOpen, setAddDateOpen] = useState(false);
  const [addCalendarMonth, setAddCalendarMonth] = useState(() => new Date(`${TODAY}T12:00:00`));
  const [singleSource, setSingleSource] = useState("");
  const [singleTarget, setSingleTarget] = useState("");
  const [previewWords, setPreviewWords] = useState<Word[]>([]);
  const [isTranslatingPreview, setIsTranslatingPreview] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [fileName, setFileName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "alpha">("newest");
  const [cardIndex, setCardIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [cardFlash, setCardFlash] = useState<"success" | "error" | null>(null);
  const [answer, setAnswer] = useState("");
  const cardFlashTimerRef = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [listening, setListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
  const [matchLeft, setMatchLeft] = useState<string | null>(null);
  const [matchRight, setMatchRight] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [matchFlash, setMatchFlash] = useState<"success" | "error" | null>(null);
  const [statusOffer, setStatusOffer] = useState<null | { wordId: string; status: WordStatus; label: string; suggest: WordStatus }>(null);
  const [practicePromptMode, setPracticePromptMode] = useState<PracticePromptMode>("source");
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      if (cardFlashTimerRef.current) window.clearTimeout(cardFlashTimerRef.current);
    };
  }, []);
  useEffect(() => {
    let saved: string | null = null;
    let savedDictionaries: string | null = null;
    let savedSelectedDictionary: string | null = null;
    try {
      saved = localStorage.getItem("lingua-words-v2");
      savedDictionaries = localStorage.getItem("lingua-dictionaries-v1");
      savedSelectedDictionary = localStorage.getItem("lingua-selected-dictionary-v1");
    } catch {
      // Some local previews use an opaque browser origin where storage is unavailable.
    }
    /* eslint-disable react-hooks/set-state-in-effect -- restore browser-only dictionary state after hydration */
    if (saved) try {
      const parsed = JSON.parse(saved) as Word[];
      setWords(parsed.map(normalizeWord));
    } catch { /* keep starter data */ }
    if (savedDictionaries) try { setDictionaries(JSON.parse(savedDictionaries)); } catch { /* keep starter dictionary */ }
    if (savedSelectedDictionary) setSelectedDictionaryId(savedSelectedDictionary);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-words-v2", JSON.stringify(words)); } catch { /* storage unavailable */ } }, [words, hydrated]);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-dictionaries-v1", JSON.stringify(dictionaries)); } catch { /* storage unavailable */ } }, [dictionaries, hydrated]);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-selected-dictionary-v1", selectedDictionaryId); } catch { /* storage unavailable */ } }, [selectedDictionaryId, hydrated]);

  const currentDictionary = dictionaries.find((dictionary) => dictionary.id === selectedDictionaryId) ?? dictionaries[0] ?? starterDictionaries[0];
  const addTargetDictionary = addTargetId === "new" ? null : dictionaries.find((dictionary) => dictionary.id === addTargetId) ?? currentDictionary;
  const isCreatingDictionary = addTargetId === "new";
  const addSourceLang = isCreatingDictionary ? newSourceLang : addTargetDictionary!.sourceLang;
  const addTargetLang = isCreatingDictionary ? newTargetLang : addTargetDictionary!.targetLang;
  const newDictionaryLanguagesInvalid = isCreatingDictionary && newSourceLang === newTargetLang;
  const dictionaryWords = words.filter((word) => (word.dictionaryId ?? DEFAULT_DICTIONARY_ID) === currentDictionary.id);
  const errors = dictionaryWords.filter((word) => word.status === "error" || word.errorCount > 0);
  const knownWords = dictionaryWords.filter((word) => word.status === "known");
  const isTraining = view === "cards" || view === "match" || view === "type";
  const dateCounts = useMemo(() => dictionaryWords.reduce<Record<string, number>>((acc, word) => ({ ...acc, [word.addedAt]: (acc[word.addedAt] ?? 0) + 1 }), {}), [dictionaryWords]);
  const selectedDate = selectedDates.length === 1 ? selectedDates[0] : null;
  const sidebarWords = selectedDates.length ? dictionaryWords.filter((word) => selectedDates.includes(word.addedAt)) : dictionaryWords;
  const allDictionaryDates = Object.keys(dateCounts).sort();
  const inputPeriodDates = selectedDates.length ? [...selectedDates].sort() : allDictionaryDates;
  const inputPeriodLabel = inputPeriodDates.length === 0 ? "Нет добавленных слов" : inputPeriodDates.length === 1 ? formatInputDate(inputPeriodDates[0]) : `${formatInputDate(inputPeriodDates[0])} — ${formatInputDate(inputPeriodDates[inputPeriodDates.length - 1])}`;
  const contextWords = contextWordFilter === "day" ? sidebarWords : contextWordFilter === "known" ? knownWords : errors;
  const trainingPeriodWords = selectedDates.length ? dictionaryWords.filter((word) => selectedDates.includes(word.addedAt)) : dictionaryWords;
  const trainingCleanWords = trainingPeriodWords.filter((word) => matchesScope(word, "clean"));
  const trainingErrorWords = trainingPeriodWords.filter((word) => matchesScope(word, "errors"));
  const trainingUnlearnedWords = trainingPeriodWords.filter((word) => matchesScope(word, "unlearned"));
  const filteredWords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return dictionaryWords
      .filter((word) => matchesScope(word, scope) && (!selectedDates.length || selectedDates.includes(word.addedAt)))
      .filter((word) => !query || `${word.source} ${word.target}`.toLocaleLowerCase("ru-RU").includes(query))
      .sort((a, b) => sortOrder === "alpha" ? a.source.localeCompare(b.source) : sortOrder === "oldest" ? a.addedAt.localeCompare(b.addedAt) : b.addedAt.localeCompare(a.addedAt));
  }, [dictionaryWords, scope, selectedDates, search, sortOrder]);
  const normalizedSearch = search.trim().toLocaleLowerCase("ru-RU");
  const hasDictionaryMatch = Boolean(normalizedSearch) && dictionaryWords.some((word) => `${word.source} ${word.target}`.toLocaleLowerCase("ru-RU").includes(normalizedSearch));
  const similarWords = useMemo(() => normalizedSearch && !hasDictionaryMatch ? findSimilarWords(search, dictionaryWords) : [], [search, dictionaryWords, normalizedSearch, hasDictionaryMatch]);
  const practiceWords = filteredWords;
  const current = practiceWords[cardIndex % Math.max(practiceWords.length, 1)];
  const currentSides = current ? getPracticeSides(current, practicePromptMode) : null;
  const parsedPreviewWords = useMemo(() => parsePairs(bulkText, addDate, addSourceLang, addTargetLang), [bulkText, addDate, addSourceLang, addTargetLang]);
  const previewDictionary = addTargetId === "new"
    ? dictionaries.find((dictionary) => dictionary.sourceLang === newSourceLang && dictionary.targetLang === newTargetLang)
    : addTargetDictionary;
  const previewDictionaryWords = previewDictionary
    ? words.filter((word) => (word.dictionaryId ?? DEFAULT_DICTIONARY_ID) === previewDictionary.id)
    : [];
  const existingPreviewSources = new Set(previewDictionaryWords.map((word) => normalizeForMatch(word.source)));
  const importablePreviewWords = previewWords.filter((word) => word.source.trim() && word.target.trim() && !existingPreviewSources.has(normalizeForMatch(word.source)));
  const matchWords = practiceWords.slice(0, 6);
  const matchPairs = useMemo(() => matchWords.map((word) => {
    const sides = getPracticeSides(word, practicePromptMode);
    return { word, left: sides.prompt, right: sides.answer };
  }), [matchWords, practicePromptMode]);
  const matchTranslations = useMemo(() => [...matchPairs].sort((a, b) => a.right.localeCompare(b.right, "ru")), [matchPairs]);

  const calendarCells = useMemo(() => buildMonthCells(calendarMonth, dateCounts), [calendarMonth, dateCounts]);
  const addCalendarCells = useMemo(() => buildMonthCells(addCalendarMonth), [addCalendarMonth]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreviewWords(parsedPreviewWords);
      const missing = parsedPreviewWords.filter((word) => !word.target.trim());
      if (!missing.length) {
        setIsTranslatingPreview(false);
        return;
      }
      setIsTranslatingPreview(true);
      const translations = await Promise.all(missing.map(async (word) => ({
        id: word.id,
        target: await translateText(word.source, addSourceLang, addTargetLang),
      })));
      if (cancelled) return;
      const translatedById = new Map(translations.map((translation) => [translation.id, translation.target]));
      setPreviewWords((current) => current.map((word) => {
        if (word.target.trim()) return word;
        return { ...word, target: translatedById.get(word.id) ?? "" };
      }));
      setIsTranslatingPreview(false);
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [parsedPreviewWords, addSourceLang, addTargetLang]);

  function updateWord(id: string, patch: Partial<Word>) { setWords((items) => items.map((word) => word.id === id ? { ...word, ...patch } : word)); }
  function updatePreviewWord(id: string, patch: Pick<Partial<Word>, "source" | "target">) {
    setPreviewWords((items) => items.map((word) => word.id === id ? { ...word, ...patch } : word));
  }
  function selectDictionary(dictionary: Dictionary) {
    setSelectedDictionaryId(dictionary.id);
    setSelectedDates([]);
    setSearch("");
    setScope("all");
    resetPracticeState();
    setView("library");
  }
  function openAdd(mode: AddMode = "paste", target: "current" | "new" = "current") {
    setAddMode(mode);
    setAddDateOpen(false);
    setImportStatus("");
    if (target === "new") {
      setAddTargetId("new");
      setNewSourceLang("English");
      setNewTargetLang("Русский");
    } else {
      setAddTargetId(currentDictionary.id);
    }
    setAddOpen(true);
  }
  function closeAdd() {
    setAddDateOpen(false);
    setAddOpen(false);
    setImportStatus("");
  }
  function resolveAddDictionary(): Dictionary | null {
    if (isCreatingDictionary) {
      if (newSourceLang === newTargetLang) return null;
      const existing = dictionaries.find((dictionary) => dictionary.sourceLang === newSourceLang && dictionary.targetLang === newTargetLang);
      if (existing) return existing;
      return { id: uid(), sourceLang: newSourceLang, targetLang: newTargetLang };
    }
    return addTargetDictionary;
  }
  function setSelectedDate(date: string | null) { setSelectedDates(date ? [date] : []); }
  function toggleSelectedDate(date: string) {
    setSelectedDates((current) => current.includes(date) ? current.filter((item) => item !== date) : [...current, date].sort());
    setSearch("");
    resetPracticeState();
    if (isTraining) return;
    setContextWordFilter("day");
    setView("library");
    setScope("all");
  }
  function clearSelectedDates() {
    setSelectedDates([]);
    setSearch("");
    resetPracticeState();
    if (!isTraining) { setContextWordFilter("day"); setView("library"); setScope("all"); }
  }
  function resetPracticeState() {
    if (cardFlashTimerRef.current) window.clearTimeout(cardFlashTimerRef.current);
    setCardIndex(0); setRevealed(false); setCardFlash(null); setFeedback("idle"); setAnswer(""); setSpeechMessage(""); setMatched([]); setStatusOffer(null);
  }
  function startPractice(nextScope: Scope, nextDate: string | null = selectedDate) { setScope(nextScope); setSelectedDate(nextDate); setSearch(""); resetPracticeState(); setView("cards"); }
  function openTraining(nextView: "cards" | "match" | "type") {
    if (!isTraining) setScope("all");
    setSearch(""); resetPracticeState(); setView(nextView);
  }
  function selectPracticeScope(nextScope: "all" | "clean" | "errors" | "unlearned") { setScope(nextScope); setSearch(""); resetPracticeState(); }
  function markCurrent(status: WordStatus) {
    if (!current || cardFlash) return;
    updateWord(current.id, {
      status,
      errorCount: status === "error" ? current.errorCount + 1 : status === "known" ? 0 : current.errorCount,
      correctStreak: status === "known" ? STATUS_THRESHOLD : status === "error" ? 0 : current.correctStreak ?? 0,
    });
    setStatusOffer(null);
    const advance = () => {
      setCardFlash(null);
      setCardIndex((index) => index + 1);
      setRevealed(false);
      setFeedback("idle");
      setAnswer("");
    };
    if (status === "known" || status === "error") {
      setCardFlash(status === "known" ? "success" : "error");
      if (cardFlashTimerRef.current) window.clearTimeout(cardFlashTimerRef.current);
      cardFlashTimerRef.current = window.setTimeout(advance, 420);
      return;
    }
    advance();
  }
  function applyStatusMove(wordId: string, status: WordStatus) {
    const word = words.find((item) => item.id === wordId);
    if (!word) return;
    updateWord(wordId, {
      status,
      errorCount: status === "error" ? Math.max(1, word.errorCount) : status === "known" ? 0 : word.errorCount,
      correctStreak: status === "known" ? STATUS_THRESHOLD : status === "error" ? 0 : word.correctStreak ?? 0,
    });
    setStatusOffer(null);
  }
  function addParsed(items: Word[]) {
    if (!items.length) { setImportStatus("Не удалось найти пары. Используйте формат: word — перевод"); return; }
    if (newDictionaryLanguagesInvalid) { setImportStatus("Выберите два разных языка для словаря"); return; }
    const dictionary = resolveAddDictionary();
    if (!dictionary) { setImportStatus("Выберите словарь"); return; }
    const existingSources = new Set(
      words
        .filter((word) => (word.dictionaryId ?? DEFAULT_DICTIONARY_ID) === dictionary.id)
        .map((word) => normalizeForMatch(word.source)),
    );
    const incomingSources = new Set<string>();
    const importableItems = items.filter((word) => {
      const source = normalizeForMatch(word.source);
      if (!source || !word.target.trim() || existingSources.has(source) || incomingSources.has(source)) return false;
      incomingSources.add(source);
      return true;
    });
    if (!importableItems.length) {
      setImportStatus("Новых слов для добавления нет. Проверьте переводы и отмеченные совпадения.");
      return;
    }
    const isNew = !dictionaries.some((item) => item.id === dictionary.id);
    if (isNew) setDictionaries((items) => [...items, dictionary]);
    setWords((currentWords) => [...importableItems.map((word) => ({ ...word, dictionaryId: dictionary.id, sourceLang: dictionary.sourceLang, targetLang: dictionary.targetLang })), ...currentWords]);
    selectDictionary(dictionary);
    setAddTargetId(dictionary.id);
    setImportStatus(isNew ? `Словарь создан. Добавлено слов: ${importableItems.length}` : `Добавлено слов: ${importableItems.length}`);
    setBulkText("");
    setFileName("");
    window.setTimeout(() => { closeAdd(); }, 700);
  }
  function addSingle() {
    if (!singleSource.trim() || !singleTarget.trim()) { setImportStatus("Заполните слово и перевод"); return; }
    addParsed(parsePairs(`${singleSource.trim()} — ${singleTarget.trim()}`, addDate, addSourceLang, addTargetLang));
    setSingleSource(""); setSingleTarget("");
  }
  async function extractFile(file: File) {
    setFileName(file.name); setImportStatus("Читаю файл…");
    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      let text = "";
      if (["txt", "csv", "tsv"].includes(extension ?? "")) text = await file.text();
      else if (extension === "docx") {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      } else if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const content = await (await pdf.getPage(pageNumber)).getTextContent();
          text += `${content.items.map((item) => "str" in item ? item.str : "").join(" ")}\n`;
        }
      } else if (file.type.startsWith("image/")) {
        setImportStatus("Распознаю текст на изображении…");
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng+rus");
        text = (await worker.recognize(file)).data.text;
        await worker.terminate();
      } else throw new Error("unsupported");
      setBulkText(text); setAddMode("paste");
      const count = parsePairs(text, addDate, addSourceLang, addTargetLang).length;
      setImportStatus(count ? `Распознано строк: ${count}. Проверьте слова и переводы перед добавлением.` : "Текст извлечён, но слова не найдены.");
    } catch {
      setImportStatus("Не удалось прочитать файл. Проверьте формат и попробуйте ещё раз.");
    }
  }
  function changePracticePromptMode(mode: PracticePromptMode) {
    setPracticePromptMode(mode);
    setRevealed(false);
    setCardFlash(null);
    setFeedback("idle");
    setAnswer("");
    setSpeechMessage("");
    setStatusOffer(null);
    setMatched([]);
    setMatchLeft(null);
    setMatchRight(null);
    setMatchFlash(null);
  }
  function checkAnswer() {
    if (!current || !currentSides) return;
    const ok = answer.trim().toLowerCase() === currentSides.answer.trim().toLowerCase();
    const { patch } = practicePatch(current, ok);
    setFeedback(ok ? "success" : "error");
    updateWord(current.id, patch);
  }
  function chooseMatch(side: "left" | "right", value: string) {
    if (matchFlash) return;
    const left = side === "left" ? value : matchLeft;
    const right = side === "right" ? value : matchRight;
    if (side === "left") setMatchLeft(value);
    else setMatchRight(value);
    if (left && right) {
      const pair = matchPairs.find((item) => item.word.id === left);
      const word = pair?.word;
      const ok = Boolean(pair && pair.right === right);
      setMatchFlash(ok ? "success" : "error");
      if (word) {
        const { patch } = practicePatch(word, ok);
        updateWord(word.id, patch);
      }
      window.setTimeout(() => {
        if (ok && word) setMatched((items) => [...new Set([...items, word.id])]);
        setMatchLeft(null);
        setMatchRight(null);
        setMatchFlash(null);
      }, ok ? 520 : 580);
    }
  }
  function speakVisible(word: Word, showAnswer = false) {
    const sides = getPracticeSides(word, practicePromptMode);
    const text = showAnswer ? sides.answer : sides.prompt;
    const lang = showAnswer ? sides.answerLang : sides.promptLang;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode[lang] ?? "en-US";
    speechSynthesis.speak(utterance);
  }
  function speak(word: Word) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.source);
    utterance.lang = langCode[word.sourceLang] ?? "en-US";
    speechSynthesis.speak(utterance);
  }
  function startVoiceInput() {
    if (!current) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setSpeechMessage("Голосовой ввод не поддерживается этим браузером."); return; }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = langCode[currentSides?.answerLang ?? current.targetLang] ?? "ru-RU";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => { setAnswer(event.results[0][0].transcript); setFeedback("idle"); setSpeechMessage("Ответ распознан — можно проверить."); };
    recognition.onerror = () => setSpeechMessage("Не удалось распознать речь. Попробуйте ещё раз.");
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    setSpeechMessage("Говорите перевод…");
    setListening(true);
    recognition.start();
  }

  return <main className="app-canvas">
    <section className={`workspace ${isTraining ? "training-mode" : view === "library" ? "library-mode" : ""}`}>
      <aside className="rail">
        <button className="brand" onClick={() => { setView("library"); setScope("all"); setSelectedDate(null); }}>lingua<span>.</span></button>
        <p className="dictionary-switcher-label">Какой словарь?</p>
        <details className="dictionary-switcher">
          <summary aria-label={`Выбран словарь: ${currentDictionary.sourceLang} — ${currentDictionary.targetLang}`}>
            <span>{currentDictionary.sourceLang} — {currentDictionary.targetLang}</span>
            <i className="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</i>
          </summary>
          <div className="dictionary-switcher-menu" role="listbox" aria-label="Выбрать словарь">
            {dictionaries.map((dictionary) => {
              const count = words.filter((word) => (word.dictionaryId ?? DEFAULT_DICTIONARY_ID) === dictionary.id).length;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={dictionary.id === currentDictionary.id}
                  className={dictionary.id === currentDictionary.id ? "active" : ""}
                  key={dictionary.id}
                  onClick={(event) => {
                    selectDictionary(dictionary);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <span>{dictionary.sourceLang} — {dictionary.targetLang}</span>
                  <b>{formatWordCount(count)}</b>
                </button>
              );
            })}
            <button type="button" className="dictionary-create" onClick={(event) => { openAdd("paste", "new"); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className="material-symbols-outlined" aria-hidden="true">add</span>Добавить словарь</button>
          </div>
        </details>

        <button className="rail-add" onClick={() => openAdd("paste")}>Добавить слова</button>

        <div className="rail-section">
          <nav className="rail-nav quiet" aria-label="Обучение">
            <button className={`training-entry ${isTraining ? "active" : ""}`} onClick={() => openTraining("cards")}><b>Учить слова</b></button>
          </nav>
          <div className="rail-training-settings">
            <div className={`period-picker ${trainingCalendarOpen ? "open" : ""}`}>
              <label className="period-label" htmlFor="training-period">За какой период?</label>
              <div className="period-control-wrap">
                <button id="training-period" className="period-control" type="button" aria-label={`${trainingCalendarOpen ? "Закрыть" : "Открыть"} календарь. Выбранный период: ${inputPeriodLabel}`} aria-haspopup="dialog" aria-expanded={trainingCalendarOpen} aria-controls="training-calendar-panel" onClick={() => setTrainingCalendarOpen((open) => !open)}>
                  <span>{inputPeriodLabel}</span>
                  <i className="material-symbols-outlined calendar-glyph" aria-hidden="true">calendar_month</i>
                </button>
                {trainingCalendarOpen && <MonthCalendar
                  id="training-calendar-panel"
                  label="Выбор периода"
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  cells={calendarCells}
                  mode="period"
                  selectedDates={selectedDates}
                  onToggleDate={toggleSelectedDate}
                  footer={<div className={`calendar-period-summary ${selectedDates.length ? "" : "is-all"}`}>
                    <span>{selectedDates.length ? `${formatDayCount(selectedDates.length)} · ${formatWordCount(trainingPeriodWords.length)}` : `За все дни · ${formatWordCount(dictionaryWords.length)}`}</span>
                    {!!selectedDates.length && <button type="button" onClick={clearSelectedDates}>Сбросить</button>}
                  </div>}
                />}
              </div>
            </div>
            <TrainingFilters scope={scope} total={trainingPeriodWords.length} clean={trainingCleanWords.length} errors={trainingErrorWords.length} unlearned={trainingUnlearnedWords.length} onChange={selectPracticeScope} />
          </div>
        </div>

      </aside>

      <section className="main-pane">
        {view === "library" && <>
          <header className="main-toolbar">
            <div className="screen-title">
              <div>
                <p>Словарь</p>
                <h1>{currentDictionary.sourceLang} — {currentDictionary.targetLang}</h1>
              </div>
              <div className="library-title-actions">
                <details className="export-menu">
                  <summary><span className="material-symbols-outlined export-icon" aria-hidden="true">download</span>Скачать словарь</summary>
                  <div role="menu" aria-label="Как скачать словарь">
                    {([
                      ["csv", "CSV", "Открыть в Excel", "Таблица со словами, датами и статусами — удобно смотреть и фильтровать"],
                      ["txt", "TXT", "Потом загрузить обратно", "Список, который можно снова импортировать в Lingua"],
                      ["json", "JSON", "Сохранить полную копию", "На случай потери данных: все слова и прогресс"],
                    ] as const).map(([format, badge, title, description]) => (
                      <button
                        key={format}
                        role="menuitem"
                        onClick={event => {
                          downloadDictionary(dictionaryWords, format);
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        <span className="export-option-main">
                          <b>{title}</b>
                          <span>{description}</span>
                        </span>
                        <em className="export-option-badge">{badge}</em>
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
            <div className="search-row">
              <span className="material-symbols-outlined search-icon" aria-hidden="true">search</span>
              <input className="search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Например: обстоятельства" aria-label="Поиск по слову или переводу" />
            </div>
            <nav className="quick-add-row" aria-label="Способы добавления слов">
              <MenuSelect className="sort-menu quick-sort-menu" ariaLabel="Сортировка" value={sortOrder} options={[{ value: "newest", label: "Сначала новые" }, { value: "oldest", label: "Сначала старые" }, { value: "alpha", label: "По алфавиту" }]} onChange={(value) => setSortOrder(value as "newest" | "oldest" | "alpha")} />
              <div className="quick-add-actions">
                <button type="button" onClick={() => openAdd("single")}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Одно слово</button>
                <button type="button" onClick={() => openAdd("paste")}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Группа слов</button>
                <button type="button" aria-label="Распознать слова с фото или файла: TXT, CSV, DOCX, PDF, PNG, JPG, WEBP" onClick={() => openAdd("file")}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Слова с фото или файла</button>
              </div>
            </nav>
          </header>
        </>}

        {view === "calendar" && <header className="main-toolbar calendar-toolbar"><div className="screen-title"><div><p>ИСТОРИЯ СЛОВ</p><h1>Календарь</h1></div></div><div className="calendar-toolbar-actions"><button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>Предыдущий месяц</button><b>{monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</b><button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>Следующий месяц</button></div></header>}

        <div className="content-scroll">
          {view === "library" && (filteredWords.length ? <LibraryView words={filteredWords} editId={editId} setEditId={setEditId} updateWord={updateWord} setWords={setWords} speak={speak} onStartTraining={(date) => startPractice("all", date)} /> : <LibraryEmptyState query={search.trim()} hasDictionaryMatch={hasDictionaryMatch} similarWords={similarWords} onSelectSuggestion={(word) => { setScope("all"); setSelectedDates([]); setSearch(word.source); }} onAddSingle={() => { setSingleSource(search.trim()); setSingleTarget(""); openAdd("single"); }} onUpload={() => openAdd("file")} onReset={() => { setScope("all"); setSelectedDates([]); }} />)}
          {view === "calendar" && <CalendarView cells={calendarCells} words={dictionaryWords} dateCounts={dateCounts} selectedDate={selectedDate} onSelectDate={(date) => { setSelectedDate(date); setScope("all"); setSearch(""); setView("library"); }} />}
          {isTraining && <TrainingHeader view={view as "cards" | "match" | "type"} count={practiceWords.length} selectedDate={selectedDate} sourceLang={currentDictionary.sourceLang} targetLang={currentDictionary.targetLang} promptMode={practicePromptMode} onPromptModeChange={changePracticePromptMode} onChange={openTraining} />}
          {view === "cards" && (current && currentSides ? <div className="practice-body"><div className="session-line"><span>{cardIndex % practiceWords.length + 1} из {practiceWords.length}</span><i><b style={{ width: `${((cardIndex % practiceWords.length + 1) / practiceWords.length) * 100}%` }} /></i></div><div className="flashcard-wrap"><div className={`flashcard ${revealed ? "is-revealed" : ""} ${cardFlash === "success" ? "flash-ok" : cardFlash === "error" ? "flash-bad" : ""}`}><div className="flashcard-face" key={`${current.id}-${revealed ? "back" : "front"}`}><small>{revealed ? currentSides.answerLang : currentSides.promptLang}</small><div className="flashcard-word"><strong>{revealed ? currentSides.answer : currentSides.prompt}</strong><button type="button" className="play-word" onClick={() => speakVisible(current, revealed)} aria-label={`Прослушать слово «${revealed ? currentSides.answer : currentSides.prompt}»`}><span className="material-symbols-outlined" aria-hidden="true">brand_awareness</span></button></div></div><button type="button" className="flashcard-reveal" disabled={Boolean(cardFlash)} onClick={() => setRevealed(!revealed)}>{revealed ? "Скрыть перевод" : "Показать перевод"}</button></div></div><div className="card-actions"><div className="card-actions-main"><button type="button" className="danger" disabled={Boolean(cardFlash)} onClick={() => markCurrent("error")}>Повторять</button><button type="button" className="success" disabled={Boolean(cardFlash)} onClick={() => markCurrent("known")}>Знаю</button></div><button type="button" className="card-actions-skip" disabled={Boolean(cardFlash)} onClick={() => markCurrent("learning")}>Следующее слово</button></div></div> : <EmptyPractice onAdd={() => openAdd()} />)}
          {view === "match" && (matchWords.length ? <div className="practice-body match-practice"><div className="pairs"><div>{matchPairs.map(({ word, left }) => {
            const active = matchLeft === word.id;
            const done = matched.includes(word.id);
            const flash = active && matchFlash ? (matchFlash === "success" ? "flash-ok" : "flash-bad") : "";
            return <button disabled={done || Boolean(matchFlash)} className={[active ? "selected" : "", done ? "done" : "", flash].filter(Boolean).join(" ")} onClick={() => chooseMatch("left", word.id)} key={word.id}>{left}</button>;
          })}</div><div>{matchTranslations.map(({ word, right }) => {
            const active = matchRight === right;
            const done = matched.includes(word.id);
            const flash = active && matchFlash ? (matchFlash === "success" ? "flash-ok" : "flash-bad") : "";
            return <button disabled={done || Boolean(matchFlash)} className={[active ? "selected" : "", done ? "done" : "", flash].filter(Boolean).join(" ")} onClick={() => chooseMatch("right", right)} key={`${word.id}-right`}>{right}</button>;
          })}</div></div></div> : <EmptyPractice onAdd={() => openAdd()} />)}
          {view === "type" && (current && currentSides ? <div className="practice-body"><div className="session-line"><span>{cardIndex % practiceWords.length + 1} из {practiceWords.length}</span><i><b style={{ width: `${((cardIndex % practiceWords.length + 1) / practiceWords.length) * 100}%` }} /></i></div><div className="type-practice"><div className="type-card"><small>{currentSides.promptLang}</small><div className="type-word"><strong>{currentSides.prompt}</strong><button type="button" className="play-word" onClick={() => speakVisible(current)} aria-label={`Прослушать слово «${currentSides.prompt}»`}><span className="material-symbols-outlined" aria-hidden="true">brand_awareness</span></button></div><div className="type-card-spacer" aria-hidden="true"></div></div><div className="type-answer"><label htmlFor="answer">Перевод</label><div className={`answer ${feedback}`}><input id="answer" value={answer} onChange={event => { setAnswer(event.target.value); setFeedback("idle"); setSpeechMessage(""); setStatusOffer(null); }} onKeyDown={event => event.key === "Enter" && checkAnswer()} placeholder="Введите ответ" aria-label="Перевод" /><button type="button" className={`voice-input ${listening ? "listening" : ""}`} onClick={startVoiceInput} aria-label={listening ? "Остановить запись" : "Голосовой ввод"}><span className="material-symbols-outlined" aria-hidden="true">mic</span>{listening ? "Остановить запись" : "Голосовой ввод"}</button><button type="button" className="check-answer" onClick={checkAnswer}>Проверить</button></div>{speechMessage && <p className="speech-message" role="status">{speechMessage}</p>}{feedback === "success" && <p className="feedback success-text">{(current.correctStreak ?? 0) >= STATUS_THRESHOLD ? "Верно! Слово добавлено в раздел «Без ошибок»." : `Верно! До добавления в раздел «Без ошибок» осталось ${STATUS_THRESHOLD - (current.correctStreak ?? 0)} верных подряд.`}{current.status !== "error" && <> <span className="feedback-sep" aria-hidden="true">·</span> <FeedbackMoveLink status="error" onMove={(status) => applyStatusMove(current.id, status)} /></>}</p>}{feedback === "error" && <p className="feedback error-text">{current.errorCount >= STATUS_THRESHOLD ? <>Правильный ответ: <b>{currentSides.answer}</b>. Слово добавлено в раздел «С ошибками».</> : <>Правильный ответ: <b>{currentSides.answer}</b>. До добавления в раздел «С ошибками» осталось {STATUS_THRESHOLD - current.errorCount} ошибок подряд.</>}{current.status !== "known" && <> <span className="feedback-sep" aria-hidden="true">·</span> <FeedbackMoveLink status="known" onMove={(status) => applyStatusMove(current.id, status)} /></>}</p>}<button type="button" className="card-actions-skip type-next" onClick={() => { setCardIndex(i => i + 1); setAnswer(""); setFeedback("idle"); setSpeechMessage(""); setStatusOffer(null); }}>Следующее слово</button></div></div></div> : <EmptyPractice onAdd={() => openAdd()} />)}
        </div>
      </section>

      {view === "calendar" && <aside className="context-pane">
        <div className={`period-picker ${calendarOpen ? "open" : ""}`}>
          <label className="period-label" htmlFor="dictionary-period">Период</label>
          <button id="dictionary-period" className="period-control" type="button" aria-label={`${calendarOpen ? "Закрыть" : "Открыть"} календарь. Выбранный период: ${inputPeriodLabel}`} aria-haspopup="dialog" aria-expanded={calendarOpen} aria-controls="calendar-panel" onClick={() => setCalendarOpen((open) => !open)}>
            <span>{inputPeriodLabel}</span>
            <i className="material-symbols-outlined calendar-glyph" aria-hidden="true">calendar_month</i>
          </button>
          {calendarOpen && <MonthCalendar
            id="calendar-panel"
            label="Выбор периода"
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            cells={calendarCells}
            mode="period"
            selectedDates={selectedDates}
            onToggleDate={toggleSelectedDate}
            footer={<div className={`calendar-period-summary ${selectedDates.length ? "" : "is-all"}`}>
              <span>{selectedDates.length ? `${formatDayCount(selectedDates.length)} · ${formatWordCount(trainingPeriodWords.length)}` : `За все дни · ${formatWordCount(dictionaryWords.length)}`}</span>
              {!!selectedDates.length && <button type="button" onClick={clearSelectedDates}>Сбросить</button>}
            </div>}
          />}
        </div>

        <section className="context-words-card">
          <div className="context-word-chips" role="group" aria-label="Показать слова"><button className={contextWordFilter === "day" ? "active" : ""} aria-pressed={contextWordFilter === "day"} onClick={() => setContextWordFilter("day")}>{selectedDates.length === 0 ? "Все дни" : selectedDates.length > 1 ? "За дни" : "За день"} <b>{sidebarWords.length}</b></button><button className={contextWordFilter === "known" ? "active" : ""} aria-pressed={contextWordFilter === "known"} onClick={() => setContextWordFilter("known")}>Без ошибок <b>{knownWords.length}</b></button><button className={contextWordFilter === "errors" ? "active error" : ""} aria-pressed={contextWordFilter === "errors"} onClick={() => setContextWordFilter("errors")}>С ошибками <b>{errors.length}</b></button></div>
          {contextWordFilter === "errors" && <button className="context-repeat-errors" disabled={!errors.length} onClick={() => startPractice("errors", null)}>Повторить ошибки</button>}
          <div className="context-word-list">{contextWords.map(word => <button key={word.id} onClick={() => { setView("library"); setScope(contextWordFilter === "known" ? "known" : contextWordFilter === "errors" ? "errors" : "all"); if (contextWordFilter !== "day") setSelectedDates([]); setSearch(word.source); }}><span><b>{word.source}</b><small>{word.target}</small></span><em>{contextWordFilter === "day" ? word.status === "error" ? "С ошибкой" : word.status === "known" ? "Без ошибок" : "Не изучены" : contextWordFilter === "errors" ? "С ошибками" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${word.addedAt}T12:00:00`))}</em></button>)}</div>
          {!contextWords.length && <p className="no-context-words">{contextWordFilter === "day" ? selectedDates.length ? "В выбранные дни слова не добавлялись." : "В словаре пока нет слов." : contextWordFilter === "known" ? "Здесь появятся выученные слова." : "Ошибок пока нет. Так держать."}</p>}
        </section>
      </aside>}
    </section>

    {addOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdd(); }}>
      <section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <header>
          <div>
            <p>{isCreatingDictionary ? "НОВЫЙ СЛОВАРЬ" : "ЛИЧНЫЙ СЛОВАРЬ"}</p>
            <h2 id="add-title">{isCreatingDictionary ? "Создать словарь и добавить слова" : "Добавить слова"}</h2>
          </div>
          <button className="close" onClick={closeAdd} aria-label="Закрыть"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </header>

        <div className="import-dictionary">
          <div className="import-dictionary-row">
            <div className="import-field">
              <span className="period-label" id="add-dictionary-label">Словарь</span>
              <MenuSelect
                className="import-menu"
                ariaLabel="Словарь"
                labelId="add-dictionary-label"
                value={addTargetId}
                options={[
                  ...dictionaries.map((dictionary) => ({ value: dictionary.id, label: `${dictionary.sourceLang} — ${dictionary.targetLang}` })),
                  { value: "new", label: "Новый словарь" },
                ]}
                onChange={(value) => {
                  setAddTargetId(value === "new" ? "new" : value);
                  setAddDateOpen(false);
                  if (value === "new") {
                    setNewSourceLang("English");
                    setNewTargetLang("Русский");
                  }
                }}
                onOpen={() => setAddDateOpen(false)}
              />
            </div>
            <div className={`period-picker add-date-picker ${addDateOpen ? "open" : ""}`}>
              <label className="period-label" htmlFor="add-date">Дата добавления</label>
              <button
                id="add-date"
                className="period-control"
                type="button"
                aria-label={`${addDateOpen ? "Закрыть" : "Открыть"} календарь. Дата добавления: ${formatInputDate(addDate)}`}
                aria-haspopup="dialog"
                aria-expanded={addDateOpen}
                aria-controls="add-date-calendar"
                onClick={() => {
                  setAddCalendarMonth(new Date(`${addDate}T12:00:00`));
                  setAddDateOpen((open) => !open);
                }}
              >
                <span>{formatInputDate(addDate)}</span>
                <i className="material-symbols-outlined calendar-glyph" aria-hidden="true">calendar_month</i>
              </button>
              {addDateOpen && <MonthCalendar
                id="add-date-calendar"
                label="Выбор даты добавления"
                month={addCalendarMonth}
                onMonthChange={setAddCalendarMonth}
                cells={addCalendarCells}
                mode="pick"
                selectedDate={addDate}
                onPickDate={(iso) => { setAddDate(iso); setAddDateOpen(false); }}
              />}
            </div>
          </div>
          {isCreatingDictionary && (
            <div className="dictionary-language-fields">
              <div className="dictionary-language-field"><span id="new-source-lang-label">Язык слов</span>
                <MenuSelect className="import-menu" labelId="new-source-lang-label" ariaLabel="Язык словаря" value={newSourceLang} options={DICTIONARY_LANGUAGES.map((language) => ({ value: language, label: language }))} onChange={(value) => { setNewSourceLang(value); setAddDateOpen(false); }} onOpen={() => setAddDateOpen(false)} />
              </div>
              <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              <div className="dictionary-language-field"><span id="new-target-lang-label">Язык перевода</span>
                <MenuSelect className="import-menu" labelId="new-target-lang-label" ariaLabel="Язык перевода словаря" value={newTargetLang} options={DICTIONARY_LANGUAGES.map((language) => ({ value: language, label: language }))} onChange={(value) => { setNewTargetLang(value); setAddDateOpen(false); }} onOpen={() => setAddDateOpen(false)} />
              </div>
            </div>
          )}
          {newDictionaryLanguagesInvalid && <p className="dictionary-language-error" role="alert">Выберите два разных языка.</p>}
        </div>

        <nav>{(["paste", "file", "single"] as AddMode[]).map((item) => <button key={item} className={addMode === item ? "active" : ""} onClick={() => setAddMode(item)}>{{ paste: "Вставить список", file: "Загрузить файл", single: "Одно слово" }[item]}</button>)}</nav>

        {addMode === "paste" && <div className="paste-pane">
          <label>Вставьте скопированный текст
            <textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder="circumstances — обстоятельства"
            />
          </label>
          <p className="paste-help">Вставьте слова или пары «слово — перевод», каждую с новой строки. Если перевода нет, мы определим его автоматически. Перед добавлением всё можно проверить и исправить.</p>
          {previewWords.length > 0 && <section className="import-preview" aria-label="Предпросмотр слов">
            <header>
              <div><b>Предпросмотр</b><span>{formatWordCount(importablePreviewWords.length)} для добавления</span></div>
              {isTranslatingPreview && <em>Определяем переводы…</em>}
            </header>
            <div className="import-preview-list">
              {previewWords.map((word) => {
                const duplicate = existingPreviewSources.has(normalizeForMatch(word.source));
                return <div className={`import-preview-row ${duplicate ? "duplicate" : ""}`} key={word.id}>
                  <input aria-label="Слово" value={word.source} onChange={(event) => updatePreviewWord(word.id, { source: event.target.value })} />
                  <i aria-hidden="true">→</i>
                  <input aria-label={`Перевод слова ${word.source}`} value={word.target} onChange={(event) => updatePreviewWord(word.id, { target: event.target.value })} placeholder={isTranslatingPreview ? "Определяем перевод…" : "Введите перевод"} />
                  <small>{duplicate ? "Уже в словаре" : formatInputDate(word.addedAt)}</small>
                </div>;
              })}
            </div>
          </section>}
          <button className="primary full" onClick={() => addParsed(previewWords)} disabled={!importablePreviewWords.length || isTranslatingPreview || newDictionaryLanguagesInvalid}>
            {importablePreviewWords.length
              ? isCreatingDictionary
                ? `Создать словарь и добавить ${formatWordCount(importablePreviewWords.length)}`
                : `Добавить ${formatWordCount(importablePreviewWords.length)}`
              : "Добавить слова"}
          </button>
        </div>}

        {addMode === "file" && <div className="file-pane">
          <input ref={fileRef} type="file" hidden accept=".txt,.csv,.tsv,.docx,.pdf,image/png,image/jpeg,image/webp,image/heic" onChange={(event) => event.target.files?.[0] && extractFile(event.target.files[0])} />
          <button className="drop-zone" onClick={() => fileRef.current?.click()} disabled={newDictionaryLanguagesInvalid}>
            <b>{fileName || "Выберите файл"}</b>
            <span>TXT, CSV, DOCX, PDF, PNG, JPG, WEBP</span>
            <small>Текст распознаётся автоматически. Перед добавлением вы сможете проверить пары.</small>
          </button>
          <button type="button" className="primary full" disabled>Добавить слова из файла</button>
        </div>}

        {addMode === "single" && <div className="single-pane">
          <label>Слово или выражение<input value={singleSource} onChange={(event) => setSingleSource(event.target.value)} placeholder="circumstances" /></label>
          <label>Перевод<input value={singleTarget} onChange={(event) => setSingleTarget(event.target.value)} placeholder="обстоятельства" /></label>
          <button className="primary full" onClick={addSingle} disabled={newDictionaryLanguagesInvalid}>
            {isCreatingDictionary ? "Создать словарь и добавить слово" : "Добавить слово"}
          </button>
        </div>}

        {importStatus && <div className="import-status" role="status">{importStatus}</div>}
      </section>
    </div>}
  </main>;
}

function buildMonthCells(month: Date, dateCounts?: Record<string, number>) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekDay = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekDay + 1;
    if (day < 1 || day > days) return null;
    const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { day, iso, count: dateCounts?.[iso] ?? 0 };
  });
}

function MonthCalendar({
  id,
  label,
  month,
  onMonthChange,
  cells,
  mode,
  selectedDates = [],
  selectedDate = null,
  onToggleDate,
  onPickDate,
  footer,
}: {
  id?: string;
  label: string;
  month: Date;
  onMonthChange: (month: Date) => void;
  cells: Array<{ day: number; iso: string; count?: number } | null>;
  mode: "period" | "pick";
  selectedDates?: string[];
  selectedDate?: string | null;
  onToggleDate?: (iso: string) => void;
  onPickDate?: (iso: string) => void;
  footer?: ReactNode;
}) {
  return <section className={`calendar-card ${mode === "pick" ? "calendar-card-pick" : ""}`} id={id} aria-label={label}>
    <div className="calendar-head">
      <b>{monthNames[month.getMonth()]} {month.getFullYear()}</b>
      <div>
        <button type="button" aria-label="Предыдущий месяц" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <button type="button" aria-label="Следующий месяц" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
      </div>
    </div>
    <div className="weekdays">{["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className={`calendar-grid ${mode === "pick" ? "pick-any" : ""}`}>
      {cells.map((cell, index) => {
        if (!cell) return <span key={index} />;
        if (mode === "pick") {
          const selected = selectedDate === cell.iso;
          return <button key={cell.iso} type="button" className={selected ? "selected" : ""} aria-pressed={selected} aria-label={formatDate(cell.iso)} onClick={() => onPickDate?.(cell.iso)}>{cell.day}</button>;
        }
        const count = cell.count ?? 0;
        const selected = selectedDates.includes(cell.iso);
        return <button
          key={cell.iso}
          type="button"
          className={`${count ? "has" : ""} ${selected ? "selected" : ""}`}
          onClick={() => { if (count) onToggleDate?.(cell.iso); }}
          aria-pressed={selected}
          title={count ? formatWordCount(count) : undefined}
          aria-label={count ? `${cell.day}, добавлено слов: ${count}. ${selected ? "Убрать из выбранных" : "Добавить к выбранным"}` : `${cell.day}, нет слов`}
        >{cell.day}</button>;
      })}
    </div>
    {footer}
  </section>;
}

function MenuSelect({ ariaLabel, value, options, onChange, className = "", icon, onOpen, labelId }: { ariaLabel: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; className?: string; icon?: string; onOpen?: () => void; labelId?: string }) {
  const selected = options.find((option) => option.value === value)?.label ?? value;
  const valueId = labelId ? `${labelId}-value` : undefined;
  return <details className={`menu-select ${className}`.trim()} onToggle={(event) => { if (event.currentTarget.open) onOpen?.(); }}>
    <summary {...(labelId ? { "aria-labelledby": `${labelId} ${valueId}` } : { "aria-label": `${ariaLabel}: ${selected}` })}>{icon && <span className="material-symbols-outlined menu-select-icon" aria-hidden="true">{icon}</span>}<span className="menu-select-value" id={valueId}>{selected}</span><span className="material-symbols-outlined menu-select-arrow" aria-hidden="true">keyboard_arrow_down</span></summary>
    <div role="listbox" {...(labelId ? { "aria-labelledby": labelId } : { "aria-label": ariaLabel })}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "active" : ""} key={option.value} onClick={(event) => { onChange(option.value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}</div>
  </details>;
}

function TrainingFilters({ scope, total, clean, errors, unlearned, onChange }: { scope: Scope; total: number; clean: number; errors: number; unlearned: number; onChange: (scope: "all" | "clean" | "errors" | "unlearned") => void }) {
  const options = [
    { id: "all", label: "Все слова", count: total },
    { id: "unlearned", label: "Не изучены", count: unlearned },
    { id: "clean", label: "Без ошибок", count: clean },
    { id: "errors", label: "С ошибками", count: errors },
  ] as const;

  return <section className="training-filters" aria-label="Фильтр тренировки">
    <header><div><p>ПОДБОРКА</p><h2>Какие слова?</h2></div><span>Можно изменить в любой момент</span></header>
    <div className="training-filter-options">{options.map(option => <button key={option.id} className={scope === option.id ? "active" : ""} aria-pressed={scope === option.id} onClick={() => onChange(option.id)}><span>{option.label}</span><b>{option.count}</b></button>)}</div>
  </section>;
}

function TrainingHeader({ view, count, selectedDate, sourceLang, targetLang, promptMode, onPromptModeChange, onChange }: { view: "cards" | "match" | "type"; count: number; selectedDate: string | null; sourceLang: string; targetLang: string; promptMode: PracticePromptMode; onPromptModeChange: (mode: PracticePromptMode) => void; onChange: (view: "cards" | "match" | "type") => void }) {
  const formats = [
    { id: "cards", label: "Карточки" },
    { id: "match", label: "Пары" },
    { id: "type", label: "Вписать" },
  ] as const;
  return <section className="training-heading">
    <header className="content-head practice-heading"><div><p>Тренировка</p><h2>{sourceLang} — {targetLang}</h2></div><span>{selectedDate ? formatDate(selectedDate) : formatWordCount(count)}</span></header>
    <div className="practice-format-row">
      <nav className="practice-format-chips" aria-label="Формат тренировки">{formats.map(format => <button key={format.id} className={view === format.id ? "active" : ""} aria-pressed={view === format.id} onClick={() => onChange(format.id)}>{format.label}</button>)}</nav>
      <div className="practice-lang">
        <span className="practice-lang-label" id="practice-lang-label">Слова</span>
        <MenuSelect
          className="practice-lang-menu"
          ariaLabel="Язык показа"
          labelId="practice-lang-label"
          value={promptMode}
          options={[
            { value: "source", label: `на ${sourceLang}` },
            { value: "target", label: `на ${targetLang}` },
            { value: "mixed", label: "вперемешку" },
          ]}
          onChange={(value) => onPromptModeChange(value as PracticePromptMode)}
        />
      </div>
    </div>
  </section>;
}

function EmptyPractice({ onAdd }: { onAdd: () => void }) { return <div className="empty-state"><h3>В этой подборке пока нет слов</h3><p>Измените фильтр или добавьте новую группу слов.</p><button className="primary" onClick={onAdd}>Добавить слова</button></div>; }

function CalendarView({ cells, words, dateCounts, selectedDate, onSelectDate }: { cells: Array<{ day: number; iso: string; count: number } | null>; words: Word[]; dateCounts: Record<string, number>; selectedDate: string | null; onSelectDate: (date: string) => void }) {
  const dates = Object.keys(dateCounts).sort((a, b) => b.localeCompare(a));
  return <div className="calendar-page">
    <section className="large-calendar" aria-label="Даты добавления слов">
      <div className="large-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="large-calendar-grid">{cells.map((cell, index) => cell ? <button key={cell.iso} disabled={!cell.count} className={`${cell.count ? "has" : ""} ${selectedDate === cell.iso ? "selected" : ""}`} onClick={() => onSelectDate(cell.iso)}><span>{cell.day}</span>{cell.count > 0 && <b>{cell.count} слов</b>}</button> : <span key={index} />)}</div>
    </section>
    <section className="date-history"><header><div><p>ГРУППЫ СЛОВ</p><h2>Добавлено по датам</h2></div><span>{dates.length} дат</span></header><div>{dates.map(date => {
      const dateWords = words.filter(word => word.addedAt === date);
      return <button key={date} onClick={() => onSelectDate(date)}><span><b>{formatDate(date)}</b><small>{dateWords.slice(0, 3).map(word => word.source).join(", ")}{dateWords.length > 3 ? "…" : ""}</small></span><strong>{dateWords.length} слов</strong></button>;
    })}</div></section>
  </div>;
}

function WordStatusMenu({ word, onChange }: { word: Word; onChange: (status: WordStatus) => void }) {
  return <MenuSelect
    className={`status-menu ${word.status}`}
    ariaLabel={`Статус ${word.source}`}
    value={word.status}
    options={[
      { value: "learning", label: "Не изучены" },
      { value: "known", label: "Без ошибок" },
      { value: "error", label: "С ошибками" },
    ]}
    onChange={(value) => onChange(value as WordStatus)}
  />;
}

function FeedbackMoveLink({ status, onMove }: { status: WordStatus; onMove: (status: WordStatus) => void }) {
  return (
    <button type="button" className="feedback-move" onClick={() => onMove(status)}>
      Перенести в «{STATUS_LABEL[status]}»
    </button>
  );
}

function LibraryView({ words, editId, setEditId, updateWord, setWords, speak, onStartTraining }: { words: Word[]; editId: string | null; setEditId: (id: string | null) => void; updateWord: (id: string, patch: Partial<Word>) => void; setWords: React.Dispatch<React.SetStateAction<Word[]>>; speak: (word: Word) => void; onStartTraining: (date: string) => void }) {
  const groups = words.reduce<Record<string, Word[]>>((result, word) => {
    result[word.addedAt] = [...(result[word.addedAt] ?? []), word];
    return result;
  }, {});
  return <div className="word-groups">{Object.entries(groups).map(([date, items]) => <section className="word-group" key={date}>
    <header><h2>{formatDate(date)}</h2><div className="word-group-header-actions"><span>{formatWordCount(items.length)}</span><button className="word-group-train" onClick={() => onStartTraining(date)}>Учить слова</button></div></header>
    <div className="word-table">{items.map(word => editId === word.id ? <div className="word-row editing" key={word.id}><input aria-label="Редактировать слово" value={word.source} onChange={event => updateWord(word.id, { source: event.target.value })}/><input aria-label="Редактировать перевод" value={word.target} onChange={event => updateWord(word.id, { target: event.target.value })}/><input aria-label="Дата добавления" type="date" value={word.addedAt} onChange={event => updateWord(word.id, { addedAt: event.target.value })}/><button className="edit-done" onClick={() => setEditId(null)}>Готово</button></div> : <div className="word-row" key={word.id}>
      <div className="word-copy"><span className="source-cell"><b>{word.source}</b><button className="play-word" onClick={() => speak(word)} aria-label={`Прослушать слово «${word.source}»`}><span className="material-symbols-outlined" aria-hidden="true">brand_awareness</span></button></span><strong>{word.target}</strong></div>
      <div className="row-controls">
        <WordStatusMenu word={word} onChange={status => updateWord(word.id, { status, errorCount: status === "error" ? Math.max(1, word.errorCount) : status === "known" ? 0 : word.errorCount, correctStreak: status === "known" ? STATUS_THRESHOLD : status === "error" ? 0 : word.correctStreak ?? 0 })} />
        <div className="row-actions"><button aria-label={`Изменить слово «${word.source}»`} title="Изменить" onClick={() => setEditId(word.id)}><span className="material-symbols-outlined action-icon edit-icon" aria-hidden="true">edit</span></button><button className="delete" aria-label={`Удалить слово «${word.source}»`} title="Удалить" onClick={() => window.confirm(`Удалить «${word.source}» из словаря?`) && setWords(currentWords => currentWords.filter(item => item.id !== word.id))}><span className="material-symbols-outlined action-icon delete-icon" aria-hidden="true">delete</span></button></div>
      </div>
    </div>)}</div>
  </section>)}</div>;
}

function LibraryEmptyState({ query, hasDictionaryMatch, similarWords, onSelectSuggestion, onAddSingle, onUpload, onReset }: { query: string; hasDictionaryMatch: boolean; similarWords: Word[]; onSelectSuggestion: (word: Word) => void; onAddSingle: () => void; onUpload: () => void; onReset: () => void }) {
  if (query && !hasDictionaryMatch) return <div className="empty-inline search-empty">
    <p className="empty-kicker">НЕТ В СЛОВАРЕ</p>
    <h2>«{query}» пока нет в словаре</h2>
    <p>Добавьте одно слово вручную или загрузите список из файла.</p>
    {similarWords.length > 0 && <section className="similar-words" aria-labelledby="similar-words-title">
      <p id="similar-words-title">Возможно, вы искали:</p>
      <div>{similarWords.map((word) => <button key={word.id} onClick={() => onSelectSuggestion(word)}><b>{word.source}</b><span>{word.target}</span></button>)}</div>
    </section>}
    <div className="empty-actions"><button className="empty-add-action" onClick={onAddSingle}>Добавить это слово</button><button className="empty-file-action" onClick={onUpload}>Загрузить файл</button></div>
  </div>;
  if (query && hasDictionaryMatch) return <div className="empty-inline search-empty">
    <p className="empty-kicker">СКРЫТО ФИЛЬТРАМИ</p>
    <h2>Слово есть в словаре</h2>
    <p>Оно не входит в выбранный период или тип слов.</p>
    <div className="empty-actions"><button className="empty-reset-action" onClick={onReset}>Показать во всём словаре</button></div>
  </div>;
  return <div className="empty-inline">
    <h2>В этой подборке нет слов</h2>
    <p>Измените период или тип слов.</p>
    <div className="empty-actions"><button className="empty-reset-action" onClick={onReset}>Сбросить фильтры</button></div>
  </div>;
}
