import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders Lingua with no default dictionary or words", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lingua — ваш личный словарь<\/title>/i);
  assert.match(html, /dictionary-switcher-empty-select/);
  assert.match(html, /Нет созданных словарей/);
  assert.match(html, /Добавить словарь/);
  assert.match(html, /Создайте личный словарь/);
  assert.match(html, /src="\.\/main-zero-state\.png\?v=6"/);
  assert.match(html, /Нет добавленных слов/);
  assert.match(html, /Какие слова\?/);
  assert.match(html, /Статистика слов/);
  assert.match(html, /статистика по словам/);
  assert.match(html, /Повторяйте изученное и разбирайте ошибки/);
  assert.doesNotMatch(html, /rail-progress-categories/);
  assert.match(html, /Создавайте словари на любых языках/);
  assert.match(html, /Одно слово/);
  assert.match(html, /Группа слов/);
  assert.match(html, /Фото или файл/);
  assert.match(html, /stylus_note/);
  assert.match(html, /list_alt_add/);
  assert.match(html, /add_photo_alternate/);
  assert.doesNotMatch(html, /Первый словарь — за пару минут/);
  assert.doesNotMatch(html, /0 из 3 шагов/);
  assert.doesNotMatch(html, /class="clear-dictionary-button"/);
  assert.doesNotMatch(html, /id="clear-dictionary-title"/);
});

test("bulk delete is scoped, confirmed, accessible, and acknowledged", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /openClearDictionaryDialog/);
  assert.match(page, /useState<Word\[]>\(\[\]\)/);
  assert.match(page, /useState<Dictionary\[]>\(\[\]\)/);
  assert.match(page, /shouldResetLegacyDemo/);
  assert.match(page, /restoredWords\?\.length === 0/);
  assert.match(page, /Создавайте словари на любых языках/);
  assert.match(page, /className="new-dictionary-fields"/);
  assert.match(page, /Дата добавления/);
  assert.match(page, /\.\.\.dictionaries\.map/);
  assert.match(page, /value: "new", label: "Новый словарь"/);
  assert.doesNotMatch(page, /DictionaryOnboardingStep/);
  assert.doesNotMatch(page, /onboarding-modal-progress/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-labelledby="clear-dictionary-title"/);
  assert.match(page, /Удалить все слова\?/);
  assert.match(page, /className="delete-menu"/);
  assert.match(page, /role="menu" aria-label="Удаление словаря"/);
  assert.doesNotMatch(page, /delete-menu-arrow/);
  assert.doesNotMatch(css, /\.delete-menu-arrow/);
  assert.match(page, /dictionaryWords\.length \? <details/);
  assert.match(page, /Удалить словарь/);
  assert.match(page, /function deleteCurrentDictionary\(\)/);
  assert.match(page, /setDictionaries\(remainingDictionaries\)/);
  assert.match(page, /clearUndoDictionaryRef/);
  assert.match(page, /Сам словарь и выбранная пара языков останутся\./);
  assert.match(page, /filter\(\(word\) => \(word\.dictionaryId \?\? DEFAULT_DICTIONARY_ID\) !== currentDictionary\.id\)/);
  assert.match(page, /setClearStatus\(`Удалено \$\{formatWordCount\(removedCount\)\}`\)/);
  assert.match(page, /function undoClearCurrentDictionary\(\)/);
  assert.match(page, />Вернуть<\/button>/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key !== "Tab"/);
  assert.match(page, /practiceWords\.slice\(matchBatchStart, matchBatchStart \+ 6\)/);
  assert.match(page, /batchComplete && nextBatchStart < practiceWords\.length/);
  assert.match(css, /\.clear-dictionary-button:focus-visible/);
  assert.match(css, /\.clear-dictionary-actions button:focus-visible/);
  assert.match(css, /\.pairs\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);gap:8px\}/);
  assert.match(css, /\.pairs button\.selected:hover:not\(:disabled\)/);
  assert.match(css, /@media\(max-width:390px\)/);
});
