"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
};
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
].map(([source, target, addedAt], index) => ({ id: `starter-${index}`, source, target, addedAt, sourceLang: "English", targetLang: "Русский", status: index === 3 ? "error" : index === 6 ? "known" : "learning", errorCount: index === 3 ? 2 : 0 } as Word));

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
    if (parts.length < 2) continue;
    let rowDate = currentDate;
    if (/^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})$/.test(parts[0])) rowDate = normalizeDate(parts.shift()!, currentDate);
    const source = parts.shift()!;
    const target = parts.join("; ");
    if (/^(word|слово|english)$/i.test(source) && /^(translation|перевод|russian)$/i.test(target)) continue;
    result.push({ id: uid(), source, target, addedAt: rowDate, sourceLang: sourceLanguage === LANGUAGES[0] ? detectLanguage(source) : sourceLanguage, targetLang: targetLanguage === LANGUAGES[0] ? detectLanguage(target) : targetLanguage, status: "learning", errorCount: 0 });
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

function downloadDictionary(words: Word[], format: ExportFormat) {
  const sortedWords = [...words].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.source.localeCompare(b.source));
  const statusLabel: Record<WordStatus, string> = { learning: "Не изучены", known: "Знаю", error: "С ошибками" };
  let content = "";
  let mimeType = "text/plain;charset=utf-8";

  if (format === "csv") {
    const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = sortedWords.map(word => [word.addedAt, word.source, word.target, word.sourceLang, word.targetLang, statusLabel[word.status], word.errorCount].map(escapeCell).join(";"));
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
    content = Object.entries(groups).map(([date, items]) => `Дата: ${date}\n${items.map(word => `${word.source} — ${word.target}\n#META ${word.sourceLang}|${word.targetLang}|${statusLabel[word.status]}|${word.errorCount}`).join("\n")}`).join("\n\n");
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
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [dictionarySourceLang, setDictionarySourceLang] = useState("English");
  const [dictionaryTargetLang, setDictionaryTargetLang] = useState("Русский");
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
  const [bulkText, setBulkText] = useState("");
  const [addDate, setAddDate] = useState(TODAY);
  const [sourceLang, setSourceLang] = useState("Автоопределение");
  const [targetLang, setTargetLang] = useState("Автоопределение");
  const [singleSource, setSingleSource] = useState("");
  const [singleTarget, setSingleTarget] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [fileName, setFileName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "alpha">("newest");
  const [cardIndex, setCardIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [listening, setListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
  const [matchLeft, setMatchLeft] = useState<string | null>(null);
  const [matchRight, setMatchRight] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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
    if (saved) try { setWords(JSON.parse(saved)); } catch { /* keep starter data */ }
    if (savedDictionaries) try { setDictionaries(JSON.parse(savedDictionaries)); } catch { /* keep starter dictionary */ }
    if (savedSelectedDictionary) setSelectedDictionaryId(savedSelectedDictionary);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-words-v2", JSON.stringify(words)); } catch { /* storage unavailable */ } }, [words, hydrated]);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-dictionaries-v1", JSON.stringify(dictionaries)); } catch { /* storage unavailable */ } }, [dictionaries, hydrated]);
  useEffect(() => { if (hydrated) try { localStorage.setItem("lingua-selected-dictionary-v1", selectedDictionaryId); } catch { /* storage unavailable */ } }, [selectedDictionaryId, hydrated]);

  const currentDictionary = dictionaries.find((dictionary) => dictionary.id === selectedDictionaryId) ?? dictionaries[0] ?? starterDictionaries[0];
  const dictionaryWords = words.filter((word) => (word.dictionaryId ?? DEFAULT_DICTIONARY_ID) === currentDictionary.id);
  const errors = dictionaryWords.filter((word) => word.status === "error" || word.errorCount > 0);
  const cleanWords = dictionaryWords.filter((word) => matchesScope(word, "clean"));
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
  const previewWords = useMemo(() => parsePairs(bulkText, addDate, sourceLang, targetLang), [bulkText, addDate, sourceLang, targetLang]);
  const matchWords = practiceWords.slice(0, 6);
  const matchTranslations = useMemo(() => [...matchWords].sort((a, b) => a.target.localeCompare(b.target)), [matchWords]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth();
    const firstWeekDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstWeekDay + 1;
      if (day < 1 || day > days) return null;
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { day, iso, count: dateCounts[iso] ?? 0 };
    });
  }, [calendarMonth, dateCounts]);

  function updateWord(id: string, patch: Partial<Word>) { setWords((items) => items.map((word) => word.id === id ? { ...word, ...patch } : word)); }
  function selectDictionary(dictionary: Dictionary) {
    setSelectedDictionaryId(dictionary.id);
    setSourceLang(dictionary.sourceLang);
    setTargetLang(dictionary.targetLang);
    setSelectedDates([]);
    setSearch("");
    setScope("all");
    resetPracticeState();
    setView("library");
  }
  function createDictionary() {
    if (dictionarySourceLang === dictionaryTargetLang) return;
    const existing = dictionaries.find((dictionary) => dictionary.sourceLang === dictionarySourceLang && dictionary.targetLang === dictionaryTargetLang);
    if (existing) { selectDictionary(existing); setDictionaryOpen(false); return; }
    const dictionary = { id: uid(), sourceLang: dictionarySourceLang, targetLang: dictionaryTargetLang };
    setDictionaries((items) => [...items, dictionary]);
    selectDictionary(dictionary);
    setDictionaryOpen(false);
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
  function resetPracticeState() { setCardIndex(0); setRevealed(false); setFeedback("idle"); setAnswer(""); setSpeechMessage(""); setMatched([]); }
  function startPractice(nextScope: Scope, nextDate: string | null = selectedDate) { setScope(nextScope); setSelectedDate(nextDate); setSearch(""); resetPracticeState(); setView("cards"); }
  function openTraining(nextView: "cards" | "match" | "type") {
    if (!isTraining) setScope("all");
    setSearch(""); resetPracticeState(); setView(nextView);
  }
  function selectPracticeScope(nextScope: "all" | "clean" | "errors" | "unlearned") { setScope(nextScope); setSearch(""); resetPracticeState(); }
  function markCurrent(status: WordStatus) {
    if (!current) return;
    updateWord(current.id, { status, errorCount: status === "error" ? current.errorCount + 1 : status === "known" ? 0 : current.errorCount });
    setCardIndex((index) => index + 1); setRevealed(false); setFeedback("idle"); setAnswer("");
  }
  function addParsed(items: Word[]) {
    if (!items.length) { setImportStatus("Не удалось найти пары. Используйте формат: word — перевод"); return; }
    setWords((currentWords) => [...items.map((word) => ({ ...word, dictionaryId: currentDictionary.id })), ...currentWords]);
    setImportStatus(`Добавлено слов: ${items.length}`); setBulkText(""); setFileName("");
    window.setTimeout(() => { setAddOpen(false); setImportStatus(""); }, 700);
  }
  function addSingle() {
    if (!singleSource.trim() || !singleTarget.trim()) { setImportStatus("Заполните слово и перевод"); return; }
    addParsed(parsePairs(`${singleSource.trim()} — ${singleTarget.trim()}`, addDate, sourceLang, targetLang));
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
      const count = parsePairs(text, addDate, sourceLang, targetLang).length;
      setImportStatus(count ? `Распознано пар: ${count}. Проверьте список перед добавлением.` : "Текст извлечён, но пары не найдены. Проверьте разделители.");
    } catch {
      setImportStatus("Не удалось прочитать файл. Проверьте формат и попробуйте ещё раз.");
    }
  }
  function checkAnswer() {
    if (!current) return;
    const ok = answer.trim().toLowerCase() === current.target.trim().toLowerCase();
    setFeedback(ok ? "success" : "error");
    if (!ok) updateWord(current.id, { status: "error", errorCount: current.errorCount + 1 });
  }
  function chooseMatch(side: "left" | "right", value: string) {
    const left = side === "left" ? value : matchLeft; const right = side === "right" ? value : matchRight;
    if (side === "left") setMatchLeft(value);
    else setMatchRight(value);
    if (left && right) {
      const word = matchWords.find((item) => item.id === left);
      if (word?.target === right) setMatched((items) => [...new Set([...items, word.id])]);
      else if (word) updateWord(word.id, { status: "error", errorCount: word.errorCount + 1 });
      window.setTimeout(() => { setMatchLeft(null); setMatchRight(null); }, 260);
    }
  }
  function speak(word: Word) {
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(word.source); utterance.lang = langCode[word.sourceLang] ?? "en-US"; speechSynthesis.speak(utterance);
  }
  function startVoiceInput() {
    if (!current) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setSpeechMessage("Голосовой ввод не поддерживается этим браузером."); return; }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = langCode[current.targetLang] ?? "ru-RU";
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
            <button type="button" className="dictionary-create" onClick={(event) => { setDictionarySourceLang("English"); setDictionaryTargetLang("Русский"); setDictionaryOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className="material-symbols-outlined" aria-hidden="true">add</span>Добавить словарь</button>
          </div>
        </details>

        <button className="rail-add" onClick={() => { setAddMode("paste"); setAddOpen(true); }}>Добавить слова</button>

        <div className="rail-section">
          <nav className="rail-nav quiet" aria-label="Обучение">
            <button className={`training-entry ${isTraining ? "active" : ""}`} onClick={() => openTraining("cards")}><b>Учить слова</b></button>
          </nav>
          <div className="rail-training-settings">
            <div className={`period-picker ${trainingCalendarOpen ? "open" : ""}`}>
              <label className="period-label" htmlFor="training-period">За какой период?</label>
              <button id="training-period" className="period-control" type="button" aria-label={`${trainingCalendarOpen ? "Закрыть" : "Открыть"} календарь. Выбранный период: ${inputPeriodLabel}`} aria-haspopup="dialog" aria-expanded={trainingCalendarOpen} aria-controls="training-calendar-panel" onClick={() => setTrainingCalendarOpen((open) => !open)}>
                <span>{inputPeriodLabel}</span>
                <i className="calendar-glyph" aria-hidden="true"><b /><b /></i>
              </button>
              {trainingCalendarOpen && <section className="calendar-card" id="training-calendar-panel" aria-label="Выбор периода">
                <div className="calendar-head"><b>{monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</b><div><button type="button" aria-label="Предыдущий месяц" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button><button type="button" aria-label="Следующий месяц" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button></div></div>
                <div className="weekdays">{["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map(day => <span key={day}>{day}</span>)}</div>
                <div className="calendar-grid">{calendarCells.map((cell, index) => cell ? <button key={cell.iso} className={`${cell.count ? "has" : ""} ${selectedDates.includes(cell.iso) ? "selected" : ""}`} onClick={() => { if (cell.count) toggleSelectedDate(cell.iso); }} aria-pressed={selectedDates.includes(cell.iso)} title={cell.count ? formatWordCount(cell.count) : undefined} aria-label={cell.count ? `${cell.day}, добавлено слов: ${cell.count}. ${selectedDates.includes(cell.iso) ? "Убрать из выбранных" : "Добавить к выбранным"}` : `${cell.day}, нет слов`}>{cell.day}</button> : <span key={index} />)}</div>
                <div className={`calendar-period-summary ${selectedDates.length ? "" : "is-all"}`}>
                  <span>{selectedDates.length ? `${formatDayCount(selectedDates.length)} · ${formatWordCount(trainingPeriodWords.length)}` : `За все дни · ${formatWordCount(dictionaryWords.length)}`}</span>
                  {!!selectedDates.length && <button type="button" onClick={clearSelectedDates}>Сбросить</button>}
                </div>
              </section>}
            </div>
            <TrainingFilters scope={scope} total={trainingPeriodWords.length} clean={trainingCleanWords.length} errors={trainingErrorWords.length} unlearned={trainingUnlearnedWords.length} onChange={selectPracticeScope} />
          </div>
        </div>

      </aside>

      <section className="main-pane">
        {view === "library" && <>
          <header className="main-toolbar">
            <div className="screen-title">
              <h1>Слова</h1>
              <div className="library-title-actions">
                <details className="export-menu">
                  <summary><span className="material-symbols-outlined export-icon" aria-hidden="true">download</span>Скачать словарь</summary>
                  <div role="menu" aria-label="Формат скачивания">
                    {([
                      ["csv", "CSV", "Таблица с датами и статусами"],
                      ["txt", "TXT", "Список по датам для повторного импорта"],
                      ["json", "JSON", "Полная резервная копия словаря"],
                    ] as const).map(([format, label, description]) => <button key={format} role="menuitem" onClick={event => { downloadDictionary(dictionaryWords, format); event.currentTarget.closest("details")?.removeAttribute("open"); }}><b>{label}</b><span>{description}</span></button>)}
                  </div>
                </details>
              </div>
            </div>
            <div className="search-row">
              <input className="search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по словарю" aria-label="Поиск по словарю" />
            </div>
            <nav className="quick-add-row" aria-label="Способы добавления слов">
              <MenuSelect className="sort-menu quick-sort-menu" ariaLabel="Сортировка" value={sortOrder} options={[{ value: "newest", label: "Сначала новые" }, { value: "oldest", label: "Сначала старые" }, { value: "alpha", label: "По алфавиту" }]} onChange={(value) => setSortOrder(value as "newest" | "oldest" | "alpha")} />
              <div className="quick-add-actions">
                <button type="button" onClick={() => { setAddMode("single"); setAddOpen(true); }}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Одно слово</button>
                <button type="button" onClick={() => { setAddMode("paste"); setAddOpen(true); }}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Группа слов</button>
                <button type="button" aria-label="Распознать слова с фото или файла: TXT, CSV, DOCX, PDF, PNG, JPG, WEBP" onClick={() => { setAddMode("file"); setAddOpen(true); }}><span className="material-symbols-outlined quick-add-icon" aria-hidden="true">add</span>Слова с фото или файла</button>
              </div>
            </nav>
          </header>
        </>}

        {view === "calendar" && <header className="main-toolbar calendar-toolbar"><div className="screen-title"><div><p>ИСТОРИЯ СЛОВ</p><h1>Календарь</h1></div></div><div className="calendar-toolbar-actions"><button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>Предыдущий месяц</button><b>{monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</b><button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>Следующий месяц</button></div></header>}

        <div className="content-scroll">
          {view === "library" && (filteredWords.length ? <LibraryView words={filteredWords} editId={editId} setEditId={setEditId} updateWord={updateWord} setWords={setWords} speak={speak} onStartTraining={(date) => startPractice("all", date)} /> : <LibraryEmptyState query={search.trim()} hasDictionaryMatch={hasDictionaryMatch} similarWords={similarWords} onSelectSuggestion={(word) => { setScope("all"); setSelectedDates([]); setSearch(word.source); }} onAddSingle={() => { setSingleSource(search.trim()); setSingleTarget(""); setAddMode("single"); setAddOpen(true); }} onUpload={() => { setAddMode("file"); setAddOpen(true); }} onReset={() => { setScope("all"); setSelectedDates([]); }} />)}
          {view === "calendar" && <CalendarView cells={calendarCells} words={dictionaryWords} dateCounts={dateCounts} selectedDate={selectedDate} onSelectDate={(date) => { setSelectedDate(date); setScope("all"); setSearch(""); setView("library"); }} />}
          {isTraining && <TrainingHeader view={view as "cards" | "match" | "type"} count={practiceWords.length} selectedDate={selectedDate} onChange={openTraining} />}
          {view === "cards" && (current ? <div className="practice-body"><div className="session-line"><span>{cardIndex % practiceWords.length + 1} из {practiceWords.length}</span><i><b style={{ width: `${((cardIndex % practiceWords.length + 1) / practiceWords.length) * 100}%` }} /></i></div><div className="flashcard-wrap"><button className={`flashcard ${revealed ? "revealed" : ""}`} onClick={() => setRevealed(!revealed)}><small>{revealed ? current.targetLang : current.sourceLang}</small><strong>{revealed ? current.target : current.source}</strong><span>{revealed ? "Нажмите, чтобы вернуть слово" : "Показать перевод"}</span></button><button className="listen-word" onClick={() => speak(current)}>Прослушать слово</button></div><div className="card-actions"><button className="danger" onClick={() => markCurrent("error")}>Ошибка, повторить</button><button onClick={() => markCurrent("learning")}>Пропустить</button><button className="success" onClick={() => markCurrent("known")}>Знаю</button></div></div> : <EmptyPractice onAdd={() => setAddOpen(true)} />)}
          {view === "match" && (matchWords.length ? <div className="pairs"><div>{matchWords.map(word => <button disabled={matched.includes(word.id)} className={matchLeft === word.id ? "selected" : matched.includes(word.id) ? "done" : ""} onClick={() => chooseMatch("left", word.id)} key={word.id}>{word.source}</button>)}</div><div>{matchTranslations.map(word => <button disabled={matched.includes(word.id)} className={matchRight === word.target ? "selected" : matched.includes(word.id) ? "done" : ""} onClick={() => chooseMatch("right", word.target)} key={word.id}>{word.target}</button>)}</div></div> : <EmptyPractice onAdd={() => setAddOpen(true)} />)}
          {view === "type" && (current ? <div className="type-practice"><span>{current.sourceLang}</span><h2>{current.source}</h2><button className="listen-word type-listen" onClick={() => speak(current)}>Прослушать слово</button><label htmlFor="answer">Перевод</label><div className={`answer ${feedback}`}><input id="answer" value={answer} onChange={event => { setAnswer(event.target.value); setFeedback("idle"); setSpeechMessage(""); }} onKeyDown={event => event.key === "Enter" && checkAnswer()} placeholder="Введите ответ"/><button className={`voice-input ${listening ? "listening" : ""}`} onClick={startVoiceInput}>{listening ? "Остановить запись" : "Голосовой ввод"}</button><button onClick={checkAnswer}>Проверить</button></div>{speechMessage && <p className="speech-message" role="status">{speechMessage}</p>}{feedback === "success" && <p className="feedback success-text">Верно. Слово перенесено в «Знаю».</p>}{feedback === "error" && <p className="feedback error-text">Правильный ответ: <b>{current.target}</b>. Слово добавлено в ошибки.</p>}<button className="next-button" onClick={() => { if (feedback === "success") markCurrent("known"); else { setCardIndex(i => i + 1); setAnswer(""); setFeedback("idle"); setSpeechMessage(""); } }}>Следующее слово</button></div> : <EmptyPractice onAdd={() => setAddOpen(true)} />)}
        </div>
      </section>

      {view === "calendar" && <aside className="context-pane">
        <div className={`period-picker ${calendarOpen ? "open" : ""}`}>
          <label className="period-label" htmlFor="dictionary-period">Период</label>
          <button id="dictionary-period" className="period-control" type="button" aria-label={`${calendarOpen ? "Закрыть" : "Открыть"} календарь. Выбранный период: ${inputPeriodLabel}`} aria-haspopup="dialog" aria-expanded={calendarOpen} aria-controls="calendar-panel" onClick={() => setCalendarOpen((open) => !open)}>
            <span>{inputPeriodLabel}</span>
            <i className="calendar-glyph" aria-hidden="true"><b /><b /></i>
          </button>
          {calendarOpen && <section className="calendar-card" id="calendar-panel" aria-label="Выбор периода">
            <div className="calendar-head"><b>{monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</b><div><button type="button" aria-label="Предыдущий месяц" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button><button type="button" aria-label="Следующий месяц" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button></div></div>
            <div className="weekdays">{["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map(day => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">{calendarCells.map((cell, index) => cell ? <button key={cell.iso} className={`${cell.count ? "has" : ""} ${selectedDates.includes(cell.iso) ? "selected" : ""}`} onClick={() => { if (cell.count) toggleSelectedDate(cell.iso); }} aria-pressed={selectedDates.includes(cell.iso)} title={cell.count ? formatWordCount(cell.count) : undefined} aria-label={cell.count ? `${cell.day}, добавлено слов: ${cell.count}. ${selectedDates.includes(cell.iso) ? "Убрать из выбранных" : "Добавить к выбранным"}` : `${cell.day}, нет слов`}>{cell.day}</button> : <span key={index} />)}</div>
            <div className={`calendar-period-summary ${selectedDates.length ? "" : "is-all"}`}>
              <span>{selectedDates.length ? `${formatDayCount(selectedDates.length)} · ${formatWordCount(trainingPeriodWords.length)}` : `За все дни · ${formatWordCount(dictionaryWords.length)}`}</span>
              {!!selectedDates.length && <button type="button" onClick={clearSelectedDates}>Сбросить</button>}
            </div>
          </section>}
        </div>

        <section className="context-words-card">
          <div className="context-word-chips" role="group" aria-label="Показать слова"><button className={contextWordFilter === "day" ? "active" : ""} aria-pressed={contextWordFilter === "day"} onClick={() => setContextWordFilter("day")}>{selectedDates.length === 0 ? "Все дни" : selectedDates.length > 1 ? "За дни" : "За день"} <b>{sidebarWords.length}</b></button><button className={contextWordFilter === "known" ? "active" : ""} aria-pressed={contextWordFilter === "known"} onClick={() => setContextWordFilter("known")}>Знаю <b>{knownWords.length}</b></button><button className={contextWordFilter === "errors" ? "active error" : ""} aria-pressed={contextWordFilter === "errors"} onClick={() => setContextWordFilter("errors")}>С ошибками <b>{errors.length}</b></button></div>
          {contextWordFilter === "errors" && <button className="context-repeat-errors" disabled={!errors.length} onClick={() => startPractice("errors", null)}>Повторить ошибки</button>}
          <div className="context-word-list">{contextWords.map(word => <button key={word.id} onClick={() => { setView("library"); setScope(contextWordFilter === "known" ? "known" : contextWordFilter === "errors" ? "errors" : "all"); if (contextWordFilter !== "day") setSelectedDates([]); setSearch(word.source); }}><span><b>{word.source}</b><small>{word.target}</small></span><em>{contextWordFilter === "day" ? word.status === "error" ? "С ошибкой" : word.status === "known" ? "Знаю" : "Не изучены" : contextWordFilter === "errors" ? "С ошибками" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(`${word.addedAt}T12:00:00`))}</em></button>)}</div>
          {!contextWords.length && <p className="no-context-words">{contextWordFilter === "day" ? selectedDates.length ? "В выбранные дни слова не добавлялись." : "В словаре пока нет слов." : contextWordFilter === "known" ? "Здесь появятся выученные слова." : "Ошибок пока нет. Так держать."}</p>}
        </section>
      </aside>}
    </section>

    {dictionaryOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDictionaryOpen(false)}><section className="add-modal dictionary-modal" role="dialog" aria-modal="true" aria-labelledby="dictionary-title"><header><div><p>НОВЫЙ СЛОВАРЬ</p><h2 id="dictionary-title">Выберите языки</h2></div><button className="close" onClick={() => setDictionaryOpen(false)} aria-label="Закрыть">×</button></header><div className="dictionary-language-fields"><label>Язык слов<MenuSelect ariaLabel="Язык словаря" value={dictionarySourceLang} options={DICTIONARY_LANGUAGES.map((language) => ({ value: language, label: language }))} onChange={setDictionarySourceLang} /></label><span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span><label>Язык перевода<MenuSelect ariaLabel="Язык перевода словаря" value={dictionaryTargetLang} options={DICTIONARY_LANGUAGES.map((language) => ({ value: language, label: language }))} onChange={setDictionaryTargetLang} /></label></div>{dictionarySourceLang === dictionaryTargetLang && <p className="dictionary-language-error" role="alert">Выберите два разных языка.</p>}<button className="primary full" disabled={dictionarySourceLang === dictionaryTargetLang} onClick={createDictionary}>Создать словарь</button></section></div>}

    {addOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAddOpen(false)}><section className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><header><div><p>ЛИЧНЫЙ СЛОВАРЬ</p><h2 id="add-title">Добавить слова</h2></div><button className="close" onClick={() => setAddOpen(false)} aria-label="Закрыть">×</button></header><nav>{(["paste", "file", "single"] as AddMode[]).map(item => <button key={item} className={addMode === item ? "active" : ""} onClick={() => setAddMode(item)}>{{ paste: "Вставить список", file: "Загрузить файл", single: "Одно слово" }[item]}</button>)}</nav><div className="import-settings"><label>Дата добавления<input type="date" value={addDate} onChange={event => setAddDate(event.target.value)} /></label><label>Язык слов<MenuSelect ariaLabel="Язык слов" value={sourceLang} options={LANGUAGES.map(lang => ({ value: lang, label: lang }))} onChange={setSourceLang} /></label><label>Язык перевода<MenuSelect ariaLabel="Язык перевода" value={targetLang} options={LANGUAGES.map(lang => ({ value: lang, label: lang }))} onChange={setTargetLang} /></label></div>{addMode === "paste" && <div className="paste-pane"><label>Скопируйте пары — по одной в строке<textarea value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'circumstances — обстоятельства\nto intend — намереваться\n\nДата: 11.08.2026\nheadphones — наушники'} /></label><p>Разделители: тире, табуляция, точка с запятой или CSV. Дату можно указать отдельной строкой или первым столбцом.</p>{previewWords.length > 0 && <div className="import-preview"><b>Предпросмотр · {previewWords.length}</b>{previewWords.slice(0, 4).map(word => <span key={word.id}>{word.source} <i>→</i> {word.target}<small>{formatDate(word.addedAt)}</small></span>)}</div>}<button className="primary full" onClick={() => addParsed(previewWords)} disabled={!previewWords.length}>Добавить {previewWords.length || ""} слов</button></div>}{addMode === "file" && <div className="file-pane"><input ref={fileRef} type="file" hidden accept=".txt,.csv,.tsv,.docx,.pdf,image/png,image/jpeg,image/webp,image/heic" onChange={event => event.target.files?.[0] && extractFile(event.target.files[0])}/><button className="drop-zone" onClick={() => fileRef.current?.click()}><b>{fileName || "Выберите файл"}</b><span>TXT, CSV, DOCX, PDF, PNG, JPG, WEBP</span><small>Текст и языки распознаются автоматически. Перед добавлением вы сможете проверить пары.</small></button><p className="privacy-note">Файл обрабатывается в браузере и не сохраняется на сервере.</p></div>}{addMode === "single" && <div className="single-pane"><label>Слово или выражение<input value={singleSource} onChange={event => setSingleSource(event.target.value)} placeholder="circumstances" /></label><label>Перевод<input value={singleTarget} onChange={event => setSingleTarget(event.target.value)} placeholder="обстоятельства" /></label><button className="primary full" onClick={addSingle}>Добавить слово</button></div>}{importStatus && <div className="import-status" role="status">{importStatus}</div>}</section></div>}
  </main>;
}

function MenuSelect({ ariaLabel, value, options, onChange, className = "", icon }: { ariaLabel: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; className?: string; icon?: string }) {
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return <details className={`menu-select ${className}`.trim()}>
    <summary aria-label={`${ariaLabel}: ${selected}`}>{icon && <span className="material-symbols-rounded menu-select-icon" aria-hidden="true">{icon}</span>}<span className="menu-select-value">{selected}</span><span className="material-symbols-outlined menu-select-arrow" aria-hidden="true">keyboard_arrow_down</span></summary>
    <div role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "active" : ""} key={option.value} onClick={(event) => { onChange(option.value); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{option.label}</button>)}</div>
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

function TrainingHeader({ view, count, selectedDate, onChange }: { view: "cards" | "match" | "type"; count: number; selectedDate: string | null; onChange: (view: "cards" | "match" | "type") => void }) {
  const formats = [
    { id: "cards", label: "Карточки" },
    { id: "match", label: "Пары" },
    { id: "type", label: "Вписать" },
  ] as const;
  return <section className="training-heading">
    <header className="content-head practice-heading"><div><p>ПОВТОРЕНИЕ СЛОВ</p><h2>Тренировка</h2></div><span>{selectedDate ? formatDate(selectedDate) : formatWordCount(count)}</span></header>
    <nav className="practice-format-chips" aria-label="Формат тренировки">{formats.map(format => <button key={format.id} className={view === format.id ? "active" : ""} aria-pressed={view === format.id} onClick={() => onChange(format.id)}>{format.label}</button>)}</nav>
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
      { value: "known", label: "Знаю" },
      { value: "error", label: "С ошибками" },
    ]}
    onChange={(value) => onChange(value as WordStatus)}
  />;
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
        <WordStatusMenu word={word} onChange={status => updateWord(word.id, { status, errorCount: status === "error" ? Math.max(1, word.errorCount) : status === "known" ? 0 : word.errorCount })} />
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
